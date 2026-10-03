"use client";

import { useTransition } from "react";
import { setSpendChoiceAction } from "@/app/actions/records";

/** "Use billing API" / "Use my entry" for one vendor (owners only). */
export function SpendChoice({ vendor, choice }: { vendor: string; choice: "api" | "manual" }) {
  const [pending, start] = useTransition();
  const opt = (value: "api" | "manual", label: string) => (
    <button
      type="button"
      disabled={pending}
      aria-pressed={choice === value}
      onClick={() => choice !== value && start(() => setSpendChoiceAction(vendor, value))}
      className={`hud-label min-h-10 border px-2.5 text-[10.5px] sm:min-h-7 ${choice === value ? "border-cyan bg-cyan/10 text-cyan" : "border-line text-muted hover:text-ink"}`}
    >
      {label}
    </button>
  );
  return (
    <div role="group" aria-label="Which amount counts in the total" className="inline-flex gap-1">
      {opt("api", "Use billing API")}
      {opt("manual", "Use my entry")}
    </div>
  );
}
