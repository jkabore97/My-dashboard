"use client";

import { useFormState } from "@/components/useFormState";

import { generateSolarToken, saveBusinessRules, saveSolarSettings, saveWebsites, type SettingsState } from "@/app/actions/settings";
import { regenerateRecoveryCodes, resetTwoFactor } from "@/app/actions/auth";
import { RecoveryCodes } from "@/components/RecoveryCodes";

const area = "w-full rounded-lg border border-line bg-bg px-3 py-2 font-mono text-xs outline-none focus:border-accent";
const button = "rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-50";
const codeInput = "w-40 rounded-lg border border-line bg-bg px-3 py-1.5 text-sm tracking-widest outline-none focus:border-accent";

function Status({ state }: { state: { error?: string; ok?: string } }) {
  if (state.error) return <p className="text-xs text-critical">{state.error}</p>;
  if (state.ok) return <p className="whitespace-pre-line text-xs text-ok">{state.ok.split("\n")[0]}</p>;
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
      <input name="code" autoComplete="one-time-code" placeholder="Code or recovery code" required className={`${codeInput} w-52 tracking-normal`} />
      <button disabled={pending} className="rounded-lg border border-critical/50 px-3 py-1.5 text-sm text-critical hover:bg-critical/10 disabled:opacity-50">Reset 2FA</button>
      {state.error && <span className="text-xs text-critical">{state.error}</span>}
    </form>
  );
}

const num = "w-20 rounded-lg border border-line bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent";

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
      <div className="flex items-center gap-3"><button disabled={pending} className={button}>{exists ? "Replace ingest token" : "Create ingest token"}</button><Status state={state} /></div>
      {state.secret && <code className="block break-all rounded bg-bg px-2 py-1 text-xs">{state.secret}</code>}
    </form>
  );
}
