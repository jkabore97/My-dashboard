import { demoEmails } from "../demo";
import { gmailAccounts, googleClient } from "../server/credentials";
import { fromSource, getJson } from "../source";
import type { EmailMessage, Severity } from "../types";

// Each mailbox is a refresh token from a one-time OAuth consent with the
// gmail.readonly scope (Platforms → Connect Gmail, or GMAIL_ACCOUNTS).
async function accessToken(client: { id: string; secret: string }, refreshToken: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client.id,
      client_secret: client.secret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Google token refresh failed (${res.status})`);
  return ((await res.json()) as { access_token: string }).access_token;
}

const RULES: [Severity, RegExp][] = [
  ["critical", /dispute|chargeback|security alert|suspicious sign|account (suspended|locked)|payment (failed|declined)|site is down|outage|breach/i],
  ["high", /fail(ed|ure)|expir|overdue|past due|vulnerab|action required|urgent|final notice|declined/i],
  ["low", /newsletter|receipt|invoice is available|digest|webinar|promo|% off|unsubscribe/i],
];

export function classifyEmail(from: string, subject: string, snippet: string, labels: string[]): Severity {
  const text = `${subject} ${snippet}`;
  for (const [severity, re] of RULES) if (re.test(text)) return severity;
  // A real person writing to you outranks automated mail.
  const automated = /no-?reply|notifications?@|mailer|bounce/i.test(from);
  if (!automated || labels.includes("IMPORTANT")) return "medium";
  return "low";
}

interface GmailMessage {
  id: string;
  threadId: string;
  snippet: string;
  labelIds?: string[];
  internalDate: string;
  payload: { headers: { name: string; value: string }[] };
}

export async function getEmails() {
  const list = await gmailAccounts();
  const client = googleClient();
  return fromSource<EmailMessage[]>(
    "Gmail",
    list.length > 0 && !!client,
    async () => {
      // One broken mailbox shouldn't hide the others.
      const settled = await Promise.allSettled(
        list.map(async ({ label, refreshToken, email }) => {
          const headers = { Authorization: `Bearer ${await accessToken(client!, refreshToken)}` };
          const base = "https://gmail.googleapis.com/gmail/v1/users/me/messages";
          // Access tokens differ on every call, so skip the fetch cache here.
          const { messages = [] } = await getJson<{ messages?: { id: string }[] }>(
            `${base}?maxResults=25&q=${encodeURIComponent("in:inbox newer_than:14d")}`,
            { headers, cache: "no-store" },
          );
          return Promise.all(
            messages.map(async ({ id }) => {
              const m = await getJson<GmailMessage>(
                `${base}/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
                { headers, cache: "no-store" },
              );
              const h = (n: string) => m.payload.headers.find((x) => x.name === n)?.value ?? "";
              const labels = m.labelIds ?? [];
              return {
                id: `${label}-${m.id}`,
                from: h("From"),
                subject: h("Subject") || "(no subject)",
                snippet: m.snippet,
                receivedAt: new Date(Number(m.internalDate)).toISOString(),
                unread: labels.includes("UNREAD"),
                account: label,
                labels,
                severity: classifyEmail(h("From"), h("Subject"), m.snippet, labels),
                // authuser picks the right mailbox when several are signed in.
                url: `https://mail.google.com/mail/u/${email ? `?authuser=${encodeURIComponent(email)}` : "0/"}#all/${m.threadId}`,
              };
            }),
          );
        }),
      );
      const ok = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      if (ok.length === 0) throw (settled[0] as PromiseRejectedResult).reason;
      return ok.flat().sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    },
    demoEmails,
  );
}
