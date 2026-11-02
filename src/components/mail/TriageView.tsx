import Link from "next/link";
import type { ReactNode } from "react";
import { ExternalLink, MailOpen, Reply, Sparkles } from "lucide-react";
import { BizLabel, Empty, SeverityBadge, SYS, Tag, timeAgo } from "@/components/ui";
import { DraftReply } from "@/components/ai/DraftReply";
import { Chip, ChipRow, Donut, KpiStrip, KV, SEV_COLOR, ab, type Kpi } from "@/components/command/hud";
import { inboxStats } from "@/components/command/logic";
import type { EmailMessage } from "@/lib/types";
import { ProviderMark } from "./bits";

const provider = (mailbox: string) => (mailbox.startsWith("ms:") ? "Outlook" : "Gmail");
const markFor = (mailbox: string) => ({ id: mailbox, provider: mailbox.startsWith("ms:") ? ("outlook" as const) : mailbox.startsWith("demo:") ? ("demo" as const) : ("gmail" as const) });

/** Rounded group with a 17px title row (Mail-style list container). */
function ListGroup({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-[14px] bg-panel shadow-[0_0_0_1px_var(--color-line)]">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-line px-4 py-3 sm:px-5">
        <h2 className="min-w-0 truncate text-[17px] font-semibold text-ink">{title}</h2>
        {note && <span className="text-[13px] text-muted">{note}</span>}
      </header>
      {children}
    </section>
  );
}

/**
 * The triage view: the last 14 days of every mailbox the person can see, from
 * the dashboard's summary (what alerts and to-dos are made from), ranked by
 * urgency and read by Claude when AI is on. Each message opens in the mail client.
 */
