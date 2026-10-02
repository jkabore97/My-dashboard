import { collect, type Collected } from "../aggregate";
import { buildWeeklyReport, renderBrief, renderWeeklyReport, revenueOn, solarOn, type WeeklyReport } from "../brief";
import { addDays, businessTimeZone, today } from "../dates";
import { hourIn } from "../solar";
import { env, errorMessage } from "../source";
import { getConfig } from "./config";
import { getDb } from "./db";
import { emailEnabled, pushAll, pushEnabled, sendEmail } from "./notify";
import { claimInterval, expireInterval } from "./store/settings";
import { snapshotHistory } from "./store/snapshots";
import { listTasks } from "./store/tasks";

export const appUrl = () => (env("APP_URL") ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000")).replace(/\/$/, "");

/** Hour (business timezone) the brief goes out; BRIEF_HOUR, default 7. */
export const briefHour = () => {
  const h = Number(env("BRIEF_HOUR") ?? 7);
  return Number.isInteger(h) && h >= 0 && h <= 23 ? h : 7;
};

/** Every business the dashboard knows about, for the report picker. */
export async function knownBusinesses(given?: Collected): Promise<string[]> {
  const c = given ?? (await collect());
  const { businessRules, sites } = await getConfig();
  const names = [
    ...businessRules.map((r) => r.business),
    ...sites.map((s) => s.business),
    // Sample data never names a business here.
    ...(c.modes.stripe === "live" ? c.stripe.filter((a) => a.livemode).map((a) => a.business) : []),
    ...c.records.deals.map((d) => d.business),
    ...(c.modes.cameras === "live" ? c.cameras.map((s) => s.business) : []),
    ...Object.values(c.solarConfig.businesses),
  ];
  return [...new Set(names.filter((n): n is string => !!n && n !== "Unassigned"))].sort();
}

export async function buildMorningBrief(given?: Collected) {
  const tz = businessTimeZone();
  const day = today(tz);
  const yesterday = addDays(day, -1);
  const c = given ?? (await collect());
  const open = await listTasks("open");
  const db = await getDb();
  const [signups] = await db.query<{ n: number }>("select count(*)::int as n from events where kind = 'signup' and occurred_at > now() - interval '24 hours'");
  return renderBrief({
    date: day,
    dashboardUrl: appUrl(),
    tasks: open,
    revenueYesterday: revenueOn(c.stripe, yesterday),
    signups24h: Number(signups?.n ?? 0),
    meetingsToday: c.modes.calendar === "live" ? c.calendar.filter((e) => (e.allDay ? e.start : today(tz, new Date(e.start))) === day) : [],
    solarYesterdayKWh: c.modes.solar === "live" ? solarOn(c.solar, yesterday) : null,
    camerasOffline: c.modes.cameras === "live" ? c.cameras.reduce((n, s) => n + s.channels.filter((ch) => ch.online === false).length, 0) : 0,
    timeZone: tz,
  });
}

export async function weeklyReport(business: string, to = addDays(today(), -1), given?: Collected): Promise<WeeklyReport> {
  const c = given ?? (await collect());
  const { sites } = await getConfig();
  const domains = new Set(sites.filter((s) => s.business === business).map((s) => s.domain));
  const history = await snapshotHistory<{ status: string; totalUsers: number | null }>("website", 24 * 8);
  const db = await getDb();
  const [closed] = await db.query<{ n: number }>(
    "select count(*)::int as n from tasks where status = 'done' and resolved_at > now() - interval '7 days' and coalesce(business_override, business) = $1",
    [business],
  );
  const open = (await listTasks("open")).filter((t) => t.business === business);
  return buildWeeklyReport({
    business,
    to,
    stripe: c.stripe,
    siteChecks: history.filter((h) => domains.has(h.key)).map((h) => ({ domain: h.key, status: h.data.status, totalUsers: h.data.totalUsers, at: h.takenAt })),
    tasksClosed: Number(closed?.n ?? 0),
    open,
    deals: c.records.deals,
    solar: c.modes.solar === "live" ? c.solar : [],
  });
}

/**
 * Cron hook: sends the morning brief once a day at BRIEF_HOUR, and on Mondays
 * a weekly report per business. Each send is claimed first so overlapping
 * cron runs can't send twice; a failed send releases the claim to retry.
 */
export async function sendScheduledReports(c: Collected, now = new Date()): Promise<string[]> {
  const sent: string[] = [];
  const tz = businessTimeZone();
  if (hourIn(tz, now) !== briefHour() || (!emailEnabled() && !pushEnabled())) return sent;
  const day = today(tz, now);

  const briefKey = `job:brief:${day}`;
  if (await claimInterval(briefKey, 3 * 86_400)) {
    try {
      const brief = await buildMorningBrief(c);
      if (emailEnabled()) await sendEmail(brief.subject, brief.html, brief.text);
      if (pushEnabled()) await pushAll({ title: "Morning brief", body: brief.subject.replace(/^Morning brief · [^·]+· /, ""), url: "/", tag: "brief" });
      sent.push("brief");
    } catch (err) {
      await expireInterval(briefKey).catch(() => {});
      console.error(`[brief] ${errorMessage(err)}`);
    }
  }

  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: tz }).format(now);
  if (weekday === "Mon" && emailEnabled()) {
    for (const b of await knownBusinesses(c)) {
      const key = `job:weekly:${day}:${b}`;
      if (!(await claimInterval(key, 3 * 86_400))) continue;
      try {
        const r = renderWeeklyReport(await weeklyReport(b, addDays(day, -1), c), `${appUrl()}/reports?business=${encodeURIComponent(b)}`);
        await sendEmail(r.subject, r.html, r.text);
        sent.push(`weekly:${b}`);
      } catch (err) {
        await expireInterval(key).catch(() => {});
        console.error(`[weekly] ${b}: ${errorMessage(err)}`);
      }
    }
  }
  return sent;
}
