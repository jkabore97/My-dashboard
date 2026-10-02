"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Pages render at once from the last saved platform data. When that was over a
// minute old the server refetches in the background; this reloads the data
// once, a few seconds later, so the screen catches up without a manual reload.
const STALE_MS = 60_000;
const WAIT_MS = 8_000;
let refreshedFor = 0;

export function AutoRefresh({ at }: { at: number }) {
  const router = useRouter();
  useEffect(() => {
    if (Date.now() - at < STALE_MS || refreshedFor === at) return;
    const timer = setTimeout(() => {
      refreshedFor = at;
      router.refresh();
    }, WAIT_MS);
    return () => clearTimeout(timer);
  }, [at, router]);
  return null;
}
