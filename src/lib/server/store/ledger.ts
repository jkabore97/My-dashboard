import { getDb } from "../db";
import { nextOccurrence, type Recurrence } from "../../dates";

// Records you keep by hand: invoices sent outside Stripe, software
// subscriptions, and dated obligations (taxes, filings, renewals).
// Dates travel as "YYYY-MM-DD" text and amounts as text to avoid driver
// differences (Date timezones, bigint as string vs number).

export interface Invoice {
  id: string;
  business: string | null;
  client: string;
  number: string | null;
  amountMinor: number;
  currency: string;
  issuedOn: string | null;
  dueOn: string;
  status: "open" | "paid" | "void";
  paidOn: string | null;
  notes: string | null;
}

export interface Subscription {
  id: string;
  business: string | null;
  vendor: string;
  plan: string | null;
  amountMinor: number;
  currency: string;
  interval: "month" | "year";
  nextRenewal: string | null;
  autoRenew: boolean;
  url: string | null;
  notes: string | null;
  active: boolean;
  /** Day it was first tracked (YYYY-MM-DD). */
  createdOn?: string;
  /** Day of the last change; for an inactive row, roughly when it stopped being tracked. */
  updatedOn?: string;
}

export type DeadlineCategory = "tax" | "filing" | "license" | "insurance" | "contract" | "other";

export interface Deadline {
  id: string;
  business: string | null;
  title: string;
  category: DeadlineCategory;
  dueOn: string;
  recurrence: Recurrence;
  remindDays: number;
  notes: string | null;
  url: string | null;
  completedOn: string | null;
  /** Day of month the series is anchored to (null on rows from before it existed). */
  anchorDay?: number | null;
}

const d = (col: string) => `to_char(${col}, 'YYYY-MM-DD') as ${col}`;

// ─── Invoices ────────────────────────────────────────────────────────────────

const INVOICE_COLS = `id, business, client, number, amount_minor::text as amount_minor, currency, ${d("issued_on")}, ${d("due_on")}, status, ${d("paid_on")}, notes`;

type InvoiceRow = { id: string; business: string | null; client: string; number: string | null; amount_minor: string; currency: string; issued_on: string | null; due_on: string; status: Invoice["status"]; paid_on: string | null; notes: string | null };
const toInvoice = (r: InvoiceRow): Invoice => ({ id: r.id, business: r.business, client: r.client, number: r.number, amountMinor: Number(r.amount_minor), currency: r.currency, issuedOn: r.issued_on, dueOn: r.due_on, status: r.status, paidOn: r.paid_on, notes: r.notes });

export async function listInvoices(opts: { status?: Invoice["status"]; paidSince?: string } = {}) {
  const db = await getDb();
  const rows = opts.status
    ? await db.query<InvoiceRow>(`select ${INVOICE_COLS} from invoices where status = $1 order by due_on`, [opts.status])
    : await db.query<InvoiceRow>(`select ${INVOICE_COLS} from invoices where status = 'open' or paid_on >= $1::date order by status, due_on`, [opts.paidSince ?? "1970-01-01"]);
  return rows.map(toInvoice);
}

export async function addInvoice(i: Omit<Invoice, "id" | "status" | "paidOn">) {
  const db = await getDb();
  const [row] = await db.query<InvoiceRow>(
    `insert into invoices (business, client, number, amount_minor, currency, issued_on, due_on, notes)
     values ($1, $2, $3, $4::text::bigint, $5, $6::date, $7::date, $8) returning ${INVOICE_COLS}`,
    [i.business, i.client, i.number, String(i.amountMinor), i.currency, i.issuedOn, i.dueOn, i.notes],
  );
  return toInvoice(row);
}

export async function setInvoiceStatus(id: string, status: Invoice["status"], paidOn: string | null) {
  const db = await getDb();
  const rows = await db.query<{ client: string }>(
    "update invoices set status = $2, paid_on = $3::date, updated_at = now() where id = $1 returning client",
    [id, status, status === "paid" ? paidOn : null],
  );
  return rows[0] ?? null;
}

