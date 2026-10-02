"use client";

import { useEffect, useState } from "react";
import { CameraOff, Pause, Play, RefreshCw } from "lucide-react";

interface Cam {
  id: number;
  name: string;
  online: boolean | null;
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
      {live && (
        <div className="mb-3 flex items-center gap-2 text-xs text-muted">
          <span>Snapshots refresh every 30 seconds.</span>
          <button className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 hover:text-ink" onClick={() => { setFailed({}); setTick(Date.now()); }}><RefreshCw size={12} />Refresh</button>
          <button className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 hover:text-ink" onClick={() => setPaused((p) => !p)}>{paused ? <><Play size={12} />Resume</> : <><Pause size={12} />Pause</>}</button>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {channels.map((c) => (
          <figure key={c.id} className="overflow-hidden rounded-lg border border-line bg-bg">
            <div className="relative aspect-video bg-black/80">
              {live && c.online !== false && !failed[c.id] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/cameras/${encodeURIComponent(site)}/${c.id}/snapshot?t=${tick}`}
                  alt={`Latest image from ${c.name}`}
                  className="h-full w-full object-cover"
                  onError={() => setFailed((f) => ({ ...f, [c.id]: true }))}
                  onLoad={() => failed[c.id] && setFailed((f) => ({ ...f, [c.id]: false }))}
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-1 text-xs text-white/70">
                  <CameraOff size={20} />
                  {c.online === false ? "Camera offline" : !live ? "Sample camera" : "No image"}
                </div>
              )}
            </div>
            <figcaption className="flex items-center justify-between px-3 py-2 text-sm">
              <span className="truncate">{c.name}</span>
              <span className={`text-xs ${c.online === false ? "text-critical" : c.online ? "text-ok" : "text-muted"}`}>{c.online === false ? "offline" : c.online ? "online" : "unknown"}</span>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
