import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import type { TaskView } from "@/lib/server/dashboard";
import type { Website } from "@/lib/types";
import type { CameraSiteStatus } from "@/lib/connectors/hikvision";
import type { SolarStation } from "@/lib/solar";
import { SeverityIcon, timeAgo } from "@/components/ui";
import { FixButton } from "@/components/FixButton";
import { SEV_COLOR, SEV_WORD } from "./hud";
import { uptimeBuckets, type UptimePoint } from "./logic";

/** One line of the priority queue: shape + colored word, title, context and the next action. */
export function QueueRow({ task: t }: { task: TaskView }) {
  const c = SEV_COLOR[t.severity];
  const external = !!t.url && /^https?:/.test(t.url);
  const meta = [t.source, timeAgo(t.createdAt), t.detail].filter(Boolean).join(" · ");
  const bad = t.severity === "critical" || t.severity === "high";
  return (
    <li className="grid grid-cols-[30px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border-b border-line/50 px-4 py-3.5 last:border-0 sm:grid-cols-[34px_minmax(0,1fr)_auto] sm:gap-x-4 sm:px-5">
      <SeverityIcon severity={t.severity} size={26} />
      <div className="min-w-0">
        <div className="hud-label truncate text-[11.5px] font-bold" style={{ color: c }}>
          {SEV_WORD[t.severity]}{t.business ? ` · ${t.business}` : ""}
        </div>
        <div className="mt-0.5 break-words text-[15px] font-medium leading-snug">{t.title}</div>
        <div className="truncate text-[12.5px] text-muted">{meta}</div>
      </div>
      <div className="col-start-2 flex flex-wrap items-center gap-2 sm:col-start-3 sm:justify-end">
        {t.actionable && t.fix ? (
          <FixButton taskId={t.id} label={t.fix} title={t.title} />
        ) : (
          <Link
            href={t.url ?? `/tasks${t.business ? `?business=${encodeURIComponent(t.business)}` : ""}`}
            target={external ? "_blank" : undefined}
            rel={external ? "noreferrer" : undefined}
            className={`hud-btn ${t.severity === "critical" ? "hud-btn-solid" : ""} min-h-10 sm:min-h-0`}
            style={{ "--b": bad ? c : "#ff5fd7" } as CSSProperties}
          >
            {t.severity === "critical" ? "Respond" : "Open"}
          </Link>
        )}
      </div>
    </li>
  );
}

const TICK: Record<Website["status"], string> = {
  up: "linear-gradient(180deg, rgb(46 242 208 / .75), rgb(46 242 208 / .25))",
  degraded: "#ff9f1c",
  down: "#ff3d6e",
  unknown: "#5e7a8f",
};

/** 24 hours of uptime checks per site as a strip, with the share of good checks printed. */
export function UptimeRow({ site, points, now }: { site: Website; points: UptimePoint[]; now: number }) {
  const { ticks, pct } = uptimeBuckets(points, now);
  // The latest check is the site's current status: show it in the newest slot when history hasn't caught up.
  if (ticks[ticks.length - 1] === null && site.status !== "unknown") ticks[ticks.length - 1] = site.status;
  const label = pct === null ? "—" : `${pct.toFixed(pct === 100 ? 0 : 2)}%`;
  const bad = site.status === "down" || site.status === "degraded";
  return (
    <div className="grid grid-cols-[minmax(0,104px)_minmax(0,1fr)_54px] items-center gap-2.5 px-4 py-2 text-[12.5px] sm:grid-cols-[minmax(0,150px)_minmax(0,1fr)_60px] sm:px-5">
      <a href={`https://${site.domain}`} target="_blank" rel="noreferrer" className="min-w-0 truncate hover:text-cyan" title={site.domain}>{site.domain}</a>
      <div className="flex h-4 min-w-0 gap-px sm:gap-[2px]" role="img" aria-label={`${site.domain}: ${pct === null ? "no checks in the last 24 hours" : `${label} of checks up in the last 24 hours`}, now ${site.status}`}>
        {ticks.map((t, i) => (
          <i key={i} className="block min-w-0 flex-1" style={{ background: t ? TICK[t] : "rgb(63 208 255 / .08)", boxShadow: t === "down" || t === "degraded" ? `0 0 6px ${TICK[t]}` : undefined }} />
        ))}
      </div>
      <span className="text-right font-mono tabular-nums" style={{ color: bad ? SEV_COLOR[site.status === "down" ? "critical" : "high"] : undefined }}>
        {bad ? site.status.toUpperCase() : label}
      </span>
    </div>
  );
}

