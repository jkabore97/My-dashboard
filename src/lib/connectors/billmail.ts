import { detectBill, type BillInput } from "../billing/email";
import type { DetectedBill } from "../billing/types";
import type { GoogleAccount, MicrosoftAccount } from "../server/credentials";
import { googleAccessToken } from "../server/google";
import { graph, msAccessToken } from "../server/microsoft";
import { callSignal, getJson } from "../source";
import { toEmails } from "./outlook";
import { addDays, today as todayFn } from "../dates";

// Bills recognised in SHARED mailboxes only. The latest inbox (already
// fetched for the Inbox) is checked in collect(); this targeted search for
// billing senders over the last ~4 months runs in the background
// (server/billing-refresh.ts). Personal mailboxes are never searched: the
// caller passes microsoftAccounts()/gmailAccounts(), the shared connections,
// and detectBill() also refuses any message that carries an owner.
//
// The search asks for each message's Authentication-Results so a spoofed
// From domain is dropped; inbox messages (no headers) are "unverified".

const SENDERS = [
  "payments-noreply@google.com", "microsoft-noreply@microsoft.com", "vercel.com", "supabase.com", "supabase.io", "github.com", "cloudflare.com", "anthropic.com",
  "stripe.com", "resend.com", "twilio.com", "namecheap.com", "godaddy.com", "squarespace.com", "starlink.com", "apple.com", "zoom.us", "canva.com", "intuit.com", "neon.tech",
];

interface Found {
  bills: DetectedBill[];
  /** Message ids whose sender failed authentication: never shown, even from the inbox listing. */
  rejected: string[];
}

const authOf = (headers: { name?: string; value?: string }[] | undefined) =>
  (headers ?? []).filter((h) => /^(arc-)?authentication-results$/i.test(h.name ?? "")).map((h) => h.value ?? "").join("; ") || null;

function collectBills(inputs: BillInput[]): Found {
  const bills: DetectedBill[] = [];
  const rejected: string[] = [];
  for (const e of inputs) {
    const b = detectBill(e);
    if (b) bills.push(b);
    else if (e.auth && detectBill({ ...e, auth: null })) rejected.push(e.id); // would be a bill, but the sender failed authentication
  }
  return { bills, rejected };
}

/** Graph $search (KQL) across the whole mailbox for billing senders. */
async function searchOutlook(a: MicrosoftAccount, signal?: AbortSignal): Promise<BillInput[]> {
  const token = await msAccessToken(a);
  const kql = `(${SENDERS.map((s) => `from:${s}`).join(" OR ")}) AND (invoice OR receipt OR payment OR billing)`;
  const q = new URLSearchParams({ $search: `"${kql}"`, $top: "40", $select: "id,subject,from,receivedDateTime,isRead,bodyPreview,webLink,importance,internetMessageHeaders" });
  const res = await graph<{ value: (Parameters<typeof toEmails>[1][number] & { internetMessageHeaders?: { name?: string; value?: string }[] })[] }>(token, `/me/messages?${q}`, { ConsistencyLevel: "eventual" }, signal);
  const mails = toEmails(a, res.value);
  return mails.map((m, i) => ({ ...m, auth: authOf(res.value[i].internetMessageHeaders) }));
}

async function searchGmail(a: GoogleAccount, signal?: AbortSignal): Promise<BillInput[]> {
  const headers = { Authorization: `Bearer ${await googleAccessToken(a.refreshToken)}` };
  const base = "https://gmail.googleapis.com/gmail/v1/users/me/messages";
  const q = `from:(${SENDERS.join(" OR ")}) (invoice OR receipt OR payment OR billing) newer_than:120d`;
  const { messages = [] } = await getJson<{ messages?: { id: string }[] }>(`${base}?maxResults=15&q=${encodeURIComponent(q)}`, { headers, cache: "no-store", signal: callSignal(10_000, signal) });
  const settled = await Promise.allSettled(
    messages.map(async ({ id }) => {
      const m = await getJson<{ id: string; threadId: string; snippet: string; internalDate: string; payload: { headers: { name: string; value: string }[] } }>(
        `${base}/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Authentication-Results`,
        { headers, cache: "no-store", signal: callSignal(10_000, signal) },
      );
      const h = (n: string) => m.payload.headers.find((x) => x.name === n)?.value ?? "";
      return {
        id: `${a.id}:${m.id}`, from: h("From"), subject: h("Subject") || "(no subject)", snippet: m.snippet, receivedAt: new Date(Number(m.internalDate)).toISOString(),
        account: a.label, ...(a.business ? { business: a.business } : {}), auth: authOf(m.payload.headers),
        url: `https://mail.google.com/mail/u/${a.email ? `?authuser=${encodeURIComponent(a.email)}` : "0/"}#all/${m.threadId}`,
      } satisfies BillInput;
    }),
  );
  return settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
}

/** The background search over shared mailboxes (each mailbox fails on its own). */
export async function searchBillEmails(ms: MicrosoftAccount[], google: GoogleAccount[], signal?: AbortSignal): Promise<Found> {
  const settled = await Promise.allSettled([...ms.map((a) => searchOutlook(a, signal)), ...google.map((a) => searchGmail(a, signal))]);
  return collectBills(settled.flatMap((r) => (r.status === "fulfilled" ? r.value : [])));
}

/** Searched bills plus any in the current inbox listing, newest first; rejected senders stay out. */
export function mergeBillEmails(searched: Found | null, inbox: BillInput[]): DetectedBill[] {
  const rejected = new Set(searched?.rejected ?? []);
  const byId = new Map<string, DetectedBill>();
  // The searched copy (with its authentication verdict) wins over the inbox one.
  for (const b of collectBills(inbox.filter((e) => !e.owner && !rejected.has(e.id))).bills) byId.set(b.id, b);
  for (const b of searched?.bills ?? []) byId.set(b.id, b);
  return [...byId.values()].sort((a, b) => b.date.localeCompare(a.date) || a.vendor.localeCompare(b.vendor));
}

export function demoBillEmails(): DetectedBill[] {
  const t = todayFn();
  return [
    { id: "demo:ws1", vendor: "Google Workspace", vendorKey: "google-workspace", amountMinor: 3600, currency: "usd", date: addDays(t, -2), interval: "month", verified: true, subject: "Google Workspace: Your invoice is available for kaj.example", account: "Kaj Consulting", business: "Kaj Consulting", url: null },
    { id: "demo:rs1", vendor: "Resend", vendorKey: "resend", amountMinor: 2000, currency: "usd", date: addDays(t, -9), interval: "month", verified: true, subject: "Your receipt from Resend #2231-0042", account: "Kaj Consulting", business: "Kaj Consulting", url: null },
    { id: "demo:sl1", vendor: "Starlink", vendorKey: "starlink", amountMinor: 12000, currency: "usd", date: addDays(t, -15), interval: "month", verified: false, subject: "Your Starlink payment receipt", account: "Kaj Store", business: "Kaj Store", url: null },
  ];
}
