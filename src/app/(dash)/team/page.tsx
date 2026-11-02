import { requireOwner, allowedEmails, ownerIdentity, passwordSignInEnabled, memberPasswordsEnabled, googleSignInEnabled, microsoftSignInEnabled } from "@/lib/server/auth";
import { listMembers, type Member } from "@/lib/server/store/team";
import { listActivity } from "@/lib/server/store/tasks";
import { knownBusinesses } from "@/lib/server/reports";
import { PATH_SECTION, ROLE_LABEL, ROLES } from "@/lib/access";
import { NAV_GROUPS } from "@/lib/nav";
import { listPersonalSummaries } from "@/lib/server/store/connections";
import { passkeyCounts } from "@/lib/server/passkeys";
import { BizLabel, Card, Empty, Group, PageHeader, readable, SYS, Tag, timeAgo } from "@/components/ui";
import { InviteForm, MemberControls } from "@/components/team";
import { initials, ROLE_COLOR, ROLE_MATRIX_ROWS, roleCoverage, sectionChoices, sectionLabels } from "@/components/admin/roles";

const ACTION: Record<string, string> = { done: "marked done", reopen: "reopened", snooze: "snoozed", business: "moved", assign: "assigned", delete: "deleted", create: "created" };

function Avatar({ text, color, dashed = false }: { text: string; color: string; dashed?: boolean }) {
  return dashed ? (
    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-[1.5px] border-dashed text-[15px] font-semibold" style={{ borderColor: color, color: readable(color) }}>{text}</span>
  ) : (
    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[15px] font-semibold text-white" style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${color} 72%, white), ${color})` }}>{text}</span>
  );
}

const ABBR: Record<string, string> = { developer: "Dev", assistant: "Asst", accountant: "Acct" };
const pending = (m: Member) => !m.lastLoginAt && !!m.inviteExpiresAt;

