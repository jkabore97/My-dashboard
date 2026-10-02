"use server";

import { revalidatePath } from "next/cache";
import { businessDenied, requireOwner, requireSection } from "@/lib/server/auth";
import { rowBusiness, type OwnedTable } from "@/lib/server/store/ownership";
import { businessForDomain, getConfig, parseDomainList } from "@/lib/server/config";
import { inBusiness } from "@/lib/access";
import { refreshDomainChecks } from "@/lib/server/domains";
import { audit } from "@/lib/server/store/audit";
import { requestSync } from "@/lib/server/sync";
import { addInvoice, completeDeadline, deleteDeadline, reopenDeadline, deleteInvoice, deleteSubscription, saveDeadline, saveSubscription, setInvoiceStatus, setSubscriptionActive, type DeadlineCategory } from "@/lib/server/store/ledger";
import { getSetting, setSetting } from "@/lib/server/store/settings";
import { isDate, today, type Recurrence } from "@/lib/dates";
import { decimals, parseAmount } from "@/lib/money";
import { ACCOUNT_CHECKLIST } from "@/lib/security-checklist";

export interface RecordState {
  error?: string;
  ok?: string;
  at?: number;
}

const text = (f: FormData, k: string, max: number) => String(f.get(k) ?? "").trim().slice(0, max);
const optional = (f: FormData, k: string, max: number) => text(f, k, max) || null;
const CURRENCY = /^[a-z]{3}$/;
// Records feed derived tasks, so a change also asks for an immediate re-sync.
async function refresh() {
  await requestSync();
  revalidatePath("/", "layout");
}

/** May this user change that record? (Its section, and its current business.) */
async function canChange(section: "money" | "deadlines", table: OwnedTable, id: string) {
  const user = await requireSection(section);
  return { user, ok: !businessDenied(user, await rowBusiness(table, id)) };
}

const decimalsNote = (currency: string) => ` (${currency.toUpperCase()} uses ${decimals(currency) || "no"} decimals)`;

function currencyOf(f: FormData) {
  const c = text(f, "currency", 3).toLowerCase() || "usd";
  return CURRENCY.test(c) ? c : null;
}

function urlOf(f: FormData): string | null | false {
  const u = text(f, "url", 500);
  if (!u) return null;
  return /^https?:\/\/[^\s]+$/i.test(u) ? u : false;
}

// ─── Invoices ────────────────────────────────────────────────────────────────

export async function addInvoiceAction(_prev: RecordState, f: FormData): Promise<RecordState> {
  const user = await requireSection("money");
  const denied = businessDenied(user, optional(f, "business", 80));
  if (denied) return { error: denied };
  const client = text(f, "client", 120);
  const currency = currencyOf(f);
  const dueOn = text(f, "dueOn", 10);
  const issuedOn = optional(f, "issuedOn", 10);
  if (!client) return { error: "Who is the invoice for?" };
  if (!currency) return { error: "Currency must be a 3-letter code like USD." };
  const amount = parseAmount(text(f, "amount", 20), currency);
  if (amount === null || amount <= 0) return { error: `Enter the amount, e.g. 1250.00${decimalsNote(currency)}` };
  if (!isDate(dueOn)) return { error: "Pick a due date." };
  if (issuedOn && !isDate(issuedOn)) return { error: "The issue date isn't valid." };
  const inv = await addInvoice({ client, currency, amountMinor: amount, dueOn, issuedOn, business: optional(f, "business", 80), number: optional(f, "number", 40), notes: optional(f, "notes", 500) });
  await audit(user.email, "invoice.create", client, { id: inv.id, amount, currency });
  await refresh();
  return { ok: `Invoice for ${client} added.`, at: Date.now() };
}

export async function markInvoiceAction(id: string, status: "paid" | "open" | "void") {
  const { user, ok } = await canChange("money", "invoices", id);
  if (!ok) return;
  if (!["paid", "open", "void"].includes(status)) return;
  const row = await setInvoiceStatus(id, status, today());
  if (row) await audit(user.email, `invoice.${status}`, row.client, { id });
  await refresh();
}

