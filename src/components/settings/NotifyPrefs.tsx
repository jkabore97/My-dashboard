"use client";

import { useEffect, useState, useTransition } from "react";
import { Copy, Pause, Play } from "lucide-react";
import { useFormState } from "@/components/useFormState";
import { createSchedulerLink, pauseAlerts, saveNotifyPrefs, type PausePreset, type SchedulerLink } from "@/app/actions/alerts";
import { btn, Group, Row, Switch } from "@/components/ui";

const button = `${btn("solid")} min-h-10 sm:min-h-9`;
const outline = `${btn()} min-h-10 sm:min-h-9`;
const select = "hud-input min-h-9 py-1.5 pl-3 text-[15px]";
const hourLabel = (h: number) => (h === 0 ? "12 AM (midnight)" : h === 12 ? "12 PM (noon)" : h < 12 ? `${h} AM` : `${h - 12} PM`);
const PROMINENT = ["America/New_York", "Africa/Ouagadougou"];

export interface PrefsView {
  timeZone: string | null;
  quietFrom: number;
  quietTo: number;
  high: boolean;
  digest: boolean;
  resolved: boolean;
  pausedUntil: string | null;
}

function Toggle({ name, label, hint, defaultChecked }: { name: string; label: string; hint: string; defaultChecked: boolean }) {
  return (
    <Row label={label} sub={hint}>
      <Switch name={name} defaultChecked={defaultChecked} label={label} />
    </Row>
  );
}

/** Quiet hours, time zone and which alerts push; the pause buttons. */
export function NotifyPrefsForm({ prefs, zones, businessZone }: { prefs: PrefsView; zones: string[]; businessZone: string }) {
  const [state, action, pending] = useFormState(saveNotifyPrefs, {});
  const [zone, setZone] = useState(prefs.timeZone ?? businessZone);
  const [guessed, setGuessed] = useState(false);
  useEffect(() => {
    if (prefs.timeZone) return;
    const browser = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (browser && zones.includes(browser)) {
      setZone(browser);
      setGuessed(true);
    }
  }, [prefs.timeZone, zones]);
  const rest = zones.filter((z) => !PROMINENT.includes(z));

  return (
    <form onSubmit={action} className="grid gap-7">
      <Group header="Quiet hours" footer="Critical alerts always come through, even in quiet hours. High alerts wait until quiet hours end.">
        <Row label="From">
          <select name="quietFrom" defaultValue={prefs.quietFrom} className={select} aria-label="Quiet from">
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
          </select>
        </Row>
        <Row label="Until">
          <select name="quietTo" defaultValue={prefs.quietTo} className={select} aria-label="Quiet until">
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
          </select>
        </Row>
        <Row label="Time zone" sub={guessed ? "From this device. Save to use it." : undefined}>
          <select name="timeZone" value={zone} onChange={(e) => { setZone(e.target.value); setGuessed(false); }} className={`${select} w-full max-w-[min(15rem,52vw)]`} aria-label="Time zone">
            <optgroup label="Common">
              {PROMINENT.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
            </optgroup>
            <optgroup label="All zones">
              {rest.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
            </optgroup>
          </select>
        </Row>
      </Group>
      <Group header="Alerts">
        <Toggle name="high" label="High alerts" hint="Pushed when they happen (off: they join the noon digest)." defaultChecked={prefs.high} />
        <Toggle name="digest" label="Noon digest" hint="One push at 12:00 summarising medium items." defaultChecked={prefs.digest} />
        <Toggle name="resolved" label="Resolved messages" hint="When a critical or high alert you got clears (not during quiet hours)." defaultChecked={prefs.resolved} />
      </Group>
      <div className="-mt-3 flex flex-wrap items-center gap-3 px-1">
        <button disabled={pending} className={button}>Save</button>
        {state.error && <span className="text-[13px] text-critical">{state.error}</span>}
        {state.ok && <span className="text-[13px] text-ok">✓ {state.ok}</span>}
      </div>
    </form>
  );
}

export function PauseButtons({ pausedUntil, timeZone }: { pausedUntil: string | null; timeZone: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);
  const paused = pausedUntil && now !== null && Date.parse(pausedUntil) > now ? pausedUntil : null;
  const go = (p: PausePreset) => start(async () => setMsg(await pauseAlerts(p)));
  return (
    <div className="grid gap-2">
      {paused && (
        <p className="text-[15px]">
          <span className="mr-2 rounded-full bg-gold/15 px-2 py-0.5 text-[12px] font-semibold text-gold">Paused</span>
          Non-critical pushes wait until {new Date(paused).toLocaleString("en-US", { timeZone, weekday: "short", hour: "numeric", minute: "2-digit" })}.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button className={outline} disabled={pending} onClick={() => go("1h")}><Pause size={13} />1 hour</button>
        <button className={outline} disabled={pending} onClick={() => go("4h")}><Pause size={13} />4 hours</button>
        <button className={outline} disabled={pending} onClick={() => go("morning")}><Pause size={13} />Until 7 AM</button>
        {paused && <button className={outline} disabled={pending} onClick={() => go("off")}><Play size={13} />Resume</button>}
      </div>
      {msg && <span className={`text-[13px] ${msg.error ? "text-critical" : "text-ok"}`}>{msg.error ?? `✓ ${msg.ok}`}</span>}
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid gap-1">
      <span className="text-[13px] text-muted">{label}</span>
      <div className="flex min-w-0 items-stretch gap-2">
        <code className="min-w-0 flex-1 break-all rounded-lg bg-fill px-2.5 py-1.5 font-mono text-[12.5px] text-ink">{value}</code>
        <button type="button" className={outline} onClick={() => navigator.clipboard?.writeText(value).then(() => setCopied(true)).catch(() => {})}><Copy size={13} />{copied ? "Copied" : "Copy"}</button>
      </div>
    </div>
  );
}

/** Owner: makes the scheduler token (shown once) for cron-job.org. */
export function SchedulerLinkForm({ exists }: { exists: boolean }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<SchedulerLink>({});
  const create = () => {
    if (exists && !state.endpoint && !confirm("Create a new scheduler token? The current one stops working until you update cron-job.org.")) return;
    start(async () => setState(await createSchedulerLink()));
  };
  return (
    <div className="grid gap-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={pending} onClick={create} className={exists ? outline : button}>{exists ? "Replace scheduler link" : "Create scheduler link"}</button>
        {state.error && <span className="text-[13px] text-critical">{state.error}</span>}
        {state.ok && <span className="text-[13px] text-ok">✓ {state.ok}</span>}
      </div>
      {state.endpoint && state.header && state.fallbackUrl && (
        <>
          <CopyRow label="URL" value={state.endpoint} />
          <CopyRow label="Header: Authorization" value={state.header} />
          <CopyRow label="Fallback (no headers): token in the URL" value={state.fallbackUrl} />
        </>
      )}
    </div>
  );
}
