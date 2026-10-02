/**
 * Several series on one time axis, rendered on the server: recessive grid,
 * labelled y axis, legend below, and a table view for exact values. Gaps
 * (null) break the line instead of being drawn as zero.
 */
export function MultiLine({ series, labels, unit = "", height = 220, label }: { series: { name: string; color: string; values: (number | null)[] }[]; labels: string[]; unit?: string; height?: number; label: string }) {
  const n = labels.length;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  if (!all.length || n < 2) return <p className="py-8 text-center text-sm text-muted">No timed checks in this window yet.</p>;
  const W = 600;
  const H = height;
  const top = 12;
  const bottom = H - 8;
  const max = niceMax(Math.max(...all));
  const x = (i: number) => (i / (n - 1)) * W;
  const y = (v: number) => bottom - (v / max) * (bottom - top);
  const path = (vals: (number | null)[]) => {
    let d = "";
    let pen = false;
    vals.forEach((v, i) => {
      if (v == null) return void (pen = false);
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      pen = true;
    });
    return d.trim();
  };
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
  const step = Math.max(1, Math.ceil(n / 4));
  return (
    <div>
      <div className="relative" style={{ height: H }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" role="img" aria-label={label}>
          {ticks.map((t) => <line key={t} x1={0} x2={W} y1={y(t)} y2={y(t)} stroke="rgb(63 208 255 / 0.1)" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
          {series.map((s, k) => (
            <path key={s.name} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={k === 0 ? 1.8 : 1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" style={{ filter: `drop-shadow(0 0 4px ${s.color})` }} />
          ))}
        </svg>
        {ticks.slice(1).map((t) => (
          <span key={t} className="pointer-events-none absolute left-0.5 -translate-y-full font-mono text-[10px] text-[#5e7a8f]" style={{ top: `${(y(t) / H) * 100}%` }}>{t}{t === ticks[4] && unit ? ` ${unit}` : ""}</span>
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-[#5e7a8f]">
        {labels.filter((_, i) => i % step === 0 || i === n - 1).map((l, i) => <span key={`${l}-${i}`}>{l}</span>)}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11.5px] text-[#c5d3de]">
        {series.map((s) => (
          <li key={s.name} className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-3" style={{ background: s.color, boxShadow: `0 0 6px ${s.color}` }} />{s.name}</li>
        ))}
      </ul>
      <details className="mt-2 text-xs">
        <summary className="inline-flex min-h-10 cursor-pointer items-center text-accent sm:min-h-0">Show as table</summary>
        <div className="mt-2 max-h-56 overflow-auto">
          <table className="w-full text-left font-mono text-[11px] tabular-nums">
            <thead className="text-muted"><tr><th className="py-1 pr-3 font-normal">Time</th>{series.map((s) => <th key={s.name} className="py-1 pr-3 text-right font-normal">{s.name}</th>)}</tr></thead>
            <tbody>
              {labels.map((l, i) => (
                <tr key={`${l}-${i}`} className="border-t border-line/60"><td className="py-1 pr-3">{l}</td>{series.map((s) => <td key={s.name} className="py-1 pr-3 text-right">{s.values[i] ?? "—"}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * mag >= v) return m * mag;
  return 10 * mag;
}
