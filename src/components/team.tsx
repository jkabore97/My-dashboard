"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Check as CheckIcon, Copy } from "lucide-react";
import { useFormState } from "@/components/useFormState";
import { inviteMemberAction, reissueInviteAction, removeMemberAction, resetMemberPasskeysAction, resetMemberTwoFactorAction, resetMicrosoftLinkAction, setMemberDisabledAction, updateMemberAction, type TeamState } from "@/app/actions/team";
import { roleDefaultSections, ROLE_DESCRIPTION, ROLE_LABEL, ROLES, type Role, type Section } from "@/lib/access";
import { btn, input as hudInput, readable } from "@/components/ui";
import { ROLE_COLOR, type SectionChoice } from "@/components/admin/roles";

/** The section checkboxes, grouped like the navigation (built on the server from NAV_GROUPS). */
export type SectionGroups = { id: string; label: string; color: string; items: SectionChoice[] }[];

const input = `${hudInput} min-h-10`;
const ROLE_SHORT: Record<Role, string> = { developer: "Code, hosting, sites.", assistant: "Inbox, agenda, clients, sites.", accountant: "Money and reports.", owner: "Everything." };
const label = "text-[13px] text-muted";
const small = `${btn()} min-h-10 rounded-full px-3.5 text-[13px] sm:min-h-8`;
const danger = `${small} hud-btn-danger`;
const solid = `${btn("solid")} min-h-10 rounded-full px-5`;

function Result({ state }: { state: TeamState }) {
  const [copied, setCopied] = useState(false);
  if (state.error) return <p className="rounded-[12px] bg-critical/10 px-3 py-2 text-[13px] text-ink"><b className="font-semibold text-critical">Didn&apos;t work.</b> {state.error}</p>;
  if (!state.ok) return null;
  return (
    <div className="grid gap-1.5">
      <p className="text-[13px] text-ok">✓ {state.ok}</p>
      {state.link && (
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded-lg bg-fill px-2.5 py-2 font-mono text-[12.5px] text-ink">{state.link}</code>
          <button type="button" className={small} onClick={async () => { await navigator.clipboard.writeText(state.link!); setCopied(true); }}><Copy size={12} />{copied ? "Copied" : "Copy link"}</button>
        </div>
      )}
    </div>
  );
}

/** A checkbox drawn as an iOS check circle (the native input stays for keyboard and forms). */
function Check({ name, value, checked, defaultChecked, onChange, children, id, disabled = false }: { name: string; value?: string; checked?: boolean; defaultChecked?: boolean; onChange?: (v: boolean) => void; children: ReactNode; id?: string; disabled?: boolean }) {
  return (
    <label className={`flex min-h-10 items-center gap-2.5 text-[15px] sm:min-h-8 ${disabled ? "cursor-default text-muted" : "cursor-pointer text-ink"}`}>
      <input type="checkbox" id={id} name={name} value={value} checked={checked} defaultChecked={defaultChecked} disabled={disabled} onChange={onChange ? (e) => onChange(e.target.checked) : undefined} className="peer sr-only" />
      <span aria-hidden className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border-[1.5px] border-low/60 text-transparent peer-checked:border-cyan peer-checked:bg-cyan peer-checked:text-white peer-disabled:opacity-50 peer-focus-visible:ring-[3px] peer-focus-visible:ring-cyan/40"><CheckIcon size={13} strokeWidth={3} /></span>
      <span className="min-w-0">{children}</span>
    </label>
  );
}

/** Section checkboxes, grouped like the navigation; they start from the role and follow it when it changes. */
function SectionFields({ groups, picked, setPicked, role }: { groups: SectionGroups; picked: Set<Section>; setPicked: (s: Set<Section>) => void; role: Role }) {
  const def = roleDefaultSections(role);
  const custom = def.length !== picked.size || def.some((s) => !picked.has(s));
  const toggle = (s: Section, on: boolean) => {
    const next = new Set(picked);
    if (on) next.add(s);
    else next.delete(s);
    setPicked(next);
  };
  return (
    <fieldset>
      <input type="hidden" name="sectionsShown" value="1" />
      <legend className={`${label} mb-1.5 flex w-full items-center justify-between gap-2`}>
        <span>Pages they see{custom ? <span className="ml-1.5 font-semibold text-cyan">· custom</span> : <span className="ml-1.5">· as {ROLE_LABEL[role]}</span>}</span>
      </legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {groups.map((g) => (
          <div key={g.id} className="rounded-[12px] bg-panel-2 px-3 py-2">
            <div className="mb-0.5 text-[13px] font-semibold" style={{ color: readable(g.color) }}>{g.label}</div>
            {g.items.map((it) =>
              it.fixed === "always" ? (
                <Check key={it.section} name="_always" checked disabled>{it.label} <span className="text-[13px] text-muted">· everyone</span></Check>
              ) : it.fixed === "owner" ? (
                <Check key={it.section} name="_owner" checked={false} disabled>{it.label} <span className="text-[13px] text-muted">· owners only</span></Check>
              ) : (
                <Check key={it.section} name="sections" value={it.section} checked={picked.has(it.section)} onChange={(v) => toggle(it.section, v)}>{it.label}</Check>
              ),
            )}
          </div>
        ))}
      </div>
      {custom && (
        <button type="button" className="mt-2 min-h-9 text-[15px] text-cyan hover:opacity-70" onClick={() => setPicked(new Set(def))}>Reset to the {ROLE_LABEL[role]} pages</button>
      )}
    </fieldset>
  );
}

