"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/server/auth";
import { formatBusinessRules, formatSites, parseBusinessRules, parseSites } from "@/lib/server/config";
import { encrypt, randomToken, sha256Hex } from "@/lib/server/crypto";
import { audit } from "@/lib/server/store/audit";
import { setSetting } from "@/lib/server/store/settings";
import { requestSync } from "@/lib/server/sync";
import type { WebhookProvider } from "@/lib/server/webhooks";

export interface SettingsState {
  error?: string;
  ok?: string;
  secret?: string;
}

const DOMAIN = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export async function saveBusinessRules(_prev: SettingsState, form: FormData): Promise<SettingsState> {
  const user = await requireUser();
  const text = String(form.get("rules") ?? "").slice(0, 10_000);
  const rules = parseBusinessRules(text, /\n/);
  await setSetting("business_rules", rules);
  await audit(user.email, "settings.business_rules", null, { count: rules.length });
  await requestSync();
  revalidatePath("/", "layout");
  return { ok: `Saved ${rules.length} rule${rules.length === 1 ? "" : "s"}.\n${formatBusinessRules(rules)}` };
}

export async function saveWebsites(_prev: SettingsState, form: FormData): Promise<SettingsState> {
  const user = await requireUser();
  const sites = parseSites(String(form.get("sites") ?? "").slice(0, 10_000), /\n/);
  const bad = sites.find((s) => !DOMAIN.test(s.domain));
  if (bad) return { error: `"${bad.domain}" doesn't look like a domain name.` };
  const badRef = sites.find((s) => s.supabaseRef && !/^[a-z0-9]{10,40}$/.test(s.supabaseRef));
  if (badRef) return { error: `"${badRef.supabaseRef}" doesn't look like a Supabase project ref.` };
  await setSetting("websites", sites);
  await audit(user.email, "settings.websites", null, { count: sites.length });
  await requestSync();
  revalidatePath("/", "layout");
  return { ok: `Saved ${sites.length} site${sites.length === 1 ? "" : "s"}.\n${formatSites(sites)}` };
}

const PROVIDERS: WebhookProvider[] = ["github", "vercel", "stripe", "supabase", "hikvision"];

export async function saveWebhookSecret(_prev: SettingsState, form: FormData): Promise<SettingsState> {
  const user = await requireUser();
  const provider = String(form.get("provider")) as WebhookProvider;
  if (!PROVIDERS.includes(provider)) return { error: "Unknown provider." };
  const generate = form.get("generate") === "1";
  const secret = generate ? randomToken(32) : String(form.get("secret") ?? "").trim();
  if (!generate && secret.length < 16) return { error: "Paste the full signing secret (16+ characters)." };
  // The NVR can't sign requests, so its secret goes in the URL path.
  if (provider === "hikvision" && !/^[A-Za-z0-9_-]{16,128}$/.test(secret)) return { error: "Use letters, numbers, - and _ only (it goes in the URL), or click Generate." };
  await setSetting(`webhook_secret:${provider}`, encrypt(secret));
  await audit(user.email, "settings.webhook_secret", provider, { generated: generate });
  revalidatePath("/platforms");
  return generate ? { ok: "New secret generated. Copy it now; it won't be shown again.", secret } : { ok: "Secret saved." };
}

const STATION = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/** Solar rules (daylight window, thresholds) and which business each station belongs to. */
export async function saveSolarSettings(_prev: SettingsState, form: FormData): Promise<SettingsState> {
  const user = await requireUser();
  const int = (name: string, min: number, max: number) => {
    const n = Number(form.get(name));
    return Number.isInteger(n) && n >= min && n <= max ? n : null;
  };
  const daylightFrom = int("daylightFrom", 0, 23);
  const daylightTo = int("daylightTo", 1, 24);
  const offlineAfterMin = int("offlineAfterMin", 5, 1440);
  const lowBatteryPct = int("lowBatteryPct", 0, 100);
  if (daylightFrom === null || daylightTo === null || daylightFrom >= daylightTo) return { error: "Daylight hours must be whole hours, start before end." };
  if (offlineAfterMin === null) return { error: "Offline after must be 5–1440 minutes." };
  if (lowBatteryPct === null) return { error: "Low battery must be 0–100%." };
  const businesses: Record<string, string> = {};
  for (const line of String(form.get("stations") ?? "").slice(0, 5000).split("\n")) {
    const [station, business] = line.split("=").map((x) => x?.trim() ?? "");
    if (!station) continue;
    if (!STATION.test(station.toLowerCase())) return { error: `"${station}" isn't a valid station id (letters, numbers, - or _).` };
    if (business) businesses[station.toLowerCase()] = business.slice(0, 80);
  }
  await setSetting("solar", { daylightFrom, daylightTo, offlineAfterMin, lowBatteryPct, businesses });
  await audit(user.email, "settings.solar", null, { stations: Object.keys(businesses).length });
  await requestSync();
  revalidatePath("/", "layout");
  return { ok: "Saved." };
}

/** Creates a new ingest token (replacing the old one). Only its hash is stored. */
export async function generateSolarToken(): Promise<SettingsState> {
  const user = await requireUser();
  const token = `sol_${randomToken(24)}`;
  await setSetting("solar_ingest_token_hash", sha256Hex(token));
  await audit(user.email, "settings.solar_token", null, null);
  revalidatePath("/settings");
  return { ok: "New token created. Copy it now; it won't be shown again. The previous token stops working.", secret: token };
}
