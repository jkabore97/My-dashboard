"use client";

import { useState, useTransition } from "react";
import { Copy } from "lucide-react";
import { useFormState } from "@/components/useFormState";
import { inviteMemberAction, reissueInviteAction, removeMemberAction, resetMemberTwoFactorAction, resetMicrosoftLinkAction, setMemberDisabledAction, updateMemberAction, type TeamState } from "@/app/actions/team";
import { ROLE_DESCRIPTION, ROLE_LABEL, ROLES, type Role } from "@/lib/access";

const input = "rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent";
const button = "rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-50";
const small = "rounded-md border border-line px-2 py-1 text-xs text-muted hover:border-accent/50 hover:text-ink disabled:opacity-50";

function Result({ state }: { state: TeamState }) {
  const [copied, setCopied] = useState(false);
  if (state.error) return <p className="text-sm text-critical">{state.error}</p>;
  if (!state.ok) return null;
  return (
    <div className="grid gap-1">
      <p className="text-sm text-ok">{state.ok}</p>
      {state.link && (
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded bg-bg px-2 py-1 text-xs">{state.link}</code>
          <button type="button" className={small} onClick={async () => { await navigator.clipboard.writeText(state.link!); setCopied(true); }}><Copy size={12} className="inline" /> {copied ? "Copied" : "Copy"}</button>
        </div>
      )}
    </div>
  );
}

function AccessFields({ businesses, role = "assistant", selected = null, idPrefix }: { businesses: string[]; role?: Role; selected?: string[] | null; idPrefix: string }) {
  const [all, setAll] = useState(selected === null);
  const [current, setCurrent] = useState<Role>(role);
  const others = (selected ?? []).filter((b) => !businesses.includes(b));
  return (
    <>
      <label className="grid gap-1 text-sm">
        <span className="text-muted">Role</span>
        <select name="role" value={current} onChange={(e) => setCurrent(e.target.value as Role)} className={input}>
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
        <span className="text-xs text-muted">{ROLE_DESCRIPTION[current]}</span>
      </label>
      <fieldset className="grid gap-1 text-sm">
        <legend className="mb-1 text-muted">Businesses</legend>
        <label className="flex items-center gap-2"><input type="checkbox" name="allBusinesses" checked={all} onChange={(e) => setAll(e.target.checked)} /> All businesses{current === "owner" && all ? " (full owner: connections, settings and team too)" : ""}</label>
        {!all && (
          <div className="grid gap-1 pl-5">
            {businesses.map((b) => (
              <label key={b} className="flex items-center gap-2"><input type="checkbox" name="businesses" value={b} defaultChecked={selected?.includes(b)} id={`${idPrefix}-${b}`} /> {b}</label>
            ))}
            <input name="otherBusinesses" defaultValue={others.join(", ")} placeholder="Other businesses, comma-separated" className={`${input} mt-1`} />
          </div>
        )}
      </fieldset>
    </>
  );
}

export function InviteForm({ businesses }: { businesses: string[] }) {
  const [state, action, pending] = useFormState(inviteMemberAction, {});
  return (
    <form onSubmit={action} className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm"><span className="text-muted">Email</span><input name="email" type="email" required className={input} /></label>
        <label className="grid gap-1 text-sm"><span className="text-muted">Name</span><input name="name" maxLength={80} className={input} /></label>
      </div>
      <AccessFields businesses={businesses} idPrefix="invite" />
      <div><button disabled={pending} className={button}>{pending ? "Inviting…" : "Invite"}</button></div>
      <Result state={state} />
    </form>
  );
}

export function MemberEditor({ email, name, role, selected, businesses }: { email: string; name: string | null; role: Role; selected: string[] | null; businesses: string[] }) {
  const [state, action, pending] = useFormState(updateMemberAction, {});
  return (
    <form onSubmit={action} className="grid gap-3">
      <input type="hidden" name="email" value={email} />
      <label className="grid gap-1 text-sm"><span className="text-muted">Name</span><input name="name" defaultValue={name ?? ""} maxLength={80} className={input} /></label>
      <AccessFields businesses={businesses} role={role} selected={selected} idPrefix={`m-${email}`} />
      <div><button disabled={pending} className={button}>{pending ? "Saving…" : "Save access"}</button></div>
      <Result state={state} />
    </form>
  );
}

export function MemberActions({ email, disabled, needsInvite, hasTotp, msLinked = false }: { email: string; disabled: boolean; needsInvite: boolean; hasTotp: boolean; msLinked?: boolean }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<TeamState>({});
  const run = (fn: () => Promise<TeamState>, ask?: string) => {
    if (ask && !confirm(ask)) return;
    start(async () => setState(await fn()));
  };
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {needsInvite && <button className={small} disabled={pending} onClick={() => run(() => reissueInviteAction(email))}>New invite link</button>}
        {hasTotp && <button className={small} disabled={pending} onClick={() => run(() => resetMemberTwoFactorAction(email), `Reset 2FA for ${email}? They'll be signed out and set it up again.`)}>Reset 2FA</button>}
        {msLinked && <button className={small} disabled={pending} onClick={() => run(() => resetMicrosoftLinkAction(email), `Reset the Microsoft account linked to ${email}? Only do this if their Microsoft account was recreated.`)}>Reset Microsoft link</button>}
        <button className={small} disabled={pending} onClick={() => run(() => setMemberDisabledAction(email, !disabled), disabled ? undefined : `Disable ${email}? They're signed out at once.`)}>{disabled ? "Enable" : "Disable"}</button>
        <button className={`${small} hover:text-critical`} disabled={pending} onClick={() => run(() => removeMemberAction(email), `Remove ${email} from the team? Their tasks become unassigned.`)}>Remove</button>
      </div>
      <Result state={state} />
    </div>
  );
}
