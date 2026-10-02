import { demoEmails } from "../demo";
import { gmailAccounts, googleClient } from "../server/credentials";
import { googleAccessToken } from "../server/google";
import { errorMessage, fromSource, getJson } from "../source";
import type { EmailMessage, Severity } from "../types";

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
    async (fail) => {
      // One broken mailbox shouldn't hide the others, but it is reported so
      // its tasks stay open and the UI shows which mailbox needs reconnecting.
      const settled = await Promise.allSettled(
        list.map(async ({ id: mailbox, label, refreshToken, email }) => {
          const headers = { Authorization: `Bearer ${await googleAccessToken(refreshToken)}` };
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
                id: `${mailbox}:${m.id}`,
                from: h("From"),
                subject: h("Subject") || "(no subject)",
                snippet: m.snippet,
                receivedAt: new Date(Number(m.internalDate)).toISOString(),
                unread: labels.includes("UNREAD"),
                account: label,
                mailbox,
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
      settled.forEach((r, i) => r.status === "rejected" && fail(list[i].id, `${list[i].label}: ${errorMessage(r.reason)}`));
      return ok.flat().sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    },
    demoEmails,
  );
}
