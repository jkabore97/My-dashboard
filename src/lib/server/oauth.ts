import { cookies } from "next/headers";
import { randomToken, safeEqual } from "./crypto";
import { isProduction } from "./db";
import { env } from "../source";

/** Public base URL used in OAuth redirect URIs. Set APP_URL in production. */
export function appUrl(req: Request) {
  return (env("APP_URL") ?? new URL(req.url).origin).replace(/\/$/, "");
}

const stateCookie = (flow: string) => `kcc_oauth_${flow}`;

/** CSRF protection: a random state bound to this browser via a short-lived cookie. */
export async function createOAuthState(flow: string) {
  const state = randomToken(24);
  (await cookies()).set(stateCookie(flow), state, { httpOnly: true, secure: isProduction(), sameSite: "lax", path: "/", maxAge: 600 });
  return state;
}

/** Like consumeOAuthState, but leaves the cookie alone when it doesn't match (a callback shared by two flows). */
export async function consumeOAuthStateIfMatches(flow: string, state: string | null) {
  const jar = await cookies();
  const expected = jar.get(stateCookie(flow))?.value;
  if (!expected || !state || !safeEqual(expected, state)) return false;
  jar.delete(stateCookie(flow));
  return true;
}

export async function consumeOAuthState(flow: string, state: string | null) {
  const jar = await cookies();
  const expected = jar.get(stateCookie(flow))?.value;
  jar.delete(stateCookie(flow));
  return !!expected && !!state && safeEqual(expected, state);
}

export async function postForm<T>(url: string, form: Record<string, string>, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", ...headers },
    body: new URLSearchParams(form),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; error_description?: string };
  if (!res.ok || body.error) throw new Error(`Token exchange failed: ${body.error_description ?? body.error ?? res.status}`);
  return body;
}

export async function getAuthed<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "User-Agent": "KajCommandCenter" }, cache: "no-store" });
  if (!res.ok) throw new Error(`${new URL(url).host} returned ${res.status}`);
  return res.json() as Promise<T>;
}