export function TriageView({ emails, account, ai, hrefFor, canReply }: { emails: EmailMessage[]; account?: string; ai: boolean; hrefFor: (e: EmailMessage) => string | null; canReply: (e: EmailMessage) => boolean }) {
  const stats = inboxStats(emails);
  const shown = account ? emails.filter((e) => e.account === account) : emails;
  const high = emails.filter((e) => e.severity === "high").length;
  const gmail = stats.mailboxes.filter((m) => m.provider === "gmail").length;
  const outlook = stats.mailboxes.length - gmail;
  const firstCritical = emails.find((e) => e.severity === "critical");

  const kpis: Kpi[] = [
    { label: "Unread", value: stats.unread, hint: `of ${stats.total} in the last 14 days`, c1: SYS.gray },
    ...(ai ? [{ label: "Needs reply", value: stats.needsReply, hint: `Claude flagged · ${stats.triaged} read`, c1: SYS.gray }] : []),
    { label: "Critical", value: stats.critical, hint: firstCritical ? firstCritical.subject : "Nothing urgent", c1: stats.critical ? SEV_COLOR.critical : SYS.gray },
    { label: "High", value: high, hint: high ? "worth a look today" : "none", c1: high ? SEV_COLOR.high : SYS.gray },
    { label: "Mailboxes", value: stats.mailboxes.length, hint: [gmail ? `${gmail} Gmail` : null, outlook ? `${outlook} Outlook` : null].filter(Boolean).join(" · ") || "none connected", c1: SYS.gray },
  ];

  return (
    <>
      <KpiStrip items={kpis} className="mb-5" />

      {stats.mailboxes.length > 1 && (
        <div className="mb-5">
          <ChipRow label="Account">
            <Chip href="/inbox?view=triage" active={!account} count={stats.unread}>All accounts</Chip>
            {stats.mailboxes.map((m) => (
              <Chip key={m.account} href={`/inbox?view=triage&account=${encodeURIComponent(m.account)}`} active={account === m.account} count={m.unread}>
                <ProviderMark mailbox={markFor(m.mailbox)} />
                <span>{m.account}</span>
              </Chip>
            ))}
          </ChipRow>
        </div>
      )}

      <div className="grid items-start gap-7 xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-8">
        <ListGroup title={account ?? "All accounts"} note={`${shown.length} message${shown.length === 1 ? "" : "s"} · newest first${ai ? " · triaged by Claude" : ""}`}>
          {shown.length === 0 ? <Empty>No mail in the last 14 days.</Empty> : (
            <ul className="[&>li+li>div>div]:border-t [&>li+li>div>div]:border-line">
              {shown.map((e) => {
                const href = hrefFor(e);
                const subjectCls = `min-w-0 text-[15px] text-ink hover:text-cyan sm:truncate ${e.unread ? "font-semibold" : "font-medium"}`;
                return (
                  <li key={e.id}>
                    <div className="flex gap-2.5 pl-2.5 sm:pl-3">
                      <span className="mt-[19px] flex w-3 shrink-0 justify-center self-start" aria-label={e.unread ? "Unread" : undefined}>
                        {e.unread && <span className="h-2.5 w-2.5 rounded-full bg-cyan" />}
                      </span>
                      <div className="min-w-0 flex-1 py-3 pr-4 sm:pr-5">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className={`min-w-0 truncate text-[15px] text-ink ${e.unread ? "font-semibold" : "font-medium"}`}>{e.from}</span>
                          <span className="shrink-0 text-[13px] tabular-nums text-muted">{timeAgo(e.receivedAt)}</span>
                        </div>
                        <div className="flex min-w-0 items-baseline gap-2">
                          {(e.severity === "critical" || e.severity === "high") && <SeverityBadge severity={e.severity} />}
                          {href ? (
                            <Link href={href} prefetch={false} className={subjectCls}>{e.subject}</Link>
                          ) : (
                            <a href={e.url} target="_blank" rel="noreferrer" className={subjectCls}>{e.subject}</a>
                          )}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-muted">
                          <span className="min-w-0 truncate">{e.account}</span>
                          {e.owner ? <Tag color={SYS.blue} title="Your own mailbox: only you see it">Mine</Tag> : null}
                        </div>
                        {e.triage ? (
                          <div className="mt-2 rounded-[10px] bg-panel-2 px-3 py-2 text-[14px] leading-snug text-ink">
                            <Sparkles size={13} className="mr-1.5 inline -translate-y-px text-violet" aria-hidden />
                            {e.triage.summary}
                            {e.triage.task ? <span className="text-muted"> · To do: <b className="font-semibold text-ink">{e.triage.task}</b></span> : null}
                          </div>
                        ) : (
                          <div className="mt-0.5 line-clamp-2 text-[14px] leading-snug text-muted">{e.snippet}</div>
                        )}
                        {href && (e.unread || e.severity === "critical") ? (
                          <div className="mt-2.5 flex flex-wrap gap-2">
                            {canReply(e) && <Link href={`${href}?compose=reply`} prefetch={false} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-cyan px-3.5 text-[13px] font-semibold text-white transition hover:brightness-110 active:opacity-80 sm:min-h-8"><Reply size={14} />Reply</Link>}
                            <Link href={href} prefetch={false} className={`${ab} rounded-full`}><MailOpen size={14} />Open</Link>
                          </div>
                        ) : ai && (!e.triage || e.triage.needsReply) && e.unread ? (
                          <DraftReply emailId={e.id} url={e.url} provider={provider(e.mailbox)} />
                        ) : e.url && (e.unread || e.severity === "critical") ? (
                          <div className="mt-2.5"><a href={e.url} target="_blank" rel="noreferrer" className={`${ab} rounded-full`}><ExternalLink size={14} />Open in {provider(e.mailbox)}</a></div>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </ListGroup>

        <aside className="grid min-w-0 gap-7">
          {ai && stats.triaged > 0 && (
            <ListGroup title="Claude triage" note="last 14 days">
              <div className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-4 px-4 py-4 sm:px-5">
                <Donut
                  size={110}
                  value={stats.triaged}
                  label="Read"
                  parts={[
                    { value: stats.needsReply, color: SYS.blue },
                    { value: stats.withTask, color: SYS.indigo },
                    { value: stats.fyi, color: SYS.teal },
                  ]}
                />
                <div className="min-w-0">
                  <KV k="Needs reply" v={stats.needsReply} dot={SYS.blue} />
                  <KV k="Has a to-do" v={stats.withTask} dot={SYS.indigo} />
                  <KV k="FYI only" v={stats.fyi} dot={SYS.teal} />
                  {stats.total > stats.triaged && <KV k="Not read yet" v={stats.total - stats.triaged} dot={SYS.gray} />}
                </div>
              </div>
            </ListGroup>
          )}
          <section className="min-w-0">
            <div className="mb-1.5 flex items-baseline justify-between gap-2 px-4">
              <h3 className="text-[13px] uppercase tracking-[0.02em] text-muted">Mailboxes</h3>
              <span className="text-[13px] text-muted">unread · 14 days</span>
            </div>
            <div className="overflow-hidden rounded-[14px] bg-panel shadow-[0_0_0_1px_var(--color-line)] [&>*+*]:border-t [&>*+*]:border-line">
              {stats.mailboxes.length === 0 ? <Empty>No mailbox connected.</Empty> : stats.mailboxes.map((m) => (
                <Link key={m.account} href={`/inbox?view=triage&account=${encodeURIComponent(m.account)}`} className="flex min-h-12 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-fill">
                  <ProviderMark mailbox={markFor(m.mailbox)} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] text-ink">{m.account}</div>
                    <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[13px] text-muted">
                      {m.business && <><BizLabel name={m.business} /><span>·</span></>}
                      <span>{m.provider === "outlook" ? "Outlook" : "Gmail"} · {m.total} in 14 days</span>
                    </div>
                  </div>
                  <span className={`shrink-0 text-[15px] tabular-nums ${m.unread ? "font-semibold text-cyan" : "text-muted"}`}>{m.unread}</span>
                </Link>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
