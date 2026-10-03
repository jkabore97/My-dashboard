// Limits for outgoing mail. Graph takes attachments up to 3 MB in one request
// (bigger ones need an upload session), and a Vercel function accepts a
// request body of 4.5 MB at most, so everything sent together stays under 4 MB.

export const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_BYTES = 4 * 1024 * 1024;
export const MAX_ATTACHMENTS = 10;
export const MAX_RECIPIENTS = 100;
export const MAX_SUBJECT = 400;
export const MAX_BODY = 100_000;
/** Messages per page in the list. */
export const PAGE_SIZE = 25;
/** Sends per person per hour. */
export const SENDS_PER_HOUR = 60;

export const formatBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
