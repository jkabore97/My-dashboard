"use client";

import { useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { Copy } from "lucide-react";
import { useFormState } from "@/components/useFormState";
import { inviteMemberAction, reissueInviteAction, removeMemberAction, resetMemberTwoFactorAction, resetMicrosoftLinkAction, setMemberDisabledAction, updateMemberAction, type TeamState } from "@/app/actions/team";
import { roleDefaultSections, ROLE_DESCRIPTION, ROLE_LABEL, ROLES, type Role, type Section } from "@/lib/access";
import { btn, input as hudInput } from "@/components/ui";
import { ROLE_COLOR, type SectionChoice } from "@/components/admin/roles";

/** The section checkboxes, grouped like the navigation (built on the server from NAV_GROUPS). */
export type SectionGroups = { id: string; label: string; color: string; items: SectionChoice[] }[];

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
function Check({ name, value, checked, defaultChecked, onChange, children, id, disabled = false }: { name: string; value?: string; checked?: boolean; defaultChecked?: boolean; onChange?: (v: boolean) => void; children: ReactNode; id?: string; disabled?: boolean }) {
  return (
    <label className={`flex min-h-9 items-center gap-2.5 text-sm sm:min-h-7 ${disabled ? "cursor-default text-muted" : "cursor-pointer"}`}>
      <input type="checkbox" id={id} name={name} value={value} checked={checked} defaultChecked={defaultChecked} disabled={disabled} onChange={onChange ? (e) => onChange(e.target.checked) : undefined} className="peer sr-only" />
      <span aria-hidden className="h-4 w-4 shrink-0 border border-line bg-bg/60 peer-checked:border-pink peer-checked:bg-pink peer-checked:shadow-[0_0_8px_#ff5fd7] peer-disabled:opacity-50 peer-focus-visible:outline peer-focus-visible:outline-1 peer-focus-visible:outline-cyan" />
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
        <span>Pages they see{custom ? <span className="ml-2 text-cyan">custom</span> : <span className="ml-2">as {ROLE_LABEL[role]}</span>}</span>
      </legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {groups.map((g) => (
          <div key={g.id} className="border-l-2 pl-3" style={{ borderColor: `color-mix(in srgb, ${g.color} 60%, transparent)` }}>
            <div className="hud-label mb-0.5 text-[10.5px]" style={{ color: g.color }}>{g.label}</div>
            {g.items.map((it) =>
              it.fixed === "always" ? (
                <Check key={it.section} name="_always" checked disabled>{it.label} <span className="text-[11px]">· everyone</span></Check>
              ) : it.fixed === "owner" ? (
                <Check key={it.section} name="_owner" checked={false} disabled>{it.label} <span className="text-[11px]">· owners only</span></Check>
              ) : (
                <Check key={it.section} name="sections" value={it.section} checked={picked.has(it.section)} onChange={(v) => toggle(it.section, v)}>{it.label}</Check>
              ),
            )}
          </div>
        ))}
      </div>
      {custom && (
        <button type="button" className="mt-2 text-xs text-cyan hover:underline" onClick={() => setPicked(new Set(def))}>Reset to the {ROLE_LABEL[role]} pages</button>
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
              <label key={r} className={`cursor-pointer border p-3 transition-colors ${on ? "border-pink bg-pink/5 shadow-[inset_0_0_0_1px_#ff5fd7]" : "border-line/80 hover:border-line"}`}>
                <input type="radio" name="role" value={r} checked={on} onChange={() => pickRole(r)} className="sr-only" />
                <span className="hud-label block text-[12px]" style={{ color: ROLE_COLOR[r] }}>{ROLE_LABEL[r]}</span>
                <span className="mt-1 block text-[12.5px] leading-snug text-muted">{compact ? ROLE_SHORT[r] : ROLE_DESCRIPTION[r]}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      {current === "owner" ? (
        <p className="text-[12.5px] text-muted">Owners see every page. Pick another role to choose pages.</p>
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
      <div><button disabled={pending} className={pinkSolid} style={pink}>{pending ? "Inviting…" : "Invite"}</button></div>
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
      <div><button disabled={pending} className={pinkSolid} style={pink}>{pending ? "Saving…" : "Save access"}</button></div>
      <Result state={state} />
    </form>
  );
}

/** Change-access editor (toggled) and the member's account actions. */
export function MemberControls({ email, name, role, selected, sections = null, businesses, groups, disabled, needsInvite, hasTotp, msLinked = false }: { email: string; name: string | null; role: Role; selected: string[] | null; sections?: Section[] | null; businesses: string[]; groups: SectionGroups; disabled: boolean; needsInvite: boolean; hasTotp: boolean; msLinked?: boolean }) {
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
          <MemberEditor email={email} name={name} role={role} selected={selected} sections={sections} businesses={businesses} groups={groups} />
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
