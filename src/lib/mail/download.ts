// Headers for attachment downloads (src/app/api/mail/attachment/route.ts).

/** Types a browser may label as what they are; anything else is served as bytes. */
const SAFE_TYPES = /^(image\/(png|jpe?g|gif|webp|heic|bmp)|application\/pdf|text\/plain|text\/csv|application\/(zip|msword|vnd\.[\w.+-]+)|audio\/[\w.+-]+|video\/[\w.+-]+)$/i;

export const safeContentType = (t: string) => (SAFE_TYPES.test(t.split(";")[0].trim()) ? t.split(";")[0].trim() : "application/octet-stream");

/** RFC 6266 filename: an ASCII fallback plus the UTF-8 name. */
export function contentDisposition(name: string) {
  const clean = name.replace(/[\r\n"\\/]+/g, "_").slice(0, 200) || "attachment";
  const ascii = clean.replace(/[^\x20-\x7e]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}
