"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/server/auth";
import { BUSINESS_COOKIE } from "@/lib/server/view";

/** Shows one business everywhere (or all of them again with null). A view setting, not access control. */
export async function setBusinessFilter(business: string | null) {
  await requireUser();
  const jar = await cookies();
  const name = business?.trim().slice(0, 80);
  if (name) jar.set(BUSINESS_COOKIE, name, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 180 });
  else jar.delete(BUSINESS_COOKIE);
  revalidatePath("/", "layout");
}
