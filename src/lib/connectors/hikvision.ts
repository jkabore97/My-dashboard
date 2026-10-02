import { XMLParser } from "fast-xml-parser";
import { assertPublicHost, hikvisionSites, type HikvisionSite } from "../server/site-credentials";
import { digestFetch } from "../server/digest";
import { errorMessage, fromSource } from "../source";
import { demoCameras } from "../demo";

// Hikvision NVRs (and standalone cameras) over ISAPI, reached through a
// secure tunnel (Cloudflare Tunnel / Tailscale Funnel). Login is HTTP Digest;
// a Cloudflare Access service token can sit in front of the tunnel.

export interface CameraChannel {
  id: number;
  name: string;
  online: boolean | null;
}

export interface CameraDisk {
  id: string;
  name: string;
  status: string;
  capacityMB: number | null;
  freeMB: number | null;
}

export interface CameraSiteStatus {
  /** Connection account id (stable): used in task keys and snapshot URLs. */
  id: string;
  label: string;
  business: string | null;
  device: { name: string | null; model: string | null; serial: string | null; firmware: string | null };
  channels: CameraChannel[];
  disks: CameraDisk[];
  checkedAt: string;
  /** Parts that couldn't be read this round (then the site's tasks aren't judged). */
  warnings?: string[];
}

const xml = new XMLParser({ ignoreAttributes: true, parseTagValue: false, removeNSPrefix: true, isArray: (name) => ["InputProxyChannel", "InputProxyChannelStatus", "hdd", "StreamingChannel", "VideoInputChannel"].includes(name) });

const text = (v: unknown) => (v == null ? null : String(v).trim() || null);
const num = (v: unknown) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const bool = (v: unknown) => (v == null ? null : String(v).trim().toLowerCase() === "true");

// ─── Parsers (pure; tested with sample ISAPI responses) ─────────────────────

export function parseDeviceInfo(body: string) {
  const d = xml.parse(body)?.DeviceInfo ?? {};
  return { name: text(d.deviceName), model: text(d.model), serial: text(d.serialNumber), firmware: text(d.firmwareVersion) };
}

/** NVR channel list + their online status (two ISAPI calls). */
export function parseChannels(listBody: string, statusBody: string | null): CameraChannel[] {
  const list = xml.parse(listBody)?.InputProxyChannelList?.InputProxyChannel ?? [];
  const status = statusBody ? (xml.parse(statusBody)?.InputProxyChannelStatusList?.InputProxyChannelStatus ?? []) : [];
  const online = new Map<number, boolean | null>(status.map((s: Record<string, unknown>) => [Number(s.id), bool(s.online)]));
  return list
    .map((c: Record<string, unknown>) => ({ id: Number(c.id), name: text(c.name) ?? `Camera ${c.id}`, online: online.get(Number(c.id)) ?? null }))
    .filter((c: CameraChannel) => Number.isInteger(c.id) && c.id > 0)
    .sort((a: CameraChannel, b: CameraChannel) => a.id - b.id);
}

/** A standalone camera has video inputs instead of proxy channels. */
export function parseVideoInputs(body: string): CameraChannel[] {
  const list = xml.parse(body)?.VideoInputChannelList?.VideoInputChannel ?? [];
  return list.map((c: Record<string, unknown>) => ({ id: Number(c.id), name: text(c.name) ?? `Camera ${c.id}`, online: true })).filter((c: CameraChannel) => c.id > 0);
}

export function parseStorage(body: string): CameraDisk[] {
  const s = xml.parse(body)?.storage ?? {};
  const hdds = s.hddList?.hdd ?? [];
  return hdds.map((h: Record<string, unknown>) => ({ id: String(h.id), name: text(h.hddName) ?? `Disk ${h.id}`, status: (text(h.status) ?? "unknown").toLowerCase(), capacityMB: num(h.capacity), freeMB: num(h.freeSpace) }));
}

export interface CameraEvent {
  type: string;
  state: "active" | "inactive";
  channel: number | null;
  at: string;
  description: string | null;
}

