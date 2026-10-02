"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { CameraOff, Pause, Play, RefreshCw } from "lucide-react";
import { btn } from "@/components/ui";

interface Cam {
  id: number;
  name: string;
  online: boolean | null;
}

const pad = (n: number) => String(n).padStart(2, "0");

function CamStatus({ online }: { online: boolean | null }) {
  if (online === false) {
    return (
      <span className="flex shrink-0 items-center gap-1.5 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-critical">
        <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden><path d="M12 2 22 12 12 22 2 12Z" fill="#ff3d6e33" stroke="#ff3d6e" strokeWidth="2" /></svg>
        Offline
      </span>
    );
  }
  if (online) {
    return (
      <span className="flex shrink-0 items-center gap-1.5 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-emerald">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald shadow-[0_0_6px_#3df5a0]" />
        Online
      </span>
    );
  }
  return <span className="shrink-0 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Unknown</span>;
}

/** Still images from each camera, refreshed every 30 s while the tab is visible. */
export function SnapshotGrid({ site, channels, live }: { site: string; channels: Cam[]; live: boolean }) {
  const [tick, setTick] = useState(() => Date.now());
  const [paused, setPaused] = useState(false);
  const [failed, setFailed] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (!live || paused) return;
    const t = setInterval(() => document.visibilityState === "visible" && setTick(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [live, paused]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3 text-[12.5px] text-muted sm:px-5">
        <span className="mr-auto">{live ? (paused ? "Snapshots paused." : "Snapshots refresh every 30 seconds.") : "Sample recorder: no live images."}</span>
        {live && (
          <>
            <button type="button" className={`${btn()} min-h-10 sm:min-h-0`} style={{ "--b": "#c6f432" } as CSSProperties} onClick={() => { setFailed({}); setTick(Date.now()); }}><RefreshCw size={12} />Refresh</button>
            <button type="button" className={`${btn()} min-h-10 sm:min-h-0`} style={{ "--b": "#c6f432" } as CSSProperties} onClick={() => setPaused((p) => !p)}>{paused ? <><Play size={12} />Resume</> : <><Pause size={12} />Pause</>}</button>
          </>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2.5 p-3 sm:gap-3.5 sm:p-4 lg:grid-cols-3 xl:grid-cols-4">
        {channels.map((c) => {
          const showImage = live && c.online !== false && !failed[c.id];
          return (
            <figure key={c.id} className="min-w-0 border border-violet/30 bg-[#080a18]/60">
              <div className={`relative aspect-video overflow-hidden ${showImage ? "bg-[#0b0d16]" : "bg-[repeating-linear-gradient(45deg,#0c141b_0_6px,#101a23_6px_12px)]"}`}>
                {showImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/cameras/${encodeURIComponent(site)}/${c.id}/snapshot?t=${tick}`}
                    alt={`Latest image from ${c.name}`}
                    className="h-full w-full object-cover"
                    onError={() => setFailed((f) => ({ ...f, [c.id]: true }))}
                    onLoad={() => failed[c.id] && setFailed((f) => ({ ...f, [c.id]: false }))}
                  />
                ) : (
                  <div className={`flex h-full flex-col items-center justify-center gap-1.5 text-center font-display text-[11px] uppercase tracking-[0.14em] ${c.online === false ? "text-critical" : "text-muted"}`}>
                    <CameraOff size={20} className="opacity-80" />
                    {c.online === false ? "Camera offline" : !live ? "Sample camera" : "No image"}
                  </div>
                )}
                <span className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(0deg,rgb(255_255_255/0.03)_0_1px,transparent_1px_3px)]" />
                {showImage && (
                  <span className="absolute bottom-1.5 left-2 hidden max-w-[85%] truncate font-display text-[11px] font-semibold uppercase tracking-[0.12em] text-white [text-shadow:0_0_3px_#000] sm:block">
                    {pad(c.id)} {c.name}
                  </span>
                )}
              </div>
              <figcaption className="flex flex-col gap-1 px-2.5 py-2 text-[12.5px] sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                <span className="min-w-0 truncate"><span className="font-mono text-muted tabular-nums">{pad(c.id)}</span> · {c.name}</span>
                <CamStatus online={c.online} />
              </figcaption>
            </figure>
          );
        })}
      </div>
    </div>
  );
}
