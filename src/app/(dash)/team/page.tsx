import { requireOwner, allowedEmails, ownerIdentity, passwordSignInEnabled } from "@/lib/server/auth";
import { listMembers } from "@/lib/server/store/team";
import { listActivity } from "@/lib/server/store/tasks";
import { knownBusinesses } from "@/lib/server/reports";
import { ROLE_LABEL } from "@/lib/access";
import { Card, Empty, PageHeader, timeAgo } from "@/components/ui";
import { InviteForm, MemberActions, MemberEditor } from "@/components/team";

const ACTION: Record<string, string> = { done: "marked done", reopen: "reopened", snooze: "snoozed", business: "moved", assign: "assigned", delete: "deleted", create: "created" };

export default async function TeamPage() {
  await requireOwner();
  const [members, businesses, activity] = await Promise.all([listMembers(), knownBusinesses(), listActivity({ limit: 40 })]);
  const envOwners = [...(passwordSignInEnabled() ? [ownerIdentity()] : []), ...allowedEmails()];
  const names = new Map(members.map((m) => [m.email, m.name ?? m.email]));
  const who = (email: string) => names.get(email) ?? email;

  return (
    <>
      <PageHeader title="Team" subtitle="Invite the people who work with you. Each person sees only the sections of their role and the businesses you pick; everyone signs in with their own password or Google account plus an authenticator app." />
      <div className="grid gap-6 xl:grid-cols-5">
        <div className="grid content-start gap-6 xl:col-span-3">
          <Card title="Owners">
            <ul className="space-y-1 text-sm">
              {[...new Set(envOwners)].map((e) => <li key={e}>{e} <span className="text-xs text-muted">· full access, set in the environment</span></li>)}
            </ul>
          </Card>
          {members.length === 0 ? (
            <Card title="Members"><Empty>No one invited yet.</Empty></Card>
          ) : (
            members.map((m) => (
              <Card
                key={m.email}
                title={<>{m.name ?? m.email}{m.name && <span className="ml-2 text-xs font-normal text-muted">{m.email}</span>}</>}
                action={<span className={`text-xs ${m.disabled ? "text-critical" : "text-muted"}`}>{m.disabled ? "disabled" : `${ROLE_LABEL[m.role]} · ${m.businesses ? m.businesses.join(", ") : "all businesses"}`}</span>}
              >
                <p className="mb-3 text-xs text-muted">
                  {m.lastLoginAt ? `Last signed in ${timeAgo(m.lastLoginAt)}` : m.inviteExpiresAt ? `Invite pending (link expires ${new Date(m.inviteExpiresAt).toLocaleDateString()})` : m.hasPassword ? "Hasn't signed in yet" : "Invite expired or not accepted"}
                  {" · "}2FA {m.totpEnabled ? "on" : "not set up yet"}
                  {m.invitedBy ? ` · invited by ${m.invitedBy}` : ""}
                </p>
                <details>
                  <summary className="mb-3 cursor-pointer text-xs text-accent">Change access</summary>
                  <MemberEditor email={m.email} name={m.name} role={m.role} selected={m.businesses} businesses={businesses} />
                </details>
                <div className="mt-3 border-t border-line pt-3">
                  <MemberActions email={m.email} disabled={m.disabled} needsInvite={!m.hasPassword || !!m.inviteExpiresAt} hasTotp={m.totpEnabled} />
                </div>
              </Card>
            ))
          )}
        </div>
        <div className="grid content-start gap-6 xl:col-span-2">
          <Card title="Invite someone">
            <InviteForm businesses={businesses} />
          </Card>
          <Card title="Recent task activity">
            {activity.length === 0 ? <Empty>Nothing yet.</Empty> : (
              <ul className="-my-2 divide-y divide-line text-sm">
                {activity.map((a) => (
                  <li key={a.id} className="py-2">
                    <span className="font-medium">{who(a.actor)}</span> {ACTION[a.action] ?? a.action}
                    {a.action === "assign" && a.detail ? <> to {a.detail.assignee ? who(String(a.detail.assignee)) : "nobody"}</> : null} <span className="text-muted">“{a.taskTitle}”</span>
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