export async function deleteInvoiceAction(id: string) {
  const { user, ok } = await canChange("money", "invoices", id);
  if (!ok) return;
  const row = await deleteInvoice(id);
  if (row) await audit(user.email, "invoice.delete", row.client, { id });
  await refresh();
}

// ─── Subscriptions ───────────────────────────────────────────────────────────

export async function saveSubscriptionAction(_prev: RecordState, f: FormData): Promise<RecordState> {
  const user = await requireSection("money");
  const id = optional(f, "id", 36);
  const denied = businessDenied(user, optional(f, "business", 80), id ? await rowBusiness("subscriptions", id) : undefined);
  if (denied) return { error: denied };
  const vendor = text(f, "vendor", 80);
  const currency = currencyOf(f);
  const interval = text(f, "interval", 5);
  const nextRenewal = optional(f, "nextRenewal", 10);
  const url = urlOf(f);
  if (!vendor) return { error: "Name the service, e.g. Vercel." };
  if (!currency) return { error: "Currency must be a 3-letter code like USD." };
  const amount = parseAmount(text(f, "amount", 20), currency);
  if (amount === null) return { error: `Enter what it costs per billing period, e.g. 20.00${decimalsNote(currency)}` };
  if (interval !== "month" && interval !== "year") return { error: "Pick monthly or yearly billing." };
  if (nextRenewal && !isDate(nextRenewal)) return { error: "The renewal date isn't valid." };
  if (url === false) return { error: "Links must start with http:// or https://" };
  const saved = await saveSubscription({ id: id ?? undefined, vendor, currency, amountMinor: amount, interval, nextRenewal, autoRenew: f.get("autoRenew") === "on", business: optional(f, "business", 80), plan: optional(f, "plan", 80), url, notes: optional(f, "notes", 500) });
  if (!saved) return { error: "That subscription no longer exists." };
  await audit(user.email, id ? "subscription.update" : "subscription.create", vendor, { id: saved.id, amount, currency, interval });
  await refresh();
  return { ok: `${vendor} saved.`, at: Date.now() };
}

export async function setSubscriptionActiveAction(id: string, active: boolean) {
  const { user, ok } = await canChange("money", "subscriptions", id);
  if (!ok) return;
  const row = await setSubscriptionActive(id, active);
  if (row) await audit(user.email, active ? "subscription.reactivate" : "subscription.deactivate", row.vendor, { id });
  await refresh();
}

export async function deleteSubscriptionAction(id: string) {
  const { user, ok } = await canChange("money", "subscriptions", id);
  if (!ok) return;
  const row = await deleteSubscription(id);
  if (row) await audit(user.email, "subscription.delete", row.vendor, { id });
  await refresh();
}

// ─── Deadlines ───────────────────────────────────────────────────────────────

const CATEGORIES: DeadlineCategory[] = ["tax", "filing", "license", "insurance", "contract", "other"];
const RECURRENCES: Recurrence[] = ["none", "monthly", "quarterly", "yearly"];

export async function saveDeadlineAction(_prev: RecordState, f: FormData): Promise<RecordState> {
  const user = await requireSection("deadlines");
  const id = optional(f, "id", 36);
  const denied = businessDenied(user, optional(f, "business", 80), id ? await rowBusiness("deadlines", id) : undefined);
  if (denied) return { error: denied };
  const title = text(f, "title", 160);
  const dueOn = text(f, "dueOn", 10);
  const category = text(f, "category", 20) as DeadlineCategory;
  const recurrence = text(f, "recurrence", 20) as Recurrence;
  const remindDays = Number(text(f, "remindDays", 3) || "14");
  const url = urlOf(f);
  if (!title) return { error: "What's due?" };
  if (!isDate(dueOn)) return { error: "Pick a due date." };
  if (!CATEGORIES.includes(category)) return { error: "Pick a category." };
  if (!RECURRENCES.includes(recurrence)) return { error: "Pick how often it repeats." };
  if (!Number.isInteger(remindDays) || remindDays < 0 || remindDays > 365) return { error: "Remind between 0 and 365 days ahead." };
  if (url === false) return { error: "Links must start with http:// or https://" };
  const saved = await saveDeadline({ id: id ?? undefined, title, dueOn, category, recurrence, remindDays, business: optional(f, "business", 80), notes: optional(f, "notes", 500), url });
  if (!saved) return { error: "That deadline no longer exists." };
  await audit(user.email, id ? "deadline.update" : "deadline.create", title, { id: saved.id, dueOn, recurrence });
  await refresh();
  return { ok: `"${title}" saved.`, at: Date.now() };
}

