import { cookies } from "next/headers";

export const BUSINESS_COOKIE = "kcc_biz";

/** The business the viewer chose to focus on, if any. */
export async function businessFilter(): Promise<string | null> {
  try {
    return (await cookies()).get(BUSINESS_COOKIE)?.value || null;
  } catch {
    return null; // outside a request (cron, tests)
  }
}
