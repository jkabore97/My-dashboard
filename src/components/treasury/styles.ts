import { btn, input as hudInput } from "@/components/ui";

// Class names shared by Treasury forms and row actions (server and client).

/** Small row action: grey pill with blue text, 40px tall on phones for touch, compact from sm up. */
export const act = `${btn()} min-h-10 px-3! py-1! text-[13px]! sm:min-h-8`;
/** Positive row action (Done, Paid, Won): small filled blue pill. */
export const actOk = `${btn("solid")} min-h-10 rounded-full! px-3.5! py-1! text-[13px]! sm:min-h-8`;
/** Main button of a form or header. */
export const primary = `${btn("solid")} min-h-10`;
/** Secondary (Cancel, Close). */
export const ghost = `${btn()} min-h-10`;
export const field = `${hudInput} min-h-10`;
export const label = "mb-1 block text-[13px] text-muted";
/** A labelled field wrapper. */
export const fieldWrap = "flex min-w-0 flex-col";
