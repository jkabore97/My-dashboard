"use client";

import { useFormState } from "@/components/useFormState";

import { generateSolarToken, saveBusinessRules, saveSolarSettings, saveWebsites, type SettingsState } from "@/app/actions/settings";
import { regenerateRecoveryCodes, resetTwoFactor } from "@/app/actions/auth";
import { RecoveryCodes } from "@/components/RecoveryCodes";

import { btn } from "@/components/ui";

const area = "hud-input w-full px-3 py-2.5 font-mono text-[12.5px] leading-6 text-[#ffd84d] placeholder:text-muted/60";
const button = `${btn("solid")} min-h-10 sm:min-h-0`;
const codeInput = "hud-input min-h-10 w-40 px-3 py-1.5 text-center font-mono text-sm tracking-[0.3em]";

function Status({ state }: { state: { error?: string; ok?: string } }) {
  if (state.error) return <p className="text-xs text-critical">{state.error}</p>;
  if (state.ok) return <p className="whitespace-pre-line text-xs text-emerald">✓ {state.ok.split("\n")[0]}</p>;
  return null;
}

export function BusinessRulesForm({ initial }: { initial: string }) {
  const [state, action, pending] = useFormState(saveBusinessRules, {});
  return (
    <form onSubmit={action} className="grid gap-2">
      <textarea name="rules" rows={6} defaultValue={initial} placeholder={"kaj = Kaj Consulting\nshop = Kaj Store"} className={area} />
      <div className="flex items-center gap-3"><button disabled={pending} className={button}>Save</button><Status state={state} /></div>
    </form>
  );
}

export function WebsitesForm({ initial }: { initial: string }) {
  const [state, action, pending] = useFormState(saveWebsites, {});
  return (
    <form onSubmit={action} className="grid gap-2">
      <textarea name="sites" rows={6} defaultValue={initial} placeholder={"kajconsulting.com | Kaj Consulting | abcdefghijklmnopqrst\nshop.example | Kaj Store"} className={area} />
      <div className="flex items-center gap-3"><button disabled={pending} className={button}>Save</button><Status state={state} /></div>
    </form>
  );
}

export function RegenerateCodesForm() {
  const [state, action, pending] = useFormState(regenerateRecoveryCodes, {});
  if (state.codes) return <RecoveryCodes codes={state.codes} />;
  return (
    <form onSubmit={action} className="flex flex-wrap items-center gap-2">
      <input name="code" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" required className={codeInput} />
      <button disabled={pending} className={button}>New recovery codes</button>
      {state.error && <span className="text-xs text-critical">{state.error}</span>}
    </form>
  );
}

export function ResetTwoFactorForm() {
  const [state, action, pending] = useFormState(resetTwoFactor, {});
  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { if (confirm("Remove 2FA and sign out of every device?")) action(e); else e.preventDefault(); }}>
      <input name="code" autoComplete="one-time-code" placeholder="Code or recovery code" required className={`${codeInput} w-56 text-left tracking-normal`} />
      <button disabled={pending} className={`${btn()} min-h-10 [--b:#ff3d6e] sm:min-h-0`}>Reset 2FA</button>
      {state.error && <span className="text-xs text-critical">{state.error}</span>}
    </form>
  );
}

const num = "hud-input min-h-10 w-16 px-2 py-1.5 text-center font-mono text-sm tabular-nums";

export function SolarForm({ initial }: { initial: { daylightFrom: number; daylightTo: number; offlineAfterMin: number; lowBatteryPct: number; stations: string } }) {
  const [state, action, pending] = useFormState(saveSolarSettings, {});
  return (
    <form onSubmit={action} className="grid gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        Expect readings from <input name="daylightFrom" type="number" min={0} max={23} defaultValue={initial.daylightFrom} className={num} aria-label="Daylight from (hour)" />
        to <input name="daylightTo" type="number" min={1} max={24} defaultValue={initial.daylightTo} className={num} aria-label="Daylight to (hour)" /> h
      </div>
      <div className="flex flex-wrap items-center gap-2">
        Offline after <input name="offlineAfterMin" type="number" min={5} max={1440} defaultValue={initial.offlineAfterMin} className={num} aria-label="Offline after (minutes)" /> min without a reading
      </div>
      <div className="flex flex-wrap items-center gap-2">
        Low battery below <input name="lowBatteryPct" type="number" min={0} max={100} defaultValue={initial.lowBatteryPct} className={num} aria-label="Low battery (%)" /> %
      </div>
      <textarea name="stations" rows={3} defaultValue={initial.stations} placeholder={"home = Home\noffice = Kaj Consulting"} className={area} aria-label="Stations" />
      <div className="flex items-center gap-3"><button disabled={pending} className={button}>Save</button><Status state={state} /></div>
    </form>
  );
}

export function SolarTokenForm({ exists }: { exists: boolean }) {
  const [state, action, pending] = useFormState<SettingsState>(async () => generateSolarToken(), {});
  return (
    <form onSubmit={(e) => { if (exists && !state.secret && !confirm("Create a new token? The current one stops working.")) { e.preventDefault(); return; } action(e); }} className="grid gap-2">
      <div className="flex items-center gap-3"><button disabled={pending} className={exists ? `${btn()} min-h-10 [--b:#ff5fd7] sm:min-h-0` : button}>{exists ? "Replace ingest token" : "Create ingest token"}</button><Status state={state} /></div>
      {state.secret && <code className="block break-all bg-cyan/5 px-2 py-1 font-mono text-xs text-[#9be7ff]">{state.secret}</code>}
    </form>
  );
}
