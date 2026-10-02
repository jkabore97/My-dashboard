import { addDays, formatDate } from "./dates";
import { formatTotals, sumByCurrency, type CurrencyAmount } from "./money";
import { liveAccounts } from "./money-summary";
import type { SolarStation } from "./solar";
import type { Deal } from "./server/store/pipeline";
import type { CalendarEvent, Severity, StripeAccountSummary } from "./types";

// Morning brief and weekly business report. Pure builders: the server module
// (server/reports.ts) gathers the inputs, these turn them into text and HTML.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface BriefTask {
  title: string;
  severity: Severity;
  business?: string | null;
  url?: string | null;
}

export interface BriefInput {
  date: string;
  dashboardUrl: string;
  tasks: BriefTask[];
  revenueYesterday: CurrencyAmount[];
  signups24h: number;
  meetingsToday: Pick<CalendarEvent, "title" | "start" | "allDay">[];
  solarYesterdayKWh: number | null;
  camerasOffline: number;
  timeZone: string;
}

export interface Rendered {
  subject: string;
  text: string;
  html: string;
}

/** Revenue (gross) on one business-timezone day across live Stripe accounts. */
export function revenueOn(stripe: StripeAccountSummary[], date: string, business?: string): CurrencyAmount[] {
  return sumByCurrency(liveAccounts(stripe).filter((a) => !business || a.business === business).flatMap((a) => a.daily.filter((d) => d.date === date).map((d) => ({ currency: d.currency, amount: d.gross }))));
}

/** Energy produced yesterday across stations, from the per-day maximum. */
export function solarOn(stations: SolarStation[], date: string): number | null {
  const days = stations.flatMap((s) => s.daily.filter((d) => d.date === date));
  return days.length ? Math.round(days.reduce((n, d) => n + d.value, 0) * 10) / 10 : null;
}

const time = (iso: string, tz: string) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }).format(new Date(iso));