/** EventNotificationAlert pushed by the NVR's "alarm server" (HTTP listening). */
export function parseEventAlert(body: string): CameraEvent | null {
  const e = xml.parse(body)?.EventNotificationAlert;
  if (!e) return null;
  const type = text(e.eventType)?.toLowerCase();
  if (!type) return null;
  const at = text(e.dateTime);
  return {
    type,
    state: text(e.eventState)?.toLowerCase() === "inactive" ? "inactive" : "active",
    channel: num(e.channelID ?? e.dynChannelID ?? e.channelId),
    at: at && !Number.isNaN(Date.parse(at)) ? new Date(at).toISOString() : new Date().toISOString(),
    description: text(e.eventDescription),
  };
}

// ─── Network ─────────────────────────────────────────────────────────────────

export function siteHeaders(s: HikvisionSite): Record<string, string> {
  return s.cfClientId && s.cfClientSecret ? { "CF-Access-Client-Id": s.cfClientId, "CF-Access-Client-Secret": s.cfClientSecret } : {};
}

export async function isapi(s: HikvisionSite, path: string, accept = "application/xml"): Promise<Response> {
  await assertPublicHost(new URL(s.baseUrl).hostname);
  const res = await digestFetch(`${s.baseUrl}${path}`, { username: s.username, password: s.password }, { headers: { Accept: accept, ...siteHeaders(s) }, signal: AbortSignal.timeout(10_000) });
  if (res.status === 401) throw new Error("NVR rejected the username or password");
  if (res.status >= 300 && res.status < 400) throw new Error("The tunnel redirected the request; if it's behind Cloudflare Access, add the service token");
  return res;
}

async function isapiText(s: HikvisionSite, path: string) {
  const res = await isapi(s, path);
  if (!res.ok) throw new Error(`${res.status} from ${path}`);
  return res.text();
}

/**
 * Recording disks. A device without local storage (many standalone cameras,
 * older firmware) answers 403/404 or "notSupport": that means no disks, not a
 * failure. Timeouts, server errors and network failures still throw.
 */
async function readDisks(s: HikvisionSite): Promise<CameraDisk[]> {
  const res = await isapi(s, "/ISAPI/ContentMgmt/Storage");
  const body = await res.text();
  if (res.status === 403 || res.status === 404 || /notSupport|invalidOperation/i.test(body)) return [];
  if (!res.ok) throw new Error(`${res.status} from /ISAPI/ContentMgmt/Storage`);
  return parseStorage(body);
}

export async function fetchSite(s: HikvisionSite): Promise<CameraSiteStatus> {
  const device = parseDeviceInfo(await isapiText(s, "/ISAPI/System/deviceInfo"));
  const warnings: string[] = [];
  let channels: CameraChannel[];
  let list: string | null = null;
  try {
    list = await isapiText(s, "/ISAPI/ContentMgmt/InputProxy/channels");
  } catch {
    // Not an NVR: a standalone camera exposes its own video inputs.
  }
  if (list !== null) {
    const status = await isapiText(s, "/ISAPI/ContentMgmt/InputProxy/channels/status").catch((err) => (warnings.push(`camera status unavailable (${errorMessage(err)})`), null));
    channels = parseChannels(list, status);
  } else {
    channels = parseVideoInputs(await isapiText(s, "/ISAPI/System/Video/inputs/channels"));
  }
  const disks = await readDisks(s).catch((err) => (warnings.push(`disk status unavailable (${errorMessage(err)})`), [] as CameraDisk[]));
  return { id: s.id, label: s.label, business: s.business, device, channels, disks, checkedAt: new Date().toISOString(), ...(warnings.length ? { warnings } : {}) };
}

export async function getCameras() {
  const sites = await hikvisionSites();
  return fromSource<CameraSiteStatus[]>(
    "Cameras",
    sites.length > 0,
    async (fail) => {
      const settled = await Promise.allSettled(sites.map(fetchSite));
      // A site that answered only in part (status or disks unreadable) is partial: its tasks are left as they are.
      settled.forEach((r, i) => {
        if (r.status === "rejected") fail(sites[i].id, `${sites[i].label}: ${errorMessage(r.reason)}`);
        else if (r.value.warnings) fail(sites[i].id, `${sites[i].label}: ${r.value.warnings.join("; ")}`);
      });
      const ok = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      if (ok.length === 0) throw (settled[0] as PromiseRejectedResult).reason;
      return ok;
    },
    demoCameras,
  );
}

