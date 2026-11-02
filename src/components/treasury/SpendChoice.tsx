"use client";

import { useTransition } from "react";
import { setSpendChoiceAction } from "@/app/actions/records";
import { segItem } from "@/components/ui";

/** "Use billing API" / "Use my entry" for one vendor (owners only), as an iOS segmented control. */
export function SpendChoice({ vendor, choice }: { vendor: string; choice: "api" | "manual" }) {
  const [pending, start] = useTransition();
  const opt = (value: "api" | "manual", label: string) => (
    <button
      type="button"
      disabled={pending}
      aria-pressed={choice === value}
      onClick={() => choice !== value && start(() => setSpendChoiceAction(vendor, value))}
      className={`${segItem(choice === value)} min-h-9 sm:min-h-7`}
    >
      {label}
    </button>
  );
  return (
    <div role="group" aria-label="Which amount counts in the total" className="inline-flex max-w-full items-center gap-0.5 rounded-[9px] bg-fill p-0.5">
      {opt("api", "Use billing API")}
      {opt("manual", "Use my entry")}
    </div>
  );
}
