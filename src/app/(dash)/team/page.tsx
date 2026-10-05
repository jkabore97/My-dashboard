import type { CSSProperties } from "react";
import { requireOwner, allowedEmails, ownerIdentity, passwordSignInEnabled, memberPasswordsEnabled, googleSignInEnabled, microsoftSignInEnabled } from "@/lib/server/auth";
import { listMembers, type Member } from "@/lib/server/store/team";
import { listActivity } from "@/lib/server/store/tasks";
import { knownBusinesses } from "@/lib/server/reports";
import { PATH_SECTION, ROLE_LABEL, ROLES } from "@/lib/access";
import { NAV_GROUPS } from "@/lib/nav";
import { listPersonalSummaries } from "@/lib/server/store/connections";
import { passkeyCounts } from "@/lib/server/passkeys";
import { BizLabel, Card, PageHeader, Tag, timeAgo } from "@/components/ui";
import { InviteForm, MemberControls } from "@/components/team";
import { initials, ROLE_COLOR, ROLE_MATRIX_ROWS, roleCoverage, sectionChoices, sectionLabels } from "@/components/admin/roles";

const ACTION: Record<string, string> = { done: "marked done", reopen: "reopened", snooze: "snoozed", business: "moved", assign: "assigned", delete: "deleted", create: "created" };

