import { microsoftAccounts, type MicrosoftAccount } from "../server/credentials";
import { graph, msAccessToken } from "../server/microsoft";
import { errorMessage, fromSource } from "../source";
import type { EmailMessage } from "../types";
import { classifyEmail } from "./gmail";

interface GraphMessage {
  id: string;
  subject: string | null;
  bodyPreview: string;
  receivedDateTime: string;
  isRead: boolean;
  importance: "low" | "normal" | "high";
  webLink: string;
  from?: { emailAddress?: { name?: string; address?: string } };
}

export const outlookMailbox = (account: string) => `ms:${account}`;

/** Pure: Graph messages → the shared EmailMessage shape. */
export function toEmails(account: { account: string; label: string; business?: string | null; owner?: string }, messages: GraphMessage[]): EmailMessage[] {
  return messages.map((m) => {
    const from = m.from?.emailAddress ? `${m.from.emailAddress.name ?? ""} <${m.from.emailAddress.address ?? ""}>`.trim() : "";
    const labels = m.importance === "high" ? ["IMPORTANT"] : [];
    return {
      id: `${outlookMailbox(account.account)}:${m.id}`,
      from,
      subject: m.subject || "(no subject)",
      snippet: m.bodyPreview.slice(0, 200),
      receivedAt: m.receivedDateTime,
      unread: !m.isRead,
      account: account.label,
      mailbox: outlookMailbox(account.account),
      ...(account.business ? { business: account.business } : {}),
      ...(account.owner ? { owner: account.owner } : {}),
      labels,
      severity: classifyEmail(from, m.subject ?? "", m.bodyPreview, labels),
      url: m.webLink,
    };
  });
}

/** The last 14 days of one account's inbox (25 newest). */
export async function fetchOutlookMail(a: MicrosoftAccount): Promise<EmailMessage[]> {
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const token = await msAccessToken(a);
  const q = new URLSearchParams({
    $top: "25",
    $select: "id,subject,from,receivedDateTime,isRead,bodyPreview,webLink,importance",
    $filter: `receivedDateTime ge ${since}`,
    $orderby: "receivedDateTime desc",
  });
  const res = await graph<{ value: GraphMessage[] }>(token, `/me/mailFolders/inbox/messages?${q}`);
  return toEmails(a, res.value);
}

export async function getOutlook() {
  const accounts = await microsoftAccounts();
  return fromSource<EmailMessage[]>(
    "Outlook",
    accounts.length > 0,
    async (fail) => {
      const settled = await Promise.allSettled(accounts.map(fetchOutlookMail));
      settled.forEach((r, i) => r.status === "rejected" && fail(outlookMailbox(accounts[i].account), `${accounts[i].label}: ${errorMessage(r.reason)}`));
      const ok = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      if (ok.length === 0) throw (settled[0] as PromiseRejectedResult).reason;
      return ok.flat().sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    },
    () => [],
  );
}
