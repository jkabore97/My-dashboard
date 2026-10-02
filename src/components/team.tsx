"use client";

import { useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { Copy } from "lucide-react";
import { useFormState } from "@/components/useFormState";
import { inviteMemberAction, reissueInviteAction, removeMemberAction, resetMemberTwoFactorAction, resetMicrosoftLinkAction, setMemberDisabledAction, updateMemberAction, type TeamState } from "@/app/actions/team";
import { ROLE_DESCRIPTION, ROLE_LABEL, ROLES, type Role } from "@/lib/access";
import { btn, input as hudInput } from "@/components/ui";
import { ROLE_COLOR } from "@/components/admin/roles";

const input = `${hudInput} min-h-10`;
const ROLE_SHORT: Record<Role, string> = { developer: "Code, hosting, sites.", assistant: "Inbox, agenda, clients, sites.", accountant: "Money and reports.", owner: "Everything." };
const label = "hud-label text-[11px] text-muted";
const small = `${btn()} min-h-10 px-3 text-[11px] [--b:#7f97ab] sm:min-h-0`;
const pinkSolid = `${btn("solid")} min-h-10 sm:min-h-0`;
const pink = { "--b": "#ff5fd7" } as CSSProperties;

function Result({ state }: { state: TeamState }) {
  const [copied, setCopied] = useState(false);
  if (state.error) return <p className="text-sm text-critical">{state.error}</p>;
  if (!state.ok) return null;
  return (
    <div className="grid gap-1.5">
      <p className="text-sm text-emerald">✓ {state.ok}</p>
      {state.link && (
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 break-all bg-cyan/5 px-2 py-1.5 font-mono text-xs text-[#9be7ff]">{state.link}</code>
          <button type="button" className={small} onClick={async () => { await navigator.clipboard.writeText(state.link!); setCopied(true); }}><Copy size={12} />{copied ? "Copied" : "Copy link"}</button>
        </div>
      )}
    </div>
  );
}

/** A checkbox drawn as a HUD square (the native input stays for keyboard and forms). */
function Check({ name, value, checked, defaultChecked, onChange, children, id }: { name: string; value?: string; checked?: boolean; defaultChecked?: boolean; onChange?: (v: boolean) => void; children: ReactNode; id?: string }) {
  return (
    <label className="flex min-h-9 cursor-pointer items-center gap-2.5 text-sm sm:min-h-7">
      <input type="checkbox" id={id} name={name} value={value} checked={checked} defaultChecked={defaultChecked} onChange={onChange ? (e) => onChange(e.target.checked) : undefined} className="peer sr-only" />
      <span aria-hidden className="h-4 w-4 shrink-0 border border-line bg-bg/60 peer-checked:border-pink peer-checked:bg-pink peer-checked:shadow-[0_0_8px_#ff5fd7] peer-focus-visible:outline peer-focus-visible:outline-1 peer-focus-visible:outline-cyan" />
      <span className="min-w-0">{children}</span>
    </label>
  );
}

function AccessFields({ businesses, role = "assistant", selected = null, idPrefix, compact = false }: { businesses: string[]; role?: Role; selected?: string[] | null; idPrefix: string; compact?: boolean }) {
  const [all, setAll] = useState(selected === null);
  const [current, setCurrent] = useState<Role>(role);
  const others = (selected ?? []).filter((b) => !businesses.includes(b));
  const order: Role[] = ["developer", "assistant", "accountant", "owner"].filter((r) => ROLES.includes(r as Role)) as Role[];
  return (
    <>
      <fieldset>
        <legend className={`${label} mb-2`}>Role</legend>
        <div className="grid grid-cols-2 gap-2.5">
          {order.map((r) => {
            const on = current === r;
            return (
              <label key={r} className={`cursor-pointer border p-3 transition-colors ${on ? "border-pink bg-pink/5 shadow-[inset_0_0_0_1px_#ff5fd7]" : "border-line/80 hover:border-line"}`}>
                <input type="radio" name="role" value={r} checked={on} onChange={() => setCurrent(r)} className="sr-only" />
                <span className="hud-label block text-[12px]" style={{ color: ROLE_COLOR[r] }}>{ROLE_LABEL[r]}</span>
                <span className="mt-1 block text-[12.5px] leading-snug text-muted">{compact ? ROLE_SHORT[r] : ROLE_DESCRIPTION[r]}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <fieldset>
        <legend className={`${label} mb-1.5`}>Businesses</legend>
        <Check name="allBusinesses" checked={all} onChange={setAll}>All businesses{current === "owner" && all ? <span className="text-muted"> (full owner: connections, settings and team too)</span> : null}</Check>
        {!all && (
          <>
            <div className="grid gap-x-4 sm:grid-cols-2">
              {businesses.map((b) => (
                <Check key={b} name="businesses" value={b} defaultChecked={selected?.includes(b)} id={`${idPrefix}-${b}`}>{b}</Check>
              ))}
            </div>
            <input name="otherBusinesses" defaultValue={others.join(", ")} placeholder="Other businesses, comma-separated" aria-label="Other businesses" className={`${input} mt-2`} />
          </>
        )}
      </fieldset>
    </>
  );
}

export function InviteForm({ businesses }: { businesses: string[] }) {
  const [state, action, pending] = useFormState(inviteMemberAction, {});
  return (
    <form onSubmit={action} className="grid gap-4">
      <label className="grid gap-1.5"><span className={label}>Email</span><input name="email" type="email" required placeholder="name@business.com" className={input} /></label>
      <label className="grid gap-1.5"><span className={label}>Name</span><input name="name" maxLength={80} placeholder="Optional" className={input} /></label>
      <AccessFields businesses={businesses} idPrefix="invite" compact />
      <div><button disabled={pending} className={pinkSolid} style={pink}>{pending ? "Inviting…" : "Invite"}</button></div>
      <Result state={state} />
    </form>
  );
}

function MemberEditor({ email, name, role, selected, businesses }: { email: string; name: string | null; role: Role; selected: string[] | null; businesses: string[] }) {
  const [state, action, pending] = useFormState(updateMemberAction, {});
  return (
    <form onSubmit={action} className="grid gap-4">
      <input type="hidden" name="email" value={email} />
      <label className="grid gap-1.5"><span className={label}>Name</span><input name="name" defaultValue={name ?? ""} maxLength={80} className={input} /></label>
      <AccessFields businesses={businesses} role={role} selected={selected} idPrefix={`m-${email}`} />
      <div><button disabled={pending} className={pinkSolid} style={pink}>{pending ? "Saving…" : "Save access"}</button></div>
      <Result state={state} />
    </form>
  );
}

/** Change-access editor (toggled) and the member's account actions. */
export function MemberControls({ email, name, role, selected, businesses, disabled, needsInvite, hasTotp, msLinked = false }: { email: string; name: string | null; role: Role; selected: string[] | null; businesses: string[]; disabled: boolean; needsInvite: boolean; hasTotp: boolean; msLinked?: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [state, setState] = useState<TeamState>({});
  const run = (fn: () => Promise<TeamState>, ask?: string) => {
    if (ask && !confirm(ask)) return;
    start(async () => setState(await fn()));
  };
  return (
    <>
      {open && (
        <div className="border-t border-line/70 px-4 py-4 sm:px-5">
          <MemberEditor email={email} name={name} role={role} selected={selected} businesses={businesses} />
        </div>
      )}
      <div className="grid gap-2 border-t border-line/70 px-4 py-3.5 sm:px-5">
        <div className="flex flex-wrap gap-2">
          {needsInvite && <button className={`${btn()} min-h-10 px-3 text-[11px] sm:min-h-0`} disabled={pending} onClick={() => run(() => reissueInviteAction(email))}>New invite link</button>}
          <button className={`${btn()} min-h-10 px-3 text-[11px] sm:min-h-0`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? "Hide ▴" : "Change access ▾"}</button>
          {hasTotp && <button className={small} disabled={pending} onClick={() => run(() => resetMemberTwoFactorAction(email), `Reset 2FA for ${email}? They'll be signed out and set it up again.`)}>Reset 2FA</button>}
          {msLinked && <button className={small} disabled={pending} onClick={() => run(() => resetMicrosoftLinkAction(email), `Reset the Microsoft account linked to ${email}? Only do this if their Microsoft account was recreated.`)}>Reset Microsoft link</button>}
          <button className={small} disabled={pending} onClick={() => run(() => setMemberDisabledAction(email, !disabled), disabled ? undefined : `Disable ${email}? They're signed out at once.`)}>{disabled ? "Enable" : "Disable"}</button>
          <button className={`${btn()} min-h-10 px-3 text-[11px] sm:min-h-0`} style={pink} disabled={pending} onClick={() => run(() => removeMemberAction(email), `Remove ${email} from the team? Their tasks become unassigned.`)}>Remove</button>
        </div>
        <Result state={state} />
      </div>
    </>
  );
}
