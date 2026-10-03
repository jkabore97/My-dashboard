import type { MailAddress } from "@/lib/mail/types";

/** List time: the time today, the date this year, the full date before. */
export function mailDate(iso: string, timeZone: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = (x: Date) => x.toLocaleDateString("en-CA", { timeZone });
  if (day(d) === day(now)) return d.toLocaleTimeString("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" });
  const sameYear = d.toLocaleDateString("en-CA", { timeZone, year: "numeric" }) === now.toLocaleDateString("en-CA", { timeZone, year: "numeric" });
  return d.toLocaleDateString("en-US", { timeZone, month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

/** Full date and time for a message's header. */
export const mailDateTime = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });

export const personName = (a: MailAddress | null | undefined) => (a ? a.name || a.address : "");

/** The list's own query string (mailbox, folder, search, unread, page), carried to a message and back. */
export function listQuery(p: { mb: string; f?: string; q?: string; unread?: boolean; c?: string | null }) {
  const qs = new URLSearchParams({ mb: p.mb });
  if (p.f) qs.set("f", p.f);
  if (p.q) qs.set("q", p.q);
  if (p.unread) qs.set("unread", "1");
  if (p.c) qs.set("c", p.c);
  return qs.toString();
}
