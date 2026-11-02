import { SYS } from "@/components/ui";
import type { ScorePart } from "./logic";
import { scoreWord } from "./logic";

const COLOR: Record<ScorePart["key"], string> = { code: SYS.blue, twofa: SYS.purple, database: SYS.mint };

/** Concentric Apple Fitness-style rings, one per scored area, with the overall score in the middle. */
export function ScoreRings({ score, parts }: { score: number | null; parts: ScorePart[] }) {
  const radii = [86, 68, 50];
  const width = 15;
  const word = score == null ? "No data" : scoreWord(score);
  const wordColor = score == null ? "var(--color-muted)" : score >= 90 ? "var(--color-ok)" : score >= 70 ? "var(--color-gold)" : "var(--color-warn)";
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[220px]" role="img" aria-label={score == null ? "No security score yet" : `Security score ${score} of 100, ${word}. ${parts.map((p) => `${p.label} ${p.score}`).join(", ")}`}>
      <svg viewBox="-100 -100 200 200" className="h-full w-full" aria-hidden>
        {parts.slice(0, 3).map((p, i) => {
          const r = radii[i];
          const c = 2 * Math.PI * r;
          const col = COLOR[p.key];
          return (
            <g key={p.key}>
              <circle r={r} fill="none" stroke={`color-mix(in srgb, ${col} 18%, transparent)`} strokeWidth={width} />
              <circle r={r} fill="none" stroke={col} strokeWidth={width} strokeLinecap="round" strokeDasharray={`${(Math.max(0.5, p.score) / 100) * c} ${c}`} transform="rotate(-90)" />
            </g>
          );
        })}
        {parts.length === 0 && <circle r={radii[0]} fill="none" stroke="var(--color-fill)" strokeWidth={width} />}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[34px] font-bold leading-none tabular-nums tracking-[-0.02em] text-ink">{score ?? "—"}</span>
        <span className="mt-1 text-[12px] font-semibold" style={{ color: wordColor }}>{word}</span>
      </div>
    </div>
  );
}

export const PART_COLOR = COLOR;
