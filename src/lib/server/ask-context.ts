import { formatMoney } from "../money";
import { moneyOverview } from "../money-summary";
import { today } from "../dates";
import type { Dashboard } from "./dashboard";

const m = (minor: number, currency: string) => formatMoney(minor, currency);

/**
 * A compact, labelled snapshot of the dashboard for "Ask the dashboard".
 * Only live data goes in (sample data would produce confident wrong answers),
 * and each list is capped so the prompt stays a few thousand tokens.
 */
export function buildAskContext(d: Dashboard): string {
  const live = (k: keyof Dashboard["modes"]) => d.modes[k] === "live";
  const day = today();
  const money = moneyOverview(live("stripe") ? d.stripe : [], d.records, day);
  const sections: Record<string, unknown> = {
    today: day,
    open_tasks: d.openTasks.filter((t) => t.origin !== "demo").slice(0, 60).map((t) => ({ severity: t.severity, title: t.title, business: t.business, source: t.source, since: t.createdAt.slice(0, 10), detail: t.detail?.slice(0, 160) })),
    recent_events: d.notifications.slice(0, 40).map((n) => ({ at: n.at.slice(0, 16), source: n.source, title: n.title, severity: n.severity })),
  };
  if (live("stripe")) {
    sections.stripe_accounts = d.stripe.filter((a) => a.livemode).map((a) => ({
      business: a.business,
      revenue_30d: a.revenue.map((r) => ({ gross: m(r.gross, r.currency), net: m(r.net, r.currency) })),
      mrr: a.mrr.map((x) => m(x.amount, x.currency)),
      past_due_subscriptions: a.pastDueSubscriptions,
      disputes: a.disputes.map((x) => ({ amount: m(x.amount, x.currency), reason: x.reason, status: x.status, due_by: x.dueBy })),
    }));
  }
  sections.receivables = money.receivables.slice(0, 40).map((r) => ({ client: r.client, business: r.business, amount: m(r.amount, r.currency), due: r.dueOn, days_late: r.daysLate, source: r.source, number: r.number }));
  sections.subscriptions = money.spend.slice(0, 40).map((s) => ({ vendor: s.vendor, business: s.business, monthly: m(s.monthly, s.currency), next_renewal: s.nextRenewal }));
  sections.deadlines = d.records.deadlines.filter((x) => !x.completedOn).slice(0, 30).map((x) => ({ title: x.title, business: x.business, due: x.dueOn, category: x.category }));
  sections.clients = d.records.clients.filter((c) => !c.archived).slice(0, 60).map((c) => ({ name: c.name, business: c.business, contact: c.contactName }));
  sections.deals = d.records.deals.slice(0, 60).map((x) => ({ title: x.title, client: x.clientName, business: x.business, stage: x.stage, value: x.valueMinor !== null ? m(x.valueMinor, x.currency) : null, next_step: x.nextStep, next_step_due: x.nextStepDue, closed_on: x.closedOn }));
  if (live("websites")) sections.websites = d.websites.map((w) => ({ domain: w.domain, business: w.business, status: w.status, response_ms: w.responseMs, users: w.totalUsers, new_users_7d: w.newUsers7d, visitors_7d: w.visitors7d }));
  if (live("domains")) {
    sections.domains = d.domains.checks.map((x) => ({
      domain: x.domain,
      registration_expires: x.registration.ok ? x.registration.expiresOn : null,
      certificate_expires: x.certificate.ok ? x.certificate.expiresOn : null,
      dmarc: x.email.ok ? x.email.dmarcPolicy : null,
    }));
  }
  if (live("calendar")) sections.calendar_next_7_days = d.calendar.slice(0, 40).map((e) => ({ start: e.start, title: e.title, calendar: e.calendar }));
  if (live("inbox")) sections.inbox_latest = d.emails.slice(0, 30).map((e) => ({ from: e.from, subject: e.subject, received: e.receivedAt.slice(0, 16), unread: e.unread, severity: e.severity, mailbox: e.account, summary: e.triage?.summary ?? e.snippet.slice(0, 160) }));
  if (live("solar")) sections.solar = d.solar.map((s) => ({ station: s.station, business: s.business, last_reading: s.latest.at, power_w: s.latest.powerW, today_kwh: s.latest.todayKWh, battery_pct: s.latest.batterySoc, grid_w: s.latest.gridW, status: s.latest.status, alarms: s.latest.alarms, daily_kwh: s.daily }));
  if (live("cameras")) sections.cameras = d.cameras.map((s) => ({ site: s.label, business: s.business, model: s.device.model, cameras: s.channels.map((c) => `${c.name}: ${c.online === false ? "offline" : "online"}`), disks: s.disks.map((x) => `${x.name}: ${x.status}`) }));
  const notConnected = (Object.entries(d.modes) as [string, string][]).filter(([, v]) => v !== "live").map(([k]) => k);
  sections.not_connected_or_failing = notConnected;
  return JSON.stringify(sections);
}
