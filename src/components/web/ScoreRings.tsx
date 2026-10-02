import type { ScorePart } from "./logic";
import { scoreWord } from "./logic";

const COLOR: Record<ScorePart["key"], string> = { code: "#2ef2d0", twofa: "#a98bff", database: "#3fd0ff" };

/** Concentric rings, one per scored area, with the overall score in the middle. */
export function ScoreRings({ score, parts }: { score: number | null; parts: ScorePart[] }) {
  const radii = [80, 66, 54];
  const widths = [8, 6, 5];
  const word = score == null ? "No data" : scoreWord(score);
  const wordColor = score == null ? "#7f97ab" : score >= 90 ? "#3df5a0" : score >= 70 ? "#ffd84d" : "#ff9f1c";
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[230px]" role="img" aria-label={score == null ? "No security score yet" : `Security score ${score} of 100, ${word}. ${parts.map((p) => `${p.label} ${p.score}`).join(", ")}`}>
      <svg viewBox="-100 -100 200 200" className="h-full w-full" aria-hidden>
        {Array.from({ length: 60 }, (_, i) => {
          const a = (i / 60) * 2 * Math.PI;
          return <line key={i} x1={92 * Math.cos(a)} y1={92 * Math.sin(a)} x2={97 * Math.cos(a)} y2={97 * Math.sin(a)} stroke="rgb(46 242 208 / 0.4)" strokeWidth={i % 5 ? 0.8 : 1.6} />;
        })}
        {parts.slice(0, 3).map((p, i) => {
          const r = radii[i];
          const c = 2 * Math.PI * r;
          const col = COLOR[p.key];
          return (
            <g key={p.key}>
              <circle r={r} fill="none" stroke="rgb(255 255 255 / 0.06)" strokeWidth={widths[i]} />
              <circle r={r} fill="none" stroke={col} strokeWidth={widths[i]} strokeLinecap="round" strokeDasharray={`${(Math.max(0.5, p.score) / 100) * c} ${c}`} transform="rotate(-90)" style={{ filter: `drop-shadow(0 0 6px ${col})` }} />
            </g>
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="hud-label text-[10px] text-muted">Score</span>
        <span className="font-display text-[40px] font-bold leading-none tabular-nums text-[#eaf7ff]">{score ?? "—"}</span>
        <span className="hud-label mt-1 text-[10px]" style={{ color: wordColor }}>{word}</span>
      </div>
    </div>
  );
}

export const PART_COLOR = COLOR;
