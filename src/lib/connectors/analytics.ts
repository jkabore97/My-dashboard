import { demoAnalytics } from "../demo";
import { registrableDomain } from "../server/domains";
import { googleAccounts, type GoogleAccount } from "../server/credentials";
import { GoogleApiError, googleAccessToken, googleApi, hasGoogleScope } from "../server/google";
import { errorMessage, fromSource } from "../source";
import type { DailyPoint, SiteAnalytics } from "../types";

// Google Analytics 4 (traffic) and Search Console (search clicks) for each
// website. Sites are matched to GA4 web streams and Search Console properties
// by hostname, so there's nothing to configure beyond connecting Google.

const TTL_MS = 15 * 60_000; // Analytics quotas are tight; data changes slowly
const memo = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
  const value = await fn();
  memo.set(key, { at: Date.now(), value });
  return value;
}

const bare = (host: string) => host.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
const hostOf = (uri: string) => {
  try {
    return bare(new URL(uri).hostname);
  } catch {
    return null;
  }
};

/** Pure: GA4 "YYYYMMDD" → "YYYY-MM-DD". */
export const gaDate = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

/**
 * Pure: which Search Console property covers a site. A domain property
 * ("sc-domain:example.com") covers every subdomain; a URL-prefix property
 * must match the host (www-insensitive). Domain properties win.
 */
export function matchSearchConsole(domain: string, siteUrls: string[]): string | null {
  const d = bare(domain);
  const apex = registrableDomain(d);
  const dom = siteUrls.find((u) => u === `sc-domain:${apex}` || (u.startsWith("sc-domain:") && (d === u.slice(10) || d.endsWith(`.${u.slice(10)}`))));
  if (dom) return dom;
  return siteUrls.find((u) => !u.startsWith("sc-domain:") && hostOf(u) === d) ?? null;
}

interface GaReport {
  rows?: { dimensionValues?: { value: string }[]; metricValues: { value: string }[] }[];
}

/** Pure: the three GA4 reports → traffic block. */
export function toTraffic(daily: GaReport, totals: GaReport, pages: GaReport): NonNullable<SiteAnalytics["traffic"]> {
  const rows = (daily.rows ?? []).map((r) => ({ date: gaDate(r.dimensionValues![0].value), m: r.metricValues.map((v) => Number(v.value)) })).sort((a, b) => a.date.localeCompare(b.date));
  const t = totals.rows?.[0]?.metricValues.map((v) => Number(v.value)) ?? [0, 0, 0, 0];
  return {
    sessions: rows.map((r) => ({ date: r.date, value: r.m[0] })),
    users: rows.map((r) => ({ date: r.date, value: r.m[1] })),
    totals: { sessions: t[0] ?? 0, users: t[1] ?? 0, newUsers: t[2] ?? 0, keyEvents: t[3] ?? 0 },
    topPages: (pages.rows ?? []).map((r) => ({ path: r.dimensionValues![0].value, views: Number(r.metricValues[0].value) })),
  };
}

const METRICS = ["sessions", "totalUsers", "newUsers", "keyEvents"].map((name) => ({ name }));
const RANGE = [{ startDate: "28daysAgo", endDate: "today" }];

/** For accounts whose granted scopes are unknown, a 403 means "not granted", not a failure. */
const notGrantedAsEmpty = (a: GoogleAccount) => (e: unknown) => (!a.scopes && e instanceof GoogleApiError && e.status === 403 ? [] : Promise.reject(e));

async function gaProperties(a: GoogleAccount, token: string): Promise<{ property: string; hosts: string[] }[]> {
  return cached(`ga-props:${a.id}`, async () => {
    const props: string[] = [];
    let pageToken = "";
    for (let i = 0; i < 5; i++) {
      const res = await googleApi<{ accountSummaries?: { propertySummaries?: { property: string }[] }[]; nextPageToken?: string }>(
        token,
        `https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`,
      );
      for (const acc of res.accountSummaries ?? []) for (const p of acc.propertySummaries ?? []) props.push(p.property);
      if (!res.nextPageToken) break;
      pageToken = res.nextPageToken;
    }
    return Promise.all(
      props.slice(0, 50).map(async (property) => {
        const s = await googleApi<{ dataStreams?: { type: string; webStreamData?: { defaultUri?: string } }[] }>(token, `https://analyticsadmin.googleapis.com/v1beta/${property}/dataStreams`);
        const hosts = (s.dataStreams ?? []).flatMap((d) => (d.type === "WEB_DATA_STREAM" && d.webStreamData?.defaultUri ? [hostOf(d.webStreamData.defaultUri)] : [])).filter((h): h is string => !!h);
        return { property, hosts };
      }),
    );
  });
}