export async function deleteInvoice(id: string) {
  const db = await getDb();
  const rows = await db.query<{ client: string }>("delete from invoices where id = $1 returning client", [id]);
  return rows[0] ?? null;
}

// ─── Subscriptions ───────────────────────────────────────────────────────────

const SUB_COLS = `id, business, vendor, plan, amount_minor::text as amount_minor, currency, billing_interval, ${d("next_renewal")}, auto_renew, url, notes, active, to_char(created_at, 'YYYY-MM-DD') as created_on, to_char(updated_at, 'YYYY-MM-DD') as updated_on`;

type SubRow = { id: string; business: string | null; vendor: string; plan: string | null; amount_minor: string; currency: string; billing_interval: "month" | "year"; next_renewal: string | null; auto_renew: boolean; url: string | null; notes: string | null; active: boolean; created_on?: string | null; updated_on?: string | null };
const toSub = (r: SubRow): Subscription => ({ id: r.id, business: r.business, vendor: r.vendor, plan: r.plan, amountMinor: Number(r.amount_minor), currency: r.currency, interval: r.billing_interval, nextRenewal: r.next_renewal, autoRenew: r.auto_renew, url: r.url, notes: r.notes, active: r.active, ...(r.created_on ? { createdOn: r.created_on } : {}), ...(r.updated_on ? { updatedOn: r.updated_on } : {}) });

export async function listSubscriptions(includeInactive = false) {
  const db = await getDb();
  const rows = await db.query<SubRow>(`select ${SUB_COLS} from subscriptions ${includeInactive ? "" : "where active"} order by active desc, vendor`);
  return rows.map(toSub);
}

export async function saveSubscription(s: Omit<Subscription, "id" | "active"> & { id?: string }) {
  const db = await getDb();
  const params = [s.business, s.vendor, s.plan, String(s.amountMinor), s.currency, s.interval, s.nextRenewal, s.autoRenew, s.url, s.notes];
  const [row] = s.id
    ? await db.query<SubRow>(
        `update subscriptions set business = $1, vendor = $2, plan = $3, amount_minor = $4::text::bigint, currency = $5, billing_interval = $6,
           next_renewal = $7::date, auto_renew = $8, url = $9, notes = $10, updated_at = now() where id = $11 returning ${SUB_COLS}`,
        [...params, s.id],
      )
    : await db.query<SubRow>(
        `insert into subscriptions (business, vendor, plan, amount_minor, currency, billing_interval, next_renewal, auto_renew, url, notes)
         values ($1, $2, $3, $4::text::bigint, $5, $6, $7::date, $8, $9, $10) returning ${SUB_COLS}`,
        params,
      );
  return row ? toSub(row) : null;
}

export async function setSubscriptionActive(id: string, active: boolean) {
  const db = await getDb();
  const rows = await db.query<{ vendor: string }>("update subscriptions set active = $2, updated_at = now() where id = $1 returning vendor", [id, active]);
  return rows[0] ?? null;
}

export async function deleteSubscription(id: string) {
  const db = await getDb();
  const rows = await db.query<{ vendor: string }>("delete from subscriptions where id = $1 returning vendor", [id]);
  return rows[0] ?? null;
}

// ─── Deadlines ───────────────────────────────────────────────────────────────

const DL_COLS = `id, business, title, category, ${d("due_on")}, recurrence, remind_days, notes, url, ${d("completed_on")}, anchor_day`;

type DlRow = { id: string; business: string | null; title: string; category: DeadlineCategory; due_on: string; recurrence: Recurrence; remind_days: number; notes: string | null; url: string | null; completed_on: string | null; anchor_day: number | null };
const toDl = (r: DlRow): Deadline => ({ id: r.id, business: r.business, title: r.title, category: r.category, dueOn: r.due_on, recurrence: r.recurrence, remindDays: Number(r.remind_days), notes: r.notes, url: r.url, completedOn: r.completed_on, anchorDay: r.anchor_day == null ? null : Number(r.anchor_day) });

