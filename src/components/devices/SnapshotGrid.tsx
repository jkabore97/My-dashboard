"use client";

import { useEffect, useState } from "react";
import { CameraOff, Pause, Play, RefreshCw } from "lucide-react";
import { btn } from "@/components/ui";

interface Cam {
  id: number;
  name: string;
  online: boolean | null;
}

const pad = (n: number) => String(n).padStart(2, "0");

function CamStatus({ online }: { online: boolean | null }) {
  const [dot, text, word] = online === false ? ["var(--color-critical)", "var(--color-critical)", "Offline"] : online ? ["var(--color-ok)", "var(--color-ok)", "Online"] : ["var(--color-low)", "var(--color-muted)", "Unknown"];
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-[13px] font-medium" style={{ color: text }}>
      <span className="h-2 w-2 rounded-full" style={{ background: dot }} />
      {word}
    </span>
  );
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
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3.5 text-[13px] text-muted sm:px-5">
        <span className="mr-auto">{live ? (paused ? "Snapshots paused." : "Snapshots refresh every 30 seconds.") : "Sample recorder: no live images."}</span>
        {live && (
          <>
            <button type="button" className={`${btn()} min-h-10 sm:min-h-0`} onClick={() => { setFailed({}); setTick(Date.now()); }}><RefreshCw size={14} />Refresh</button>
            <button type="button" className={`${btn()} min-h-10 sm:min-h-0`} onClick={() => setPaused((p) => !p)}>{paused ? <><Play size={14} />Resume</> : <><Pause size={14} />Pause</>}</button>
          </>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2.5 p-3 sm:gap-3.5 sm:p-4 lg:grid-cols-3 xl:grid-cols-4">
        {channels.map((c) => {
          const showImage = live && c.online !== false && !failed[c.id];
          return (
            <figure key={c.id} className="min-w-0 overflow-hidden rounded-xl bg-panel-2">
              <div className={`relative aspect-video overflow-hidden ${showImage ? "bg-black" : "bg-fill"}`}>
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
                  <div className={`flex h-full flex-col items-center justify-center gap-1.5 text-center text-[13px] font-medium ${c.online === false ? "text-critical" : "text-muted"}`}>
                    <CameraOff size={20} className="opacity-80" />
                    {c.online === false ? "Camera offline" : !live ? "Sample camera" : "No image"}
                  </div>
                )}
                {showImage && (
                  <span className="absolute bottom-1.5 left-1.5 hidden max-w-[85%] truncate rounded-md bg-black/55 px-1.5 py-0.5 text-[12px] font-medium text-white backdrop-blur-sm sm:block">
                    {pad(c.id)} {c.name}
                  </span>
                )}
              </div>
              <figcaption className="flex flex-col gap-0.5 px-3 py-2 text-[13px] sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                <span className="min-w-0 truncate text-ink"><span className="text-muted tabular-nums">{pad(c.id)}</span> · {c.name}</span>
                <CamStatus online={c.online} />
              </figcaption>
            </figure>
          );
        })}
      </div>
    </div>
  );
}
