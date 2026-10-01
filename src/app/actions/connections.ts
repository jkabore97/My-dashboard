"use server";

import { revalidatePath } from "next/cache";
import { clientIp, requireUser } from "@/lib/server/auth";
import { getAuthed } from "@/lib/server/oauth";
import { audit } from "@/lib/server/store/audit";
import { deleteConnection, saveConnection, updateConnectionLabel, type Provider } from "@/lib/server/store/connections";

export interface ConnectState {
  error?: string;
  ok?: string;
}

const field = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

/** Saves a pasted API token after checking it actually works. */
export async function saveTokenConnection(_prev: ConnectState, form: FormData): Promise<ConnectState> {
  const user = await requireUser();
  const provider = field(form, "provider") as Provider;
  const token = field(form, "token");
  if (!token || token.length > 500) return { error: "Paste a valid token." };
  try {
    let account: string;
    let secret: Record<string, string> = { token };
    if (provider === "github") {
      account = (await getAuthed<{ login: string }>("https://api.github.com/user", token)).login;
    } else if (provider === "vercel") {
      const teamId = field(form, "teamId");
      const me = await getAuthed<{ user: { username: string } }>("https://api.vercel.com/v2/user", token);
      if (teamId) {
        await getAuthed(`https://api.vercel.com/v2/teams/${encodeURIComponent(teamId)}`, token);
        secret = { token, teamId };
      }
      account = teamId || me.user.username;
    } else if (provider === "supabase") {
      const orgs = await getAuthed<{ id: string; name: string }[]>("https://api.supabase.com/v1/organizations", token);
      account = orgs.map((o) => o.name).join(", ") || "Supabase";
    } else if (provider === "cloudflare") {
      const accountId = field(form, "accountId");
      if (!/^[a-f0-9]{32}$/i.test(accountId)) return { error: "The Cloudflare account ID is the 32-character hex ID on your dashboard." };
      const res = await getAuthed<{ result: { name: string } }>(`https://api.cloudflare.com/client/v4/accounts/${accountId}`, token);
      account = accountId;
      secret = { token, accountId };
      await saveConnection({ provider, account, label: res.result.name, secret, meta: { via: "token" } });
      await audit(user.email, "connection.add", `${provider}:${account}`, { via: "token" }, await clientIp());
      revalidatePath("/", "layout");
      return { ok: `Connected Cloudflare (${res.result.name}).` };
    } else {
      return { error: "This platform connects with the Connect button instead." };
    }
    await saveConnection({ provider, account, label: account, secret, meta: { via: "token" } });
    await audit(user.email, "connection.add", `${provider}:${account}`, { via: "token" }, await clientIp());
    revalidatePath("/", "layout");
    return { ok: `Connected ${account}.` };
  } catch (err) {
    return { error: `The platform rejected that token (${err instanceof Error ? err.message : "unknown error"}).` };
  }
}

export async function disconnect(id: string) {
  const user = await requireUser();
  const removed = await deleteConnection(id);
  if (removed) await audit(user.email, "connection.remove", `${removed.provider}:${removed.account}`, null, await clientIp());
  revalidatePath("/", "layout");
}

export async function relabelConnection(id: string, form: FormData) {
  const user = await requireUser();
  const label = field(form, "label").slice(0, 80) || null;
  const business = field(form, "business").slice(0, 80) || null;
  await updateConnectionLabel(id, label, business);
  await audit(user.email, "connection.relabel", id, { label, business });
  revalidatePath("/", "layout");
}