export async function completeDeadlineAction(id: string, dueOn: string) {
  const { user, ok } = await canChange("deadlines", "deadlines", id);
  if (!ok) return;
  const done = await completeDeadline(id, today(), dueOn);
  if (done) await audit(user.email, "deadline.complete", done.title, { id, dueOn, next: done.next });
  await refresh();
}

export async function reopenDeadlineAction(id: string) {
  const { user, ok } = await canChange("deadlines", "deadlines", id);
  if (!ok) return;
  const row = await reopenDeadline(id);
  if (row) await audit(user.email, "deadline.reopen", row.title, { id });
  await refresh();
}

export async function deleteDeadlineAction(id: string) {
  const { user, ok } = await canChange("deadlines", "deadlines", id);
  if (!ok) return;
  const row = await deleteDeadline(id);
  if (row) await audit(user.email, "deadline.delete", row.title, { id });
  await refresh();
}

// ─── Domains ─────────────────────────────────────────────────────────────────

const DOMAIN = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const SELECTOR = /^[a-z0-9]([a-z0-9._-]{0,62})$/i;

export async function saveDomainSettingsAction(_prev: RecordState, f: FormData): Promise<RecordState> {
  const user = await requireOwner();
  const domains = parseDomainList(text(f, "domains", 5000));
  const bad = domains.find((d) => !DOMAIN.test(d));
  if (bad) return { error: `"${bad}" doesn't look like a domain name.` };
  const selectors = [...new Set(text(f, "selectors", 1000).split(/[\s,]+/).filter(Boolean))];
  const badSel = selectors.find((s) => !SELECTOR.test(s));
  if (badSel) return { error: `"${badSel}" isn't a valid DKIM selector.` };
  if (domains.length > 50 || selectors.length > 20) return { error: "That's more than this page can check (50 domains, 20 selectors)." };
  await setSetting("domains_extra", domains);
  if (selectors.length) await setSetting("dkim_selectors", selectors);
  await audit(user.email, "settings.domains", null, { domains: domains.length, selectors: selectors.length });
  await refresh();
  return { ok: "Saved. New domains are checked on the next run, or use Check now.", at: Date.now() };
}

export async function checkDomainsNowAction(): Promise<RecordState> {
  const user = await requireSection("domains");
  const { domains: all, dkimSelectors, sites } = await getConfig();
  // A teammate limited to some businesses only re-checks those businesses' domains.
  const domains = user.businesses === null ? all : all.filter((d) => inBusiness(user, businessForDomain(d, sites)));
  // Forced checks still wait a minute per domain, so repeated clicks can't hammer registries.
  const n = await refreshDomainChecks(domains, dkimSelectors, { force: true, deadline: Date.now() + 30_000 });
  await audit(user.email, "domains.check", null, { checked: n });
  await refresh();
  return n ? { ok: `Checked ${n} domain${n === 1 ? "" : "s"}.`, at: Date.now() } : { ok: "Everything was checked in the last minute.", at: Date.now() };
}

// ─── Security checklist ──────────────────────────────────────────────────────

export async function confirmChecklistAction(itemId: string, confirmed: boolean) {
  const user = await requireOwner();
  if (!ACCOUNT_CHECKLIST.some((i) => i.id === itemId)) return;
  const current = await getSetting<Record<string, string>>("security_checklist", {});
  const next = { ...current };
  if (confirmed) next[itemId] = new Date().toISOString();
  else delete next[itemId];
  await setSetting("security_checklist", next);
  await audit(user.email, confirmed ? "security.checklist.confirm" : "security.checklist.unconfirm", itemId);
  await refresh();
}
