import { createHash } from "node:crypto";
import { detectBills } from "../billing/email";
import type { DetectedBill } from "../billing/types";
import { gmailAccounts, googleClient, microsoftAccounts, type GoogleAccount, type MicrosoftAccount } from "../server/credentials";
import { googleAccessToken } from "../server/google";
import { graph, msAccessToken } from "../server/microsoft";
import { HOUR, slowCached } from "../server/slow-cache";
import { fromSource, getJson } from "../source";
import type { EmailMessage } from "../types";
import { toEmails } from "./outlook";
import { addDays, today as todayFn } from "../dates";

// Bills recognised in SHARED mailboxes only. The latest inbox (already
// fetched for the Inbox) is checked every refresh; a targeted search for
// billing senders over the last ~4 months runs every six hours. Personal
// mailboxes are never searched (only microsoftAccounts()/gmailAccounts(),
// which are the shared connections, are used) and detectBill() also refuses
// any message that carries an owner.

const SENDERS = [
  "payments-noreply@google.com", "microsoft-noreply@microsoft.com", "vercel.com", "supabase.com", "supabase.io", "github.com", "cloudflare.com", "anthropic.com",
  "stripe.com", "resend.com", "twilio.com", "namecheap.com", "godaddy.com", "squarespace.com", "starlink.com", "apple.com", "zoom.us", "canva.com", "intuit.com", "neon.tech",
];

/** Graph $search (KQL) across the whole mailbox for billing senders. */
async function searchOutlook(a: MicrosoftAccount): Promise<EmailMessage[]> {
  const token = await msAccessToken(a);
  const kql = `(${SENDERS.map((s) => `from:${s}`).join(" OR ")}) AND (invoice OR receipt OR payment OR billing)`;
  const q = new URLSearchParams({ $search: `"${kql}"`, $top: "50", $select: "id,subject,from,receivedDateTime,isRead,bodyPreview,webLink,importance" });
  const res = await graph<{ value: Parameters<typeof toEmails>[1] }>(token, `/me/messages?${q}`, { ConsistencyLevel: "eventual" });
  return toEmails(a, res.value);
}

async function searchGmail(a: GoogleAccount): Promise<EmailMessage[]> {
  const headers = { Authorization: `Bearer ${await googleAccessToken(a.refreshToken)}` };
  const base = "https://gmail.googleapis.com/gmail/v1/users/me/messages";
  const q = `from:(${SENDERS.join(" OR ")}) (invoice OR receipt OR payment OR billing) newer_than:120d`;
  const { messages = [] } = await getJson<{ messages?: { id: string }[] }>(`${base}?maxResults=30&q=${encodeURIComponent(q)}`, { headers, cache: "no-store" });
  return Promise.all(
    messages.map(async ({ id }) => {
      const m = await getJson<{ id: string; threadId: string; snippet: string; internalDate: string; payload: { headers: { name: string; value: string }[] } }>(`${base}/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`, { headers, cache: "no-store" });
      const h = (n: string) => m.payload.headers.find((x) => x.name === n)?.value ?? "";
      return {
        id: `${a.id}:${m.id}`, from: h("From"), subject: h("Subject") || "(no subject)", snippet: m.snippet, receivedAt: new Date(Number(m.internalDate)).toISOString(), unread: false,
        account: a.label, mailbox: a.id, labels: [], severity: "low" as const, ...(a.business ? { business: a.business } : {}),
        url: `https://mail.google.com/mail/u/${a.email ? `?authuser=${encodeURIComponent(a.email)}` : "0/"}#all/${m.threadId}`,
      };
    }),
  );
}

/** `inbox`: the shared mail already fetched this round. */
export async function getBillEmails(inbox: EmailMessage[]) {
  const [ms, google] = await Promise.all([microsoftAccounts(), googleClient() ? gmailAccounts() : Promise.resolve([] as GoogleAccount[])]);
  return fromSource<DetectedBill[]>(
    "Billing e-mails",
    ms.length + google.length > 0,
    async () => {
      const ids = [...ms.map((a) => `ms:${a.account}`), ...google.map((a) => a.id)].sort();
      const searched = await slowCached(
        "bill-emails",
        ids.map((i) => createHash("sha256").update(i).digest("hex")),
        async () => {
          const settled = await Promise.allSettled([...ms.map(searchOutlook), ...google.map(searchGmail)]);
          // Only what's needed for detection is kept.
          return detectBills(settled.flatMap((r) => (r.status === "fulfilled" ? r.value : [])));
        },
        () => 6 * HOUR,
      );
      const recent = detectBills(inbox.filter((e) => !e.owner));
      const byId = new Map([...searched, ...recent].map((b) => [b.id, b]));
      return [...byId.values()].sort((a, b) => b.date.localeCompare(a.date) || a.vendor.localeCompare(b.vendor));
    },
    demoBillEmails,
  );
}

export function demoBillEmails(): DetectedBill[] {
  const t = todayFn();
  return [
    { id: "demo:ws1", vendor: "Google Workspace", vendorKey: "google-workspace", amountMinor: 3600, currency: "usd", date: addDays(t, -2), interval: "month", subject: "Google Workspace: Your invoice is available for kaj.example", account: "Kaj Consulting", business: "Kaj Consulting", url: null },
    { id: "demo:rs1", vendor: "Resend", vendorKey: "resend", amountMinor: 2000, currency: "usd", date: addDays(t, -9), interval: "month", subject: "Your receipt from Resend #2231-0042", account: "Kaj Consulting", business: "Kaj Consulting", url: null },
    { id: "demo:sl1", vendor: "Starlink", vendorKey: "starlink", amountMinor: 12000, currency: "usd", date: addDays(t, -15), interval: "month", subject: "Your Starlink payment receipt", account: "Kaj Store", business: "Kaj Store", url: null },
  ];
}
