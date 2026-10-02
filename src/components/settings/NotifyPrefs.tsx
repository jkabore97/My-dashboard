"use client";

import { useEffect, useState, useTransition } from "react";
import { Copy, Pause, Play } from "lucide-react";
import { useFormState } from "@/components/useFormState";
import { createSchedulerLink, pauseAlerts, saveNotifyPrefs, type PausePreset } from "@/app/actions/alerts";
import { btn } from "@/components/ui";

const button = `${btn("solid")} min-h-10 sm:min-h-0`;
const outline = `${btn()} min-h-10 [--b:#ff5fd7] sm:min-h-0`;
const select = "hud-input min-h-10 px-2 py-1.5 font-mono text-sm";
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
    <label className="flex cursor-pointer items-start gap-3 py-1.5">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="peer sr-only" />
      <span aria-hidden className="relative mt-0.5 inline-block h-5 w-9 shrink-0 border border-line bg-line/30 transition peer-checked:border-emerald/60 peer-checked:bg-emerald/15 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-cyan [&>i]:left-0.5 peer-checked:[&>i]:left-[18px] peer-checked:[&>i]:bg-emerald">
        <i className="absolute top-0.5 h-3.5 w-3.5 bg-muted/60 transition-all" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm">{label}</span>
        <span className="block text-[12px] text-muted">{hint}</span>
      </span>
    </label>
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
    <form onSubmit={action} className="grid gap-3 text-sm">
      <div className="grid gap-2 sm:grid-cols-[auto_1fr] sm:items-center sm:gap-x-3">
        <span className="hud-label text-[11px] text-muted">Quiet hours</span>
        <div className="flex flex-wrap items-center gap-2">
          <select name="quietFrom" defaultValue={prefs.quietFrom} className={select} aria-label="Quiet from">
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
          </select>
          <span className="text-muted">to</span>
          <select name="quietTo" defaultValue={prefs.quietTo} className={select} aria-label="Quiet until">
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
          </select>
        </div>
        <span className="hud-label text-[11px] text-muted">Time zone</span>
        <div className="min-w-0">
          <select name="timeZone" value={zone} onChange={(e) => { setZone(e.target.value); setGuessed(false); }} className={`${select} w-full max-w-full sm:max-w-xs`} aria-label="Time zone">
            <optgroup label="Common">
              {PROMINENT.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
            </optgroup>
            <optgroup label="All zones">
              {rest.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
            </optgroup>
          </select>
          {guessed && <p className="mt-1 text-[12px] text-muted">From this device. Save to use it.</p>}
        </div>
      </div>
      <p className="text-[12px] text-muted">Critical alerts always come through, even in quiet hours. High alerts wait until quiet hours end.</p>
      <div className="grid gap-0.5">
        <Toggle name="high" label="High alerts" hint="Pushed when they happen (off: they join the noon digest)." defaultChecked={prefs.high} />
        <Toggle name="digest" label="Noon digest" hint="One push at 12:00 summarising medium items." defaultChecked={prefs.digest} />
        <Toggle name="resolved" label="Resolved messages" hint="When a critical or high alert you got clears (not during quiet hours)." defaultChecked={prefs.resolved} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} className={button}>Save</button>
        {state.error && <span className="text-xs text-critical">{state.error}</span>}
        {state.ok && <span className="text-xs text-emerald">✓ {state.ok}</span>}
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
        <p className="text-sm">
          <span className="hud-label mr-2 text-[11px] text-gold">Paused</span>
          Non-critical pushes wait until {new Date(paused).toLocaleString("en-US", { timeZone, weekday: "short", hour: "numeric", minute: "2-digit" })}.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button className={outline} disabled={pending} onClick={() => go("1h")}><Pause size={13} />1 hour</button>
        <button className={outline} disabled={pending} onClick={() => go("4h")}><Pause size={13} />4 hours</button>
        <button className={outline} disabled={pending} onClick={() => go("morning")}><Pause size={13} />Until 7 AM</button>
        {paused && <button className={outline} disabled={pending} onClick={() => go("off")}><Play size={13} />Resume</button>}
      </div>
      {msg && <span className={`text-xs ${msg.error ? "text-critical" : "text-emerald"}`}>{msg.error ?? `✓ ${msg.ok}`}</span>}
    </div>
  );
}

/** Owner: makes the scheduler link (shown once) for cron-job.org. */
export function SchedulerLinkForm({ exists }: { exists: boolean }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<{ ok?: string; error?: string; url?: string }>({});
  const [copied, setCopied] = useState(false);
  const create = () => {
    if (exists && !state.url && !confirm("Create a new scheduler link? The current one stops working until you update cron-job.org.")) return;
    start(async () => {
      setCopied(false);
      setState(await createSchedulerLink());
    });
  };
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={pending} onClick={create} className={exists ? outline : button}>{exists ? "Replace scheduler link" : "Create scheduler link"}</button>
        {state.error && <span className="text-xs text-critical">{state.error}</span>}
        {state.ok && <span className="text-xs text-emerald">✓ {state.ok}</span>}
      </div>
      {state.url && (
        <div className="flex min-w-0 items-stretch gap-2">
          <code className="min-w-0 flex-1 break-all bg-cyan/5 px-2 py-1.5 font-mono text-xs text-[#9be7ff]">{state.url}</code>
          <button type="button" className={outline} onClick={() => navigator.clipboard?.writeText(state.url!).then(() => setCopied(true)).catch(() => {})}><Copy size={13} />{copied ? "Copied" : "Copy"}</button>
        </div>
      )}
    </div>
  );
}
