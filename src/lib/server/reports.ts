import { collect, type Collected } from "../aggregate";
import { buildWeeklyReport, renderBrief, renderWeeklyReport, revenueOn, solarOn, type WeeklyReport } from "../brief";
import { addDays, businessTimeZone, today } from "../dates";
import { hourIn } from "../solar";
import { env, errorMessage } from "../source";
import { getConfig } from "./config";
import { getDb } from "./db";
import { emailEnabled, pushEnabled, pushTo, sendEmail } from "./notify";
import { people } from "./people";
import { isFullOwner } from "../access";
import { claimInterval, expireInterval, getSetting, setSetting } from "./store/settings";
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

/** Stripe accounts reports may count: none unless Stripe is really connected (never sample data). */
const reportableStripe = (c: Collected) => (c.modes.stripe === "live" ? c.stripe : []);

export async function buildMorningBrief(given?: Collected) {
  const tz = businessTimeZone();
  const day = today(tz);
  const yesterday = addDays(day, -1);
  const c = given ?? (await collect());
  // The brief goes to the business owner: never anyone's personal mail, calendar or tasks.
  const open = (await listTasks("open")).filter((t) => !t.privateTo);
  const db = await getDb();
  const [signups] = await db.query<{ n: number }>("select count(*)::int as n from events where kind = 'signup' and occurred_at > now() - interval '24 hours'");
  return renderBrief({
    date: day,
    dashboardUrl: appUrl(),
    tasks: open,
    revenueYesterday: revenueOn(reportableStripe(c), yesterday),
    signups24h: Number(signups?.n ?? 0),
    meetingsToday: c.modes.calendar === "live" ? c.calendar.filter((e) => !e.owner && (e.allDay ? e.start : today(tz, new Date(e.start))) === day) : [],
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
    "select count(*)::int as n from tasks where status = 'done' and resolved_at > now() - interval '7 days' and coalesce(business_override, business) = $1 and private_to is null",
    [business],
  );
  const open = (await listTasks("open")).filter((t) => t.business === business && !t.privateTo);
  return buildWeeklyReport({
    business,
    to,
    stripe: reportableStripe(c),
    siteChecks: history.filter((h) => domains.has(h.key)).map((h) => ({ domain: h.key, status: h.data.status, totalUsers: h.data.totalUsers, at: h.takenAt })),
    tasksClosed: Number(closed?.n ?? 0),
    open,
    deals: c.records.deals,
    solar: c.modes.solar === "live" ? c.solar : [],
  });
}

/**
 * Sends something at most once: a 10-minute lease keeps overlapping cron runs
 * from both sending, and a "done" mark is written only after a successful
 * send. A run killed mid-send (the 60-second limit) leaves no done mark, so a
 * later run in the same hour tries again once the lease lapses.
 */
export async function sendOnce(key: string, send: () => Promise<void>): Promise<boolean> {
  if (await getSetting<string | null>(`${key}:done`, null)) return false;
  if (!(await claimInterval(key, 600))) return false;
  try {
    await send();
    await setSetting(`${key}:done`, new Date().toISOString());
    return true;
  } catch (err) {
    await expireInterval(key).catch(() => {});
    throw err;
  }
}

/**
 * Cron hook: sends the morning brief once a day, from BRIEF_HOUR until six
 * hours later (a once-a-day schedule rarely lands on the exact hour), and on
 * Mondays a weekly report per business. Each is sent at most once a day.
 */
export const inBriefWindow = (hour: number, start = briefHour()) => hour >= start && hour < start + 6;

export async function sendScheduledReports(c: Collected, now = new Date()): Promise<string[]> {
  const sent: string[] = [];
  const tz = businessTimeZone();
  if (!inBriefWindow(hourIn(tz, now)) || (!emailEnabled() && !pushEnabled())) return sent;
  const day = today(tz, now);

  try {
    const done = await sendOnce(`job:brief:${day}`, async () => {
      const brief = await buildMorningBrief(c);
      if (emailEnabled()) await sendEmail(brief.subject, brief.html, brief.text);
      if (pushEnabled()) await pushTo((await people()).filter(isFullOwner).map((p) => p.email), { title: "Morning brief", body: brief.subject.replace(/^Morning brief · [^·]+· /, ""), url: "/", tag: "brief" });
    });
    if (done) sent.push("brief");
  } catch (err) {
    console.error(`[brief] ${errorMessage(err)}`);
  }

  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: tz }).format(now);
  if (weekday === "Mon" && emailEnabled()) {
    for (const b of await knownBusinesses(c)) {
      try {
        const done = await sendOnce(`job:weekly:${day}:${b}`, async () => {
          const r = renderWeeklyReport(await weeklyReport(b, addDays(day, -1), c), `${appUrl()}/reports?business=${encodeURIComponent(b)}`);
          await sendEmail(r.subject, r.html, r.text);
        });
        if (done) sent.push(`weekly:${b}`);
      } catch (err) {
        console.error(`[weekly] ${b}: ${errorMessage(err)}`);
      }
    }
  }
  return sent;
}