export function renderBrief(b: BriefInput): Rendered {
  const count = (s: Severity) => b.tasks.filter((t) => t.severity === s).length;
  const critical = count("critical");
  const high = count("high");
  const headline = critical ? `${critical} critical, ${high} high` : high ? `${high} high-priority item${high > 1 ? "s" : ""}` : "nothing urgent";
  const subject = `Morning brief · ${formatDate(b.date)} · ${headline}`;

  const lines: [string, string][] = [];
  if (b.revenueYesterday.length) lines.push(["Revenue yesterday", formatTotals(b.revenueYesterday)]);
  if (b.signups24h) lines.push(["New sign-ups (24 h)", String(b.signups24h)]);
  if (b.solarYesterdayKWh !== null) lines.push(["Solar yesterday", `${b.solarYesterdayKWh} kWh`]);
  if (b.camerasOffline) lines.push(["Cameras offline", String(b.camerasOffline)]);
  const top = b.tasks.filter((t) => t.severity === "critical" || t.severity === "high").slice(0, 8);
  const meetings = b.meetingsToday.slice(0, 8).map((m) => `${m.allDay ? "All day" : time(m.start, b.timeZone)} · ${m.title}`);

  const text = [
    subject,
    "",
    ...lines.map(([k, v]) => `${k}: ${v}`),
    ...(top.length ? ["", "Needs attention:", ...top.map((t) => `- [${t.severity}] ${t.title}${t.business ? ` (${t.business})` : ""}`)] : ["", "Nothing critical or high open. Good morning."]),
    ...(meetings.length ? ["", "Today:", ...meetings.map((m) => `- ${m}`)] : []),
    "",
    `Open the dashboard: ${b.dashboardUrl}`,
  ].join("\n");

  const color: Record<Severity, string> = { critical: "#dc2626", high: "#ea580c", medium: "#ca8a04", low: "#64748b" };
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a">
<div style="max-width:560px;margin:auto;background:#fff;border-radius:12px;padding:24px">
<p style="margin:0;color:#64748b;font-size:13px">${esc(formatDate(b.date))}</p>
<h1 style="margin:4px 0 16px;font-size:20px">Good morning: ${esc(headline)}</h1>
${lines.length ? `<table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:16px">${lines.map(([k, v]) => `<tr><td style="padding:4px 0;color:#64748b">${esc(k)}</td><td style="padding:4px 0;text-align:right;font-weight:600">${esc(v)}</td></tr>`).join("")}</table>` : ""}
${top.length ? `<h2 style="font-size:14px;margin:16px 0 8px">Needs attention</h2><ul style="padding-left:0;list-style:none;margin:0">${top.map((t) => `<li style="padding:6px 0;border-top:1px solid #eef0f3;font-size:14px"><span style="color:${color[t.severity]};font-weight:600;text-transform:uppercase;font-size:11px">${t.severity}</span> ${esc(t.title)}${t.business ? ` <span style="color:#64748b">· ${esc(t.business)}</span>` : ""}</li>`).join("")}</ul>` : `<p style="font-size:14px">Nothing critical or high open.</p>`}
${meetings.length ? `<h2 style="font-size:14px;margin:16px 0 8px">Today</h2><ul style="padding-left:18px;margin:0;font-size:14px">${meetings.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>` : ""}
<p style="margin-top:24px"><a href="${esc(b.dashboardUrl)}" style="background:#2563eb;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px">Open the dashboard</a></p>
</div></body></html>`;
  return { subject, text, html };
}

// ─── Weekly report ───────────────────────────────────────────────────────────

export interface WeeklyReport {
  business: string;
  from: string;
  to: string;
  revenue: CurrencyAmount[];
  revenuePrev: CurrencyAmount[];
  newUsers: number | null;
  sites: { domain: string; uptimePct: number | null; checks: number }[];
  tasksClosed: number;
  openCritical: number;
  openHigh: number;
  dealsWon: { title: string; client: string | null; value: CurrencyAmount | null }[];
  solarKWh: number | null;
}

export interface WeeklyInput {
  business: string;
  /** Last day of the week (inclusive), business timezone. */
  to: string;
  stripe: StripeAccountSummary[];
  /** Website health snapshots for the business's domains over the period. */
  siteChecks: { domain: string; status: string; totalUsers: number | null; at: string }[];
  tasksClosed: number;
  open: { severity: Severity }[];
  deals: Deal[];
  solar: SolarStation[];
}

export function buildWeeklyReport(w: WeeklyInput): WeeklyReport {
  const from = addDays(w.to, -6);
  const inRange = (d: string, a: string, b: string) => d >= a && d <= b;
  const stripe = liveAccounts(w.stripe).filter((a) => a.business === w.business);
  const rev = (a: string, b: string) => sumByCurrency(stripe.flatMap((s) => s.daily.filter((d) => inRange(d.date, a, b)).map((d) => ({ currency: d.currency, amount: d.gross }))));
  const byDomain = new Map<string, typeof w.siteChecks>();
  for (const c of w.siteChecks) byDomain.set(c.domain, [...(byDomain.get(c.domain) ?? []), c]);
  let newUsers: number | null = null;
  const sites = [...byDomain].map(([domain, checks]) => {
    const sorted = [...checks].sort((a, b) => a.at.localeCompare(b.at));
    const users = sorted.filter((c) => c.totalUsers !== null);
    if (users.length >= 2) newUsers = (newUsers ?? 0) + Math.max(0, users[users.length - 1].totalUsers! - users[0].totalUsers!);
    const known = sorted.filter((c) => c.status !== "unknown");
    return { domain, checks: known.length, uptimePct: known.length ? Math.round((known.filter((c) => c.status === "up").length / known.length) * 1000) / 10 : null };
  });
  const solarDays = w.solar.filter((s) => s.business === w.business).flatMap((s) => s.daily.filter((d) => inRange(d.date, from, w.to)));
  return {
    business: w.business,
    from,
    to: w.to,
    revenue: rev(from, w.to),
    revenuePrev: rev(addDays(from, -7), addDays(from, -1)),
    newUsers,
    sites,
    tasksClosed: w.tasksClosed,
    openCritical: w.open.filter((t) => t.severity === "critical").length,
    openHigh: w.open.filter((t) => t.severity === "high").length,
    dealsWon: w.deals
      .filter((d) => d.business === w.business && d.stage === "won" && d.closedOn && inRange(d.closedOn, from, w.to))
      .map((d) => ({ title: d.title, client: d.clientName, value: d.valueMinor !== null ? { currency: d.currency, amount: d.valueMinor } : null })),
    solarKWh: solarDays.length ? Math.round(solarDays.reduce((n, d) => n + d.value, 0) * 10) / 10 : null,
  };
}

export function renderWeeklyReport(r: WeeklyReport, reportUrl: string): Rendered {
  const subject = `Weekly report · ${r.business} · ${formatDate(r.from)} – ${formatDate(r.to)}`;
  const rows: [string, string][] = [
    ["Revenue", r.revenue.length ? formatTotals(r.revenue) : "—"],
    ["Previous week", r.revenuePrev.length ? formatTotals(r.revenuePrev) : "—"],
    ["New users", r.newUsers === null ? "—" : String(r.newUsers)],
    ...r.sites.map((s): [string, string] => [`Uptime ${s.domain}`, s.uptimePct === null ? "no checks" : `${s.uptimePct}%`]),
    ["Issues closed", String(r.tasksClosed)],
    ["Still open", `${r.openCritical} critical, ${r.openHigh} high`],
    ...(r.solarKWh !== null ? [["Solar produced", `${r.solarKWh} kWh`] as [string, string]] : []),
    ["Deals won", r.dealsWon.length ? r.dealsWon.map((d) => d.title).join(", ") : "none"],
  ];
  const text = [subject, "", ...rows.map(([k, v]) => `${k}: ${v}`), "", `Full report: ${reportUrl}`].join("\n");
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a">
<div style="max-width:560px;margin:auto;background:#fff;border-radius:12px;padding:24px">
<p style="margin:0;color:#64748b;font-size:13px">${esc(formatDate(r.from))} – ${esc(formatDate(r.to))}</p>
<h1 style="margin:4px 0 16px;font-size:20px">${esc(r.business)}: weekly report</h1>
<table style="width:100%;border-collapse:collapse;font-size:14px">${rows.map(([k, v]) => `<tr><td style="padding:6px 0;border-top:1px solid #eef0f3;color:#64748b">${esc(k)}</td><td style="padding:6px 0;border-top:1px solid #eef0f3;text-align:right;font-weight:600">${esc(v)}</td></tr>`).join("")}</table>
<p style="margin-top:24px"><a href="${esc(reportUrl)}" style="color:#2563eb">Open the full report</a></p>
</div></body></html>`;
  return { subject, text, html };
}
