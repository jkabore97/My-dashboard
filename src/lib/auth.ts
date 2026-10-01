export const SESSION_COOKIE = "kcc_session";

// The cookie holds a hash of the password, so changing DASHBOARD_PASSWORD
// logs every device out.
export async function sessionToken(password: string) {
  const data = new TextEncoder().encode(`kcc:v1:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