export default async function TeamPage() {
  const me = await requireOwner();
  const [members, businesses, allActivity, personal, keys] = await Promise.all([listMembers(), knownBusinesses(), listActivity({ limit: 60 }), listPersonalSummaries().catch(() => []), passkeyCounts().catch(() => new Map<string, number>())]);
  // Someone's personal tasks (from their own mailbox) are theirs alone, owners included.
  const activity = allActivity.filter((a) => !a.privateTo || a.privateTo === me.email).slice(0, 40);
  const groups = sectionChoices(NAV_GROUPS, PATH_SECTION);
  const mailboxes = new Map<string, number>();
  for (const c of personal) mailboxes.set(c.ownerEmail, (mailboxes.get(c.ownerEmail) ?? 0) + 1);
  const envOwners = [...new Set([...(passwordSignInEnabled() ? [ownerIdentity()] : []), ...allowedEmails()])];
  const names = new Map(members.map((m) => [m.email, m.name ?? m.email]));
  const who = (email: string) => names.get(email) ?? email;
  const methods = [microsoftSignInEnabled() && "Microsoft account", memberPasswordsEnabled() && "password", googleSignInEnabled() && "Google account"].filter(Boolean).join(" or ") || "account";
  const active = members.filter((m) => !m.disabled && !pending(m)).length;
  const invites = members.filter((m) => !m.disabled && pending(m)).length;
  const matrixRoles = ROLES.filter((r) => r !== "owner");

  return (
    <>
      <PageHeader title="Team" subtitle={`Each person sees only the pages you pick (their role is the starting point) and the businesses you pick. Everyone signs in with their own ${methods} plus an authenticator app, or with a passkey they've added.`}>
        <Tag color={SYS.green}>{active} active</Tag>
        {invites > 0 && <Tag color={SYS.blue}>{invites} invite{invites === 1 ? "" : "s"} pending</Tag>}
      </PageHeader>
      <div className="grid items-start gap-7 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:gap-8">
        <div className="grid min-w-0 content-start gap-7">
          <Group header="Owners" footer="Set in the environment. Owners have full access.">
            {envOwners.length === 0 && <Empty>No owner address configured.</Empty>}
            {envOwners.map((e) => (
              <div key={e} className="flex items-center gap-3 px-4 py-3">
                <Avatar text={initials(e)} color={ROLE_COLOR.owner} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] text-ink">{e}</div>
                  <div className="text-[13px] text-muted">Full access · passkeys <span className={keys.get(e) ? "text-ok" : "text-ink"}>{keys.get(e) ?? "none"}</span></div>
                </div>
                <Tag color={ROLE_COLOR.owner}>Owner</Tag>
              </div>
            ))}
          </Group>

          <section className="min-w-0">
            <div className="mb-1.5 flex items-baseline justify-between gap-2 px-4">
              <h3 className="text-[13px] uppercase tracking-[0.02em] text-muted">Members</h3>
              <span className="text-[13px] text-muted">{members.length}</span>
            </div>
            {members.length === 0 ? (
              <Group><Empty>No one invited yet. Use the form to invite someone.</Empty></Group>
            ) : (
              <div className="grid gap-4">
                {members.map((m) => {
                  const color = m.disabled ? SYS.gray : ROLE_COLOR[m.role];
                  const isPending = pending(m);
                  return (
                    <section key={m.email} className="overflow-hidden rounded-[14px] bg-panel shadow-[0_0_0_1px_var(--color-line)]">
                      <div className="flex items-start gap-3 px-4 pt-3.5">
                        <Avatar text={initials(m.name ?? m.email)} color={color} dashed={isPending} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
                            <div className="min-w-0">
                              <div className={`truncate text-[17px] font-semibold ${m.disabled ? "text-muted" : "text-ink"}`}>{m.name ?? m.email}</div>
                              {m.name && <div className="truncate text-[13px] text-muted">{m.email}</div>}
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {m.disabled && <Tag color={SYS.red}>Disabled</Tag>}
                              {isPending && <Tag color={SYS.blue}>Invite pending</Tag>}
                              <Tag color={ROLE_COLOR[m.role]}>{ROLE_LABEL[m.role]}{m.sections ? " · custom" : ""}</Tag>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="grid gap-1.5 px-4 pb-3.5 pt-2.5 sm:pl-[68px]">
                        <div className="flex flex-wrap gap-x-4 gap-y-1">
                          {m.businesses ? m.businesses.map((b) => <BizLabel key={b} name={b} className="text-[13px]" />) : <span className="inline-flex items-center gap-1.5 text-[13px] text-ink"><span className="h-2 w-2 rounded-full bg-ink" />All businesses</span>}
                        </div>
                        {m.sections && <p className="text-[13px] text-muted">Sees <span className="text-ink">{sectionLabels(m, NAV_GROUPS, PATH_SECTION).join(" · ")}</span></p>}
                        <p className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
                          <span>{m.lastLoginAt ? <>Last signed in <span className="text-ink">{timeAgo(m.lastLoginAt)}</span></> : m.inviteExpiresAt ? <>Invite link expires <span className="text-ink">{new Date(m.inviteExpiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span></> : m.hasPassword ? "Hasn't signed in yet" : <span className="text-warn">Invite expired or not accepted</span>}</span>
                          <span>2FA <span className={m.totpEnabled ? "text-ok" : "text-ink"}>{m.totpEnabled ? "on" : "not set up yet"}</span></span>
                          <span>Passkeys <span className={m.passkeys ? "text-ok" : "text-ink"}>{m.passkeys || "none"}</span></span>
                          {m.microsoftLinked && <span>Microsoft <span className="text-ink">linked</span></span>}
                          {mailboxes.has(m.email) && <span>Personal mailbox <span className="text-ink">connected</span></span>}
                          {m.invitedBy && <span>Invited by {who(m.invitedBy)}</span>}
                        </p>
                      </div>
                      <MemberControls email={m.email} name={m.name} role={m.role} selected={m.businesses} sections={m.sections} businesses={businesses} groups={groups} disabled={m.disabled} needsInvite={!m.hasPassword || !!m.inviteExpiresAt} hasTotp={m.totpEnabled} msLinked={m.microsoftLinked} passkeys={m.passkeys} />
                    </section>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <div className="grid min-w-0 content-start gap-7">
          <Card title="Invite someone" action="One-time link">
            <InviteForm businesses={businesses} groups={groups} />
          </Card>
          <Group header="What each role sees" footer="The defaults; tick other pages for one person when inviting or editing them. Owners see everything. Everyone has Overview, To-do and their own Settings, and can connect their own mailbox and calendar when they have Inbox or Agenda: those stay private to them. ○ = some of the row.">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="border-b border-line">
                  <th className="px-4 py-2.5"><span className="sr-only">Sections</span></th>
                  {matrixRoles.map((r) => <th key={r} className="px-2 py-2.5 text-center text-[12px] font-semibold" style={{ color: readable(ROLE_COLOR[r]) }}><abbr title={ROLE_LABEL[r]} className="no-underline">{ABBR[r]}</abbr></th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {ROLE_MATRIX_ROWS.map((row) => (
                  <tr key={row.label}>
                    <td className="px-4 py-2.5 text-ink">{row.label}</td>
                    {matrixRoles.map((r) => {
                      const c = roleCoverage(r, row.sections);
                      return (
                        <td key={r} className="px-2 py-2.5 text-center" title={`${ROLE_LABEL[r]}: ${c === "all" ? "yes" : c === "some" ? "some of it" : "no"}`}>
                          {c === "all" ? <span className="inline-block h-2.5 w-2.5 rounded-full bg-ok" /> : c === "some" ? <span className="inline-block h-2.5 w-2.5 rounded-full border-[1.5px] border-ok" /> : <span className="text-muted/50">—</span>}
                          <span className="sr-only">{c === "all" ? "yes" : c === "some" ? "partly" : "no"}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </Group>
          <Group header={`Recent task activity · last ${activity.length}`}>
            {activity.length === 0 ? <Empty>Nothing yet.</Empty> : (
              <ul className="max-h-[36rem] divide-y divide-line overflow-y-auto">
                {activity.map((a) => (
                  <li key={a.id} className="px-4 py-2.5 text-[15px] leading-snug text-ink">
                    <span className="font-semibold">{who(a.actor)}</span> {ACTION[a.action] ?? a.action}
                    {a.action === "assign" && a.detail ? <> to <span className="font-semibold">{a.detail.assignee ? who(String(a.detail.assignee)) : "nobody"}</span></> : null} <span className="text-muted">“{a.taskTitle}”</span>
                    <span className="mt-0.5 block text-[13px] text-muted">{timeAgo(a.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Group>
        </div>
      </div>
    </>
  );
}