export async function listDeadlines(includeCompleted = false) {
  const db = await getDb();
  const rows = await db.query<DlRow>(`select ${DL_COLS} from deadlines ${includeCompleted ? "" : "where completed_on is null"} order by completed_on nulls first, due_on`);
  return rows.map(toDl);
}

export async function getDeadline(id: string) {
  const db = await getDb();
  const [row] = await db.query<DlRow>(`select ${DL_COLS} from deadlines where id = $1`, [id]);
  return row ? toDl(row) : null;
}

export async function saveDeadline(x: Omit<Deadline, "id" | "completedOn" | "anchorDay"> & { id?: string }) {
  const db = await getDb();
  // The date the user picks sets the series' day of month (an edit that keeps
  // the date, e.g. Jun 30 of a Mar 31 series, keeps the anchor).
  const params = [x.business, x.title, x.category, x.dueOn, x.recurrence, x.remindDays, x.notes, x.url, Number(x.dueOn.slice(8, 10))];
  const [row] = x.id
    ? await db.query<DlRow>(
        `update deadlines set business = $1, title = $2, category = $3, due_on = $4::date, recurrence = $5, remind_days = $6,
           notes = $7, url = $8, anchor_day = coalesce(case when due_on = $4::date then anchor_day end, $9), updated_at = now()
         where id = $10 returning ${DL_COLS}`,
        [...params, x.id],
      )
    : await db.query<DlRow>(
        `insert into deadlines (business, title, category, due_on, recurrence, remind_days, notes, url, anchor_day)
         values ($1, $2, $3, $4::date, $5, $6, $7, $8, $9) returning ${DL_COLS}`,
        params,
      );
  return row ? toDl(row) : null;
}

/**
 * Marks the current occurrence done. Recurring deadlines move to their next
 * date (only if still at `expectedDue`, so a double click can't skip one);
 * one-off deadlines are completed.
 */
export async function completeDeadline(id: string, completedOn: string, expectedDue?: string) {
  const db = await getDb();
  const cur = await getDeadline(id);
  if (!cur || cur.completedOn) return null;
  if (expectedDue && cur.dueOn !== expectedDue) return null;
  const next = nextOccurrence(cur.dueOn, cur.recurrence, cur.anchorDay);
  const rows = next
    ? await db.query<{ id: string }>("update deadlines set due_on = $2::date, updated_at = now() where id = $1 and due_on = $3::date returning id", [id, next, cur.dueOn])
    : await db.query<{ id: string }>("update deadlines set completed_on = $2::date, updated_at = now() where id = $1 and completed_on is null returning id", [id, completedOn]);
  return rows.length ? { ...cur, next } : null;
}

/**
 * Undoes completing a one-off deadline. Its task, if the user closed it,
 * becomes auto-resolved so the next sync reopens it (when it's still due soon).
 */
export async function reopenDeadline(id: string) {
  const db = await getDb();
  return db.tx(async (tx) => {
    const [row] = await tx.query<{ title: string; due_on: string }>(
      `update deadlines set completed_on = null, updated_at = now() where id = $1 and completed_on is not null returning title, ${d("due_on")}`,
      [id],
    );
    if (!row) return null;
    await tx.query("update tasks set resolved_by = 'auto', updated_at = now() where source_key = $1 and status = 'done'", [`deadlines/${id}:${row.due_on}`]);
    return { title: row.title };
  });
}

export async function deleteDeadline(id: string) {
  const db = await getDb();
  const rows = await db.query<{ title: string }>("delete from deadlines where id = $1 returning title", [id]);
  return rows[0] ?? null;
}
