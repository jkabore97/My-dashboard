import { demoEmails } from "../demo";
import { env, fromSource, getJson } from "../source";
import type { EmailMessage, Severity } from "../types";

// GMAIL_ACCOUNTS="Kaj Consulting:<refresh-token>,Kaj Store:<refresh-token>"
// Each refresh token comes from a one-time OAuth consent with the
// gmail.readonly scope, using GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.
function accounts() {
  return (env("GMAIL_ACCOUNTS") ?? "")
    .split(",")
    .map((pair) => {
      const i = pair.lastIndexOf(":");
      return { label: pair.slice(0, i).trim(), token: pair.slice(i + 1).trim() };
    })
    .filter((a) => a.label && a.token);
}

async function accessToken(refreshToken: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("GOOGLE_CLIENT_ID")!,
      client_secret: env("GOOGLE_CLIENT_SECRET")!,
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

export function getEmails() {
  const list = accounts();
  return fromSource<EmailMessage[]>(
    "Gmail",
    list.length > 0 && !!env("GOOGLE_CLIENT_ID") && !!env("GOOGLE_CLIENT_SECRET"),
    async () => {
      const perAccount = await Promise.all(
        list.map(async ({ label, token }) => {
          const headers = { Authorization: `Bearer ${await accessToken(token)}` };
          const base = "https://gmail.googleapis.com/gmail/v1/users/me/messages";
          const { messages = [] } = await getJson<{ messages?: { id: string }[] }>(
            `${base}?maxResults=25&q=${encodeURIComponent("in:inbox newer_than:14d")}`,
            { headers },
          );
          return Promise.all(
            messages.map(async ({ id }) => {
              const m = await getJson<GmailMessage>(
                `${base}/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
                { headers },
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
                url: `https://mail.google.com/mail/u/0/#inbox/${m.threadId}`,
              };
            }),
          );
        }),
      );
      return perAccount.flat().sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    },
    demoEmails,
  );
}