async function gaTraffic(token: string, property: string) {
  return cached(`ga-traffic:${property}`, async () => {
    const res = await googleApi<{ reports: GaReport[] }>(token, `https://analyticsdata.googleapis.com/v1beta/${property}:batchRunReports`, {
      method: "POST",
      body: {
        requests: [
          { dateRanges: RANGE, dimensions: [{ name: "date" }], metrics: METRICS, limit: 100 },
          { dateRanges: RANGE, metrics: METRICS },
          { dateRanges: RANGE, dimensions: [{ name: "pagePath" }], metrics: [{ name: "screenPageViews" }], orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }], limit: 8 },
        ],
      },
    });
    return toTraffic(res.reports[0] ?? {}, res.reports[1] ?? {}, res.reports[2] ?? {});
  });
}

interface ScRows {
  rows?: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[];
}

export function toSearch(siteUrl: string, daily: ScRows, totals: ScRows, queries: ScRows): NonNullable<SiteAnalytics["search"]> {
  const t = totals.rows?.[0];
  return {
    siteUrl,
    clicks: (daily.rows ?? []).map((r) => ({ date: r.keys[0], value: r.clicks })).sort((a, b) => a.date.localeCompare(b.date)),
    totals: { clicks: t?.clicks ?? 0, impressions: t?.impressions ?? 0, ctr: t?.ctr ?? 0, position: t?.position ?? 0 },
    topQueries: (queries.rows ?? []).map((r) => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions, position: r.position })),
  };
}

async function scSites(a: GoogleAccount, token: string) {
  return cached(`sc-sites:${a.id}`, async () => {
    const res = await googleApi<{ siteEntry?: { siteUrl: string; permissionLevel: string }[] }>(token, "https://www.googleapis.com/webmasters/v3/sites");
    return (res.siteEntry ?? []).filter((s) => s.permissionLevel !== "siteUnverifiedUser").map((s) => s.siteUrl);
  });
}

async function scSearch(token: string, siteUrl: string) {
  return cached(`sc-search:${siteUrl}`, async () => {
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10);
    const q = (body: object) => googleApi<ScRows>(token, `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, { method: "POST", body: { startDate: start, endDate: end, ...body } });
    const [daily, totals, queries] = await Promise.all([q({ dimensions: ["date"] }), q({}), q({ dimensions: ["query"], rowLimit: 8 })]);
    return toSearch(siteUrl, daily, totals, queries);
  });
}

export async function getAnalytics(domains: string[]) {
  const accounts = (await googleAccounts()).filter((a) => hasGoogleScope(a.scopes, "analytics") !== false || hasGoogleScope(a.scopes, "searchConsole") !== false);
  return fromSource<SiteAnalytics[]>(
    "Analytics",
    accounts.length > 0 && domains.length > 0,
    async (fail) => {
      const out = new Map<string, SiteAnalytics>(domains.map((d) => [d, { domain: d, property: null, traffic: null, search: null }]));
      let anyOk = false;
      let firstError: unknown = null;
      for (const a of accounts) {
        try {
          const token = await googleAccessToken(a.refreshToken);
          if (hasGoogleScope(a.scopes, "analytics") !== false) {
            const props = await gaProperties(a, token).catch(notGrantedAsEmpty(a));
            for (const d of domains) {
              const site = out.get(d)!;
              if (site.traffic) continue;
              const match = props.find((p) => p.hosts.includes(bare(d)));
              if (match) Object.assign(site, { property: match.property, traffic: await gaTraffic(token, match.property) });
            }
          }
          if (hasGoogleScope(a.scopes, "searchConsole") !== false) {
            const sites = await scSites(a, token).catch(notGrantedAsEmpty(a));
            for (const d of domains) {
              const site = out.get(d)!;
              if (site.search) continue;
              const siteUrl = matchSearchConsole(d, sites);
              if (siteUrl) site.search = await scSearch(token, siteUrl);
            }
          }
          anyOk = true;
        } catch (err) {
          firstError ??= err;
          fail(a.id, `${a.label}: ${errorMessage(err)}`);
        }
      }
      if (!anyOk) throw firstError;
      return [...out.values()];
    },
    demoAnalytics,
  );
}

/** Sum of the last `days` points. */
export const lastDays = (points: DailyPoint[], days: number) => points.slice(-days).reduce((n, p) => n + p.value, 0);
