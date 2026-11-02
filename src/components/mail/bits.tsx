import { RefreshCw } from "lucide-react";
import { mailGrants, needsReconnect } from "@/lib/mail/access";
import type { MailboxRef } from "@/lib/mail/types";
import { SYS } from "@/components/ui";

const isMs = (m: Pick<MailboxRef, "provider" | "id">) => m.provider === "outlook" || m.id.startsWith("ms:");

/** "O" for Outlook, "G" for Gmail, "S" for the sample mailbox. */
export function ProviderMark({ mailbox }: { mailbox: Pick<MailboxRef, "provider" | "id"> }) {
  const ms = isMs(mailbox);
  const demo = mailbox.provider === "demo";
  return (
    <span title={demo ? "Sample mailbox" : ms ? "Outlook" : "Gmail"} className="inline-grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] text-[11px] font-bold leading-none text-white" style={{ background: demo ? SYS.gray : ms ? SYS.blue : SYS.pink }}>
      {demo ? "S" : ms ? "O" : "G"}
    </span>
  );
}

/**
 * Shown when a mailbox's token lacks write or send access: it was connected
 * before replying existed (or the permission was unticked). Whoever can fix it
 * gets a button; anyone else is told who can.
 */
export function ReconnectNotice({ mailbox, canReconnect, compact = false }: { mailbox: MailboxRef; canReconnect: boolean; compact?: boolean }) {
  const ms = isMs(mailbox);
  const href = `/api/connect/${ms ? "microsoft" : "gmail"}${mailbox.owner ? "?mine=1" : ""}`;
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[14px] bg-high/12 px-4 ${compact ? "py-2.5" : "py-3"}`} role="status">
      <p className="min-w-0 flex-1 text-[15px] text-ink">
        <b className="font-semibold text-warn">Reconnect to enable replying</b>
        <span className="mt-0.5 block text-[13px] text-muted">
          {mailbox.address} was connected with read-only access. {canReconnect ? `Sign in to ${ms ? "Microsoft" : "Google"} again with this mailbox to allow organising and sending.` : "Ask the dashboard owner to reconnect it on Platforms."}
        </span>
      </p>
      {canReconnect && (
        <a href={href} className="hud-btn hud-btn-solid min-h-10 shrink-0 rounded-full px-4">
          <RefreshCw size={14} />Reconnect
        </a>
      )}
    </div>
  );
}

/** What a mailbox connection may do (Platforms, Settings): read, organise, send, from the scopes it was granted. */
export function MailAccessChips({ provider, scopes }: { provider: "outlook" | "gmail"; scopes: string[] | null }) {
  const g = mailGrants(provider, scopes);
  if (g.read === null) {
    return <div className="mt-1 text-[12.5px] text-muted">Mail permissions not recorded yet (they are after its next refresh). If replying from the Inbox fails, reconnect it.</div>;
  }
  const chip = (on: boolean | null, label: string) => <span key={label} className={`rounded-full px-2 py-0.5 text-[12px] font-medium ${on ? "bg-ok/12 text-ok" : "bg-fill text-muted line-through"}`}>{label}</span>;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {chip(g.read, "Read mail")}
      {chip(g.modify, "Organise")}
      {chip(g.send, "Send")}
      {needsReconnect(g) && <span className="text-[12.5px] font-medium text-warn">Reconnect to enable replying: sign in with this mailbox again.</span>}
    </div>
  );
}