function Avatar({ text, color, dashed = false }: { text: string; color: string; dashed?: boolean }) {
  return dashed ? (
    <span className="grid h-12 w-12 shrink-0 place-items-center border border-dashed font-display text-base font-bold sm:h-14 sm:w-14" style={{ borderColor: color, color }}>{text}</span>
  ) : (
    <span className="hud-cut grid h-12 w-12 shrink-0 place-items-center font-display text-base font-bold text-bg sm:h-14 sm:w-14" style={{ background: `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 55%, #ffffff))`, boxShadow: `0 0 12px color-mix(in srgb, ${color} 45%, transparent)` }}>{text}</span>
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
        <Tag color="#3df5a0">{active} active</Tag>
        {invites > 0 && <Tag color="#3fd0ff">{invites} invite{invites === 1 ? "" : "s"} pending</Tag>}
      </PageHeader>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="grid content-start gap-5">
          <Card title="Owners" action="set in the environment" flush>
            <ul>
              {envOwners.length === 0 && <li className="px-4 py-4 text-sm text-muted sm:px-5">No owner address configured.</li>}
              {envOwners.map((e) => (
                <li key={e} className="flex items-center gap-4 border-b border-line/50 px-4 py-4 last:border-0 sm:px-5">
                  <Avatar text={initials(e)} color="#3fd0ff" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[16px]">{e}</div>
                    <div className="text-[13px] text-muted">full access · passkeys <b className={`font-normal ${keys.get(e) ? "text-emerald" : "text-ink"}`}>{keys.get(e) ?? "none"}</b></div>
                  </div>
                  <Tag color={ROLE_COLOR.owner}>Owner</Tag>
                </li>
              ))}
            </ul>
          </Card>

          {members.length === 0 ? (
            <Card title="Members"><p className="py-6 text-center text-sm text-muted">No one invited yet. Use the form to invite someone.</p></Card>
          ) : (
            members.map((m) => {
              const color = m.disabled ? "#7f97ab" : ROLE_COLOR[m.role];
              const isPending = pending(m);
              return (
                <section key={m.email} className="hud-panel" style={{ "--a": color } as CSSProperties}>
                  <div className="flex items-start gap-4 px-4 pt-4 sm:px-5 sm:pt-5">
                    <Avatar text={initials(m.name ?? m.email)} color={color} dashed={isPending} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-[17px]">{m.name ?? m.email}</div>
                          {m.name && <div className="truncate text-[13px] text-muted">{m.email}</div>}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {m.disabled && <Tag color="#ff3d6e">Disabled</Tag>}
                          {isPending && <Tag color="#3fd0ff">Invite pending</Tag>}
                          <Tag color={ROLE_COLOR[m.role]}>{ROLE_LABEL[m.role]}{m.sections ? " · custom" : ""}</Tag>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="px-4 pb-4 pt-3 sm:pl-[92px] sm:pr-5">
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {m.businesses ? m.businesses.map((b) => <BizLabel key={b} name={b} className="text-[13px]" />) : <span className="inline-flex items-center gap-1.5 text-[13px] text-[#c5d3de]"><span className="h-1.5 w-1.5 bg-ink" />All businesses</span>}
                    </div>
                    {m.sections && <p className="mt-2 text-[13px] text-muted">Sees <span className="text-[#c5d3de]">{sectionLabels(m, NAV_GROUPS, PATH_SECTION).join(" · ")}</span></p>}
                    <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted">
                      <span>{m.lastLoginAt ? <>Last signed in <b className="font-normal text-ink">{timeAgo(m.lastLoginAt)}</b></> : m.inviteExpiresAt ? <>Invite link expires <b className="font-normal text-ink">{new Date(m.inviteExpiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</b></> : m.hasPassword ? "Hasn't signed in yet" : <span className="text-high">Invite expired or not accepted</span>}</span>
                      <span>2FA <b className={`font-normal ${m.totpEnabled ? "text-emerald" : "text-ink"}`}>{m.totpEnabled ? "on" : "not set up yet"}</b></span>
                      <span>Passkeys <b className={`font-normal ${m.passkeys ? "text-emerald" : "text-ink"}`}>{m.passkeys || "none"}</b></span>
                      {m.microsoftLinked && <span>Microsoft <b className="font-normal text-ink">linked</b></span>}
                      {mailboxes.has(m.email) && <span>Personal mailbox <b className="font-normal text-ink">connected</b></span>}
                      {m.invitedBy && <span>invited by {who(m.invitedBy)}</span>}
                    </p>
                  </div>
                  <MemberControls email={m.email} name={m.name} role={m.role} selected={m.businesses} sections={m.sections} businesses={businesses} groups={groups} disabled={m.disabled} needsInvite={!m.hasPassword || !!m.inviteExpiresAt} hasTotp={m.totpEnabled} msLinked={m.microsoftLinked} passkeys={m.passkeys} />
                </section>
              );
            })
          )}
        </div>

        <div className="grid content-start gap-5">
          <Card title="Invite someone" action="one-time link">
            <InviteForm businesses={businesses} groups={groups} />
          </Card>
          <Card title="What each role sees" flush>
            <table className="w-full text-[13px]">
              <thead>
                <tr>
                  <th className="px-4 py-2.5 sm:px-5"><span className="sr-only">Sections</span></th>
                  {matrixRoles.map((r) => <th key={r} className="hud-label px-2 py-2.5 text-center text-[11px] font-semibold" style={{ color: ROLE_COLOR[r] }}><abbr title={ROLE_LABEL[r]} className="no-underline">{ABBR[r]}</abbr></th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-line/50">
                {ROLE_MATRIX_ROWS.map((row) => (
                  <tr key={row.label}>
                    <td className="px-4 py-2.5 text-muted sm:px-5">{row.label}</td>
                    {matrixRoles.map((r) => {
                      const c = roleCoverage(r, row.sections);
                      return (
                        <td key={r} className="px-2 py-2.5 text-center" title={`${ROLE_LABEL[r]}: ${c === "all" ? "yes" : c === "some" ? "some of it" : "no"}`}>
                          {c === "all" ? <span className="inline-block h-2 w-2 rounded-full bg-emerald shadow-[0_0_6px_#3df5a0]" /> : c === "some" ? <span className="inline-block h-2 w-2 rounded-full border border-emerald" /> : <span className="text-line">—</span>}
                          <span className="sr-only">{c === "all" ? "yes" : c === "some" ? "partly" : "no"}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-4 pb-4 pt-1 text-xs text-muted sm:px-5">The defaults; tick other pages for one person when inviting or editing them. Owners see everything. Everyone has Overview, To-do and their own Settings, and can connect their own mailbox and calendar when they have Inbox or Agenda: those stay private to them. ○ = some of the row.</p>
          </Card>
          <Card title="Recent task activity" action={`last ${activity.length}`} flush>
            {activity.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted sm:px-5">Nothing yet.</p> : (
              <ul className="max-h-[36rem] overflow-y-auto">
                {activity.map((a) => (
                  <li key={a.id} className="border-b border-line/40 px-4 py-3 text-sm last:border-0 sm:px-5">
                    <b className="font-medium">{who(a.actor)}</b> {ACTION[a.action] ?? a.action}
                    {a.action === "assign" && a.detail ? <> to <b className="font-medium">{a.detail.assignee ? who(String(a.detail.assignee)) : "nobody"}</b></> : null} <span className="text-muted">“{a.taskTitle}”</span>
                    <span className="block text-xs text-muted">{timeAgo(a.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
