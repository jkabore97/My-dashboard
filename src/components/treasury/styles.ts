import { btn, input as hudInput } from "@/components/ui";

// Class names shared by Treasury forms and row actions (server and client).

/** Small row action: 40px tall on phones for touch, compact from sm up. */
export const act = `${btn()} min-h-10 px-2.5! py-1! text-[11px]! sm:min-h-8`;
/** Positive row action (Done, Paid, Won). */
export const actOk = `${act} [--b:#3df5a0]`;
/** Main button of a form or header. */
export const primary = `${btn("solid")} min-h-10`;
/** Secondary (Cancel, Close). */
export const ghost = `${btn()} min-h-10 [--b:#7f97ab]`;
export const field = `${hudInput} min-h-10`;
export const label = "hud-label mb-1 block text-[11px] text-muted";
/** A labelled field wrapper. */
export const fieldWrap = "flex min-w-0 flex-col";
