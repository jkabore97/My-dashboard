import { RefreshCw } from "lucide-react";
import { mailGrants, needsReconnect } from "@/lib/mail/access";
import type { MailboxRef } from "@/lib/mail/types";

const isMs = (m: Pick<MailboxRef, "provider" | "id">) => m.provider === "outlook" || m.id.startsWith("ms:");

/** "O" for Outlook, "G" for Gmail, "S" for the sample mailbox. */
export function ProviderMark({ mailbox }: { mailbox: Pick<MailboxRef, "provider" | "id"> }) {
  const ms = isMs(mailbox);
  const demo = mailbox.provider === "demo";
  return (
    <span title={demo ? "Sample mailbox" : ms ? "Outlook" : "Gmail"} className={`inline-grid h-[17px] w-[17px] shrink-0 place-items-center border font-display text-[10px] font-bold ${demo ? "border-gold text-gold" : ms ? "border-cyan text-cyan" : "border-pink text-pink"}`}>
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
    <div className={`hud-cut flex flex-wrap items-center gap-x-4 gap-y-2 border border-high/50 bg-high/[0.07] px-4 ${compact ? "py-2.5" : "py-3"}`} role="status">
      <p className="min-w-0 flex-1 text-[13px] text-[#ffe2bd]">
        <b className="font-display text-[12px] uppercase tracking-[0.1em] text-high">Reconnect to enable replying</b>
        <span className="block text-[#d9c3a5]">
          {mailbox.address} was connected with read-only access. {canReconnect ? `Sign in to ${ms ? "Microsoft" : "Google"} again with this mailbox to allow organising and sending.` : "Ask the dashboard owner to reconnect it on Platforms."}
        </span>
      </p>
      {canReconnect && (
        <a href={href} className="hud-btn hud-btn-solid inline-flex min-h-10 shrink-0 items-center gap-1.5 px-3 [--b:#ff9f1c]">
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
    return <div className="mt-1 text-[11.5px] text-muted">Mail permissions not recorded yet (they are after its next refresh). If replying from the Inbox fails, reconnect it.</div>;
  }
  const chip = (on: boolean | null, label: string) => <span key={label} className={`px-1.5 py-0.5 font-mono text-[10.5px] ${on ? "bg-emerald/10 text-emerald" : "bg-line/40 text-muted line-through"}`}>{label}</span>;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {chip(g.read, "Read mail")}
      {chip(g.modify, "Organise")}
      {chip(g.send, "Send")}
      {needsReconnect(g) && <span className="text-[11px] font-semibold text-high">Reconnect to enable replying: sign in with this mailbox again.</span>}
    </div>
  );
}
