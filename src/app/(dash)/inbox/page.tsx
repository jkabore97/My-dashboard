import { requireSection } from "@/lib/server/auth";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { getDashboard } from "@/lib/server/dashboard";
import { Card, Empty, PageHeader, SeverityBadge, businessColor, timeAgo } from "@/components/ui";
import { DraftReply } from "@/components/ai/DraftReply";
import { aiEnabled } from "@/lib/server/ai";
import { Chip, ChipRow, Donut, KpiStrip, KV, ab, type Kpi } from "@/components/command/hud";
import { inboxStats } from "@/components/command/logic";

const provider = (mailbox: string) => (mailbox.startsWith("ms:") ? "Outlook" : "Gmail");

function ProviderMark({ mailbox }: { mailbox: string }) {
  const ms = mailbox.startsWith("ms:");
  return (
    <span title={provider(mailbox)} className={`inline-grid h-[17px] w-[17px] shrink-0 place-items-center border font-display text-[10px] font-bold ${ms ? "border-cyan text-cyan" : "border-pink text-pink"}`}>
      {ms ? "O" : "G"}
    </span>
  );
}

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  await requireSection("inbox");
  const { account } = await searchParams;
  const s = await getDashboard();
  const stats = inboxStats(s.emails);
  const emails = account ? s.emails.filter((e) => e.account === account) : s.emails;
  const ai = aiEnabled() && s.modes.inbox === "live";
  const high = s.emails.filter((e) => e.severity === "high").length;
  const gmail = stats.mailboxes.filter((m) => m.provider === "gmail").length;
  const outlook = stats.mailboxes.length - gmail;
  const firstCritical = s.emails.find((e) => e.severity === "critical");

  const kpis: Kpi[] = [
    { label: "Unread", value: stats.unread, hint: `of ${stats.total} in the last 14 days`, c1: "#3fd0ff", c2: "#a98bff" },
    ...(ai ? [{ label: "Needs reply", value: stats.needsReply, hint: `Claude flagged · ${stats.triaged} read`, c1: "#ff5fd7", c2: "#a98bff" }] : []),
    { label: "Critical", value: stats.critical, hint: firstCritical ? firstCritical.subject : "nothing urgent", c1: stats.critical ? "#ff3d6e" : "#3df5a0", c2: stats.critical ? "#ff9f1c" : "#2ef2d0" },
    { label: "High", value: high, hint: high ? "worth a look today" : "none", c1: high ? "#ff9f1c" : "#3df5a0", c2: high ? "#ffc56b" : "#2ef2d0" },
    { label: "Mailboxes", value: stats.mailboxes.length, hint: [gmail ? `${gmail} Gmail` : null, outlook ? `${outlook} Outlook` : null].filter(Boolean).join(" · ") || "none connected", c1: "#ffd84d", c2: "#ff9f6b" },
  ];

  return (
    <>
      <PageHeader mode={s.modes.inbox} title="Inbox" subtitle={`Every business mailbox in one list, triaged by urgency${ai ? " (read by Claude)" : ""}. Replies open in Gmail or Outlook.`} />
      <KpiStrip items={kpis} accent="#ff5fd7" className="mb-5" />

      {stats.mailboxes.length > 1 && (
        <div className="mb-5">
          <ChipRow label="Account">
            <Chip href="/inbox" active={!account} count={stats.unread}>All accounts</Chip>
            {stats.mailboxes.map((m) => (
              <Chip key={m.account} href={`/inbox?account=${encodeURIComponent(m.account)}`} active={account === m.account} count={m.unread}>
                <ProviderMark mailbox={m.mailbox} />
                <span className="font-sans normal-case tracking-normal">{m.account}</span>
              </Chip>
            ))}
          </ChipRow>
        </div>
      )}

      <div className="grid items-start gap-4 lg:gap-[22px] xl:grid-cols-[minmax(0,1fr)_330px]">
        <Card title={`${account ?? "All accounts"} · newest first`} accent="pink" flush action={`${emails.length} message${emails.length === 1 ? "" : "s"}${ai ? " · triaged by Claude" : ""}`}>
          {emails.length === 0 ? <Empty>No mail in the last 14 days.</Empty> : (
            <ul>
              {emails.map((e) => (
                <li key={e.id} className="grid grid-cols-[8px_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-b border-line/50 px-4 py-3.5 last:border-0 sm:grid-cols-[10px_84px_minmax(0,1fr)] sm:px-5">
                  <span className={`row-span-2 mt-2 h-2 w-2 rounded-full sm:row-span-1 ${e.unread ? "bg-cyan shadow-[0_0_8px_#3fd0ff]" : ""}`} aria-label={e.unread ? "Unread" : undefined} />
                  <span className="justify-self-start sm:mt-0.5"><SeverityBadge severity={e.severity} /></span>
                  <div className="col-start-2 min-w-0 sm:col-start-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <a href={e.url} target="_blank" rel="noreferrer" className={`min-w-0 text-[14.5px] hover:text-cyan sm:truncate ${e.unread ? "font-medium text-[#f2faff]" : "text-[#b7c7d4]"}`}>{e.subject}</a>
                      <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-muted">{timeAgo(e.receivedAt)}</span>
                    </div>
                    <div className="truncate text-[12.5px] text-muted"><span className="text-[#c5d3de]">{e.from}</span> · {e.account}</div>
                    {e.triage ? (
                      <div className="mt-2 border-l-2 border-violet bg-violet/[0.07] px-2.5 py-1.5 text-[13px] leading-relaxed text-[#c9d8e4]">
                        <span className="mr-1.5 text-violet">✦</span>{e.triage.summary}
                        {e.triage.task ? <span className="text-muted"> · To do: <b className="font-medium text-lime">{e.triage.task}</b></span> : null}
                      </div>
                    ) : (
                      <div className="mt-1 line-clamp-1 text-[12.5px] text-[#8197a8]">{e.snippet}</div>
                    )}
                    {ai && (!e.triage || e.triage.needsReply) && e.unread ? (
                      <DraftReply emailId={e.id} url={e.url} provider={provider(e.mailbox)} />
                    ) : e.url && (e.unread || e.severity === "critical") ? (
                      <div className="mt-2.5"><a href={e.url} target="_blank" rel="noreferrer" className={ab}><ExternalLink size={13} />Open in {provider(e.mailbox)}</a></div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <aside className="grid min-w-0 gap-4 lg:gap-[22px]">
          {ai && stats.triaged > 0 && (
            <Card title="Claude triage" accent="violet" flush action="last 14 days">
              <div className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-4 px-4 py-4 sm:px-5">
                <Donut
                  size={110}
                  value={stats.triaged}
                  label="Read"
                  parts={[
                    { value: stats.needsReply, color: "#ff5fd7" },
                    { value: stats.withTask, color: "#3fd0ff" },
                    { value: stats.fyi, color: "#2ef2d0" },
                  ]}
                />
                <div className="min-w-0">
                  <KV k="Needs reply" v={stats.needsReply} dot="#ff5fd7" />
                  <KV k="Has a to-do" v={stats.withTask} dot="#3fd0ff" />
                  <KV k="FYI only" v={stats.fyi} dot="#2ef2d0" />
                  {stats.total > stats.triaged && <KV k="Not read yet" v={stats.total - stats.triaged} dot="#5e7a8f" />}
                </div>
              </div>
            </Card>
          )}
          <Card title="Mailboxes" accent="cyan" flush action="unread">
            {stats.mailboxes.length === 0 ? <Empty>No mailbox connected.</Empty> : stats.mailboxes.map((m) => (
              <Link key={m.account} href={`/inbox?account=${encodeURIComponent(m.account)}`} className="grid min-h-12 grid-cols-[17px_minmax(0,1fr)_auto] items-center gap-2.5 border-b border-line/50 px-4 py-2.5 last:border-0 hover:bg-cyan/5 sm:px-5">
                <ProviderMark mailbox={m.mailbox} />
                <div className="min-w-0">
                  <div className="truncate text-[13px]">{m.account}</div>
                  <div className="truncate text-[11.5px] text-muted">
                    {m.business && <><span className="mr-1 inline-block h-1.5 w-1.5" style={{ background: businessColor(m.business) }} /><span className="text-[#c5d3de]">{m.business}</span> · </>}
                    {m.provider === "outlook" ? "Outlook" : "Gmail"} · {m.total} in 14 days
                  </div>
                </div>
                <span className={`border px-1.5 font-mono text-[12px] tabular-nums ${m.unread ? "border-cyan/40 text-cyan" : "border-line text-muted"}`}>{m.unread}</span>
              </Link>
            ))}
          </Card>
        </aside>
      </div>
    </>
  );
}