function AccessFields({ businesses, groups, role = "assistant", selected = null, sections = null, idPrefix, compact = false }: { businesses: string[]; groups: SectionGroups; role?: Role; selected?: string[] | null; sections?: Section[] | null; idPrefix: string; compact?: boolean }) {
  const [all, setAll] = useState(selected === null);
  const [current, setCurrent] = useState<Role>(role);
  const [picked, setPicked] = useState<Set<Section>>(() => new Set(sections ?? roleDefaultSections(role)));
  const pickRole = (r: Role) => {
    setCurrent(r);
    // The role is a preset: picking one starts the pages over from it.
    setPicked(new Set(roleDefaultSections(r)));
  };
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
              <label key={r} className={`cursor-pointer rounded-[12px] p-3 transition-colors ${on ? "bg-cyan/10 shadow-[inset_0_0_0_2px_var(--color-cyan)]" : "bg-panel-2 shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-fill"}`}>
                <input type="radio" name="role" value={r} checked={on} onChange={() => pickRole(r)} className="sr-only" />
                <span className="block text-[15px] font-semibold" style={{ color: readable(ROLE_COLOR[r]) }}>{ROLE_LABEL[r]}</span>
                <span className="mt-0.5 block text-[13px] leading-snug text-muted">{compact ? ROLE_SHORT[r] : ROLE_DESCRIPTION[r]}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      {current === "owner" ? (
        <p className="text-[13px] text-muted">Owners see every page. Pick another role to choose pages.</p>
      ) : (
        <SectionFields groups={groups} picked={picked} setPicked={setPicked} role={current} />
      )}
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

export function InviteForm({ businesses, groups }: { businesses: string[]; groups: SectionGroups }) {
  const [state, action, pending] = useFormState(inviteMemberAction, {});
  return (
    <form onSubmit={action} className="grid gap-4">
      <label className="grid gap-1.5"><span className={label}>Email</span><input name="email" type="email" required placeholder="name@business.com" className={input} /></label>
      <label className="grid gap-1.5"><span className={label}>Name</span><input name="name" maxLength={80} placeholder="Optional" className={input} /></label>
      <AccessFields businesses={businesses} groups={groups} idPrefix="invite" compact />
      <div><button disabled={pending} className={solid}>{pending ? "Inviting…" : "Send invite"}</button></div>
      <Result state={state} />
    </form>
  );
}

function MemberEditor({ email, name, role, selected, sections, businesses, groups }: { email: string; name: string | null; role: Role; selected: string[] | null; sections: Section[] | null; businesses: string[]; groups: SectionGroups }) {
  const [state, action, pending] = useFormState(updateMemberAction, {});
  return (
    <form onSubmit={action} className="grid gap-4">
      <input type="hidden" name="email" value={email} />
      <label className="grid gap-1.5"><span className={label}>Name</span><input name="name" defaultValue={name ?? ""} maxLength={80} className={input} /></label>
      <AccessFields businesses={businesses} groups={groups} role={role} selected={selected} sections={sections} idPrefix={`m-${email}`} />
      <div><button disabled={pending} className={solid}>{pending ? "Saving…" : "Save access"}</button></div>
      <Result state={state} />
    </form>
  );
}

/** Change-access editor (toggled) and the member's account actions. */
export function MemberControls({ email, name, role, selected, sections = null, businesses, groups, disabled, needsInvite, hasTotp, msLinked = false, passkeys = 0 }: { email: string; name: string | null; role: Role; selected: string[] | null; sections?: Section[] | null; businesses: string[]; groups: SectionGroups; disabled: boolean; needsInvite: boolean; hasTotp: boolean; msLinked?: boolean; passkeys?: number }) {
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
        <div className="border-t border-line bg-panel-2/40 px-4 py-4 sm:px-5">
          <MemberEditor email={email} name={name} role={role} selected={selected} sections={sections} businesses={businesses} groups={groups} />
        </div>
      )}
      <div className="grid gap-2 border-t border-line px-4 py-3">
        <div className="flex flex-wrap gap-2">
          {needsInvite && <button className={small} disabled={pending} onClick={() => run(() => reissueInviteAction(email))}>New invite link</button>}
          <button className={open ? `${btn("solid")} min-h-10 rounded-full px-3.5 text-[13px] sm:min-h-8` : small} aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? "Close" : "Change access"}</button>
          {hasTotp && <button className={small} disabled={pending} onClick={() => run(() => resetMemberTwoFactorAction(email), `Reset 2FA for ${email}? They'll be signed out and set it up again.`)}>Reset 2FA</button>}
          {passkeys > 0 && <button className={small} disabled={pending} onClick={() => run(() => resetMemberPasskeysAction(email), `Remove all ${passkeys} passkey${passkeys === 1 ? "" : "s"} of ${email}? They'll be signed out and can add new ones in Settings.`)}>Remove passkeys</button>}
          {msLinked && <button className={small} disabled={pending} onClick={() => run(() => resetMicrosoftLinkAction(email), `Reset the Microsoft account linked to ${email}? Only do this if their Microsoft account was recreated.`)}>Reset Microsoft link</button>}
          <button className={small} disabled={pending} onClick={() => run(() => setMemberDisabledAction(email, !disabled), disabled ? undefined : `Disable ${email}? They're signed out at once.`)}>{disabled ? "Enable" : "Disable"}</button>
          <button className={danger} disabled={pending} onClick={() => run(() => removeMemberAction(email), `Remove ${email} from the team? Their tasks become unassigned.`)}>Remove</button>
        </div>
        <Result state={state} />
      </div>
    </>
  );
}