/** Camera channels as tiles: name and online state (offline is a problem, so it's red and says so). */
export function CameraTiles({ sites, max = 8 }: { sites: CameraSiteStatus[]; max?: number }) {
  const channels = sites.flatMap((s) => s.channels.map((c) => ({ ...c, site: s.label, key: `${s.id}:${c.id}` })));
  return (
    <div className="grid grid-cols-4 gap-1.5 px-4 pb-4 pt-3 sm:px-5">
      {channels.slice(0, max).map((c, i) => (
        <Link
          key={c.key}
          href="/cameras"
          title={`${c.site} · ${c.name}: ${c.online === false ? "offline" : c.online ? "online" : "unknown"}`}
          className="relative aspect-[16/10] min-w-0 overflow-hidden border px-1.5 py-1 font-display text-[10.5px] uppercase leading-tight tracking-[0.08em]"
          style={
            c.online === false
              ? { background: "repeating-linear-gradient(45deg,#1a0c14 0 5px,#22101a 5px 10px)", borderColor: "rgb(255 61 110 / .55)", color: "#ff9ab3" }
              : { background: "linear-gradient(140deg,#2a2148,#0f0d22)", borderColor: "rgb(169 139 255 / .3)", color: "#d9ccff" }
          }
        >
          <span className="line-clamp-2 break-words">{String(i + 1).padStart(2, "0")} {c.name}</span>
          {c.online === false && <span className="absolute bottom-1 left-1.5 font-bold text-critical">Offline</span>}
          {c.online === true && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-emerald shadow-[0_0_5px_#3df5a0]" />}
        </Link>
      ))}
    </div>
  );
}

const kw = (w: number | null) => (w === null ? "—" : Math.abs(w) >= 1000 ? `${(w / 1000).toFixed(1)} kW` : `${Math.round(w)} W`);

/** Battery ring and the latest reading of one solar station. */
export function SolarSummary({ station, lowBatteryPct }: { station: SolarStation; lowBatteryPct: number }) {
  const r = station.latest;
  const soc = r.batterySoc;
  const low = soc !== null && soc < lowBatteryPct;
  const C = 2 * Math.PI * 48;
  const exporting = (r.gridW ?? 0) < 0;
  return (
    <div className="grid grid-cols-[104px_minmax(0,1fr)] items-center gap-4 px-4 pb-4 pt-3 sm:grid-cols-[120px_minmax(0,1fr)] sm:px-5">
      <svg viewBox="0 0 120 120" className="h-auto w-full" role="img" aria-label={soc === null ? "Battery level unknown" : `Battery ${Math.round(soc)}%${low ? ", low" : ""}`}>
        <defs>
          <linearGradient id="sol-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#3df5a0" /><stop offset="1" stopColor="#c6f432" /></linearGradient>
        </defs>
        <circle cx="60" cy="60" r="48" fill="none" stroke="rgb(198 244 50 / .14)" strokeWidth="8" />
        {soc !== null && <circle cx="60" cy="60" r="48" fill="none" stroke={low ? "#ff9f1c" : "url(#sol-g)"} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${(soc / 100) * C} ${C}`} transform="rotate(-90 60 60)" style={{ filter: `drop-shadow(0 0 7px ${low ? "#ff9f1c" : "#c6f432"})` }} />}
        <text x="60" y="64" textAnchor="middle" fill="#eaf7ff" fontFamily="var(--font-display)" fontSize="22" fontWeight="600" style={{ fontVariantNumeric: "tabular-nums" }}>{soc === null ? "—" : `${Math.round(soc)}%`}</text>
        <text x="60" y="81" textAnchor="middle" fill={low ? "#ff9f1c" : "#7f97ab"} fontFamily="var(--font-display)" fontSize="9.5" letterSpacing="2">{low ? "LOW BATTERY" : "BATTERY"}</text>
      </svg>
      <div className="min-w-0">
        <Line k="Generated today" v={r.todayKWh === null ? "—" : `${r.todayKWh} kWh`} />
        <Line k="Solar now" v={kw(r.powerW)} />
        <Line k="Load now" v={kw(r.loadW)} />
        <Line k={exporting ? "Exporting" : "Grid import"} v={kw(r.gridW === null ? null : Math.abs(r.gridW))} />
      </div>
    </div>
  );
}

function Line({ k, v }: { k: ReactNode; v: ReactNode }) {
  return (
    <div className="flex justify-between gap-2 border-b border-dashed border-line/70 py-1.5 text-[12.5px] text-muted last:border-0">
      <span className="truncate">{k}</span>
      <b className="shrink-0 font-mono font-medium tabular-nums text-ink">{v}</b>
    </div>
  );
}

/** One cell of the Treasury strip. */
export function MoneyCell({ label, value, c1, c2, children, href, className = "" }: { label: string; value: ReactNode; c1: string; c2: string; children?: ReactNode; href?: string; className?: string }) {
  const body = (
    <>
      <div className="hud-label text-[11.5px] text-muted">{label}</div>
      <div className="mt-1.5 text-[22px] leading-tight sm:text-[28px]">
        <span className="hud-num" style={{ "--c1": c1, "--c2": c2 } as CSSProperties}>{value}</span>
      </div>
      {children}
    </>
  );
  const cls = `block min-w-0 border-b border-line/60 px-4 py-4 sm:px-5 xl:border-b-0 xl:border-r xl:last:border-r-0 ${className}`;
  return href ? <Link href={href} className={`${cls} transition hover:bg-gold/5`}>{body}</Link> : <div className={cls}>{body}</div>;
}

/** A small area sparkline (identity color only). */
export function Sparkline({ values, color = "#3df5a0" }: { values: number[]; color?: string }) {
  if (values.length < 2 || values.every((v) => v === 0)) return null;
  const max = Math.max(...values) || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * 120).toFixed(1)},${(28 - (v / max) * 24).toFixed(1)}`);
  return (
    <svg viewBox="0 0 120 30" preserveAspectRatio="none" className="mt-2 h-8 w-full" aria-hidden>
      <defs>
        <linearGradient id="spark-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".4" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient>
      </defs>
      <path d={`M${pts.join(" L")} L120,30 L0,30Z`} fill="url(#spark-g)" />
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={pts.join(" ")} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
