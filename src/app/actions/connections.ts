"use server";

import { revalidatePath } from "next/cache";
import { clientIp, requireUser } from "@/lib/server/auth";
import { auditConnection } from "@/lib/server/connect";
import { sha256Hex } from "@/lib/server/crypto";
import { getAuthed } from "@/lib/server/oauth";
import { audit } from "@/lib/server/store/audit";
import { deleteConnection, saveConnection, updateConnectionLabel, type Provider } from "@/lib/server/store/connections";

export interface ConnectState {
  error?: string;
  ok?: string;
}

const replacedNote = (replaced: string[]) => (replaced.length ? `, replacing ${replaced.join(", ")}` : "");
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
      const replaced = await saveConnection({ provider, account, label: res.result.name, secret, meta: { via: "token" } });
      await auditConnection(user.email, provider, account, "token", replaced);
      revalidatePath("/", "layout");
      return { ok: `Connected Cloudflare (${res.result.name})${replacedNote(replaced)}.` };
    } else if (provider === "stripe") {
      if (!/^(rk|sk)_(live|test)_[A-Za-z0-9]+$/.test(token)) return { error: "Use a secret or restricted key (rk_live_… is best). Publishable keys (pk_…) can't read data." };
      const business = field(form, "business").slice(0, 80);
      if (!business) return { error: "Say which business this Stripe account belongs to." };
      await getAuthed("https://api.stripe.com/v1/balance", token);
      // Restricted keys may not read the account object; fall back to a stable key fingerprint.
      const acct = await getAuthed<{ id: string }>("https://api.stripe.com/v1/account", token).then((a) => a.id).catch(() => `key-${sha256Hex(token).slice(0, 10)}`);
      account = token.includes("_test_") ? `${acct} (test)` : acct;
      await saveConnection({ provider, account, label: business, business, secret, meta: { via: "token" } });
      await auditConnection(user.email, provider, account, "token", []);
      revalidatePath("/", "layout");
      return { ok: `Connected Stripe for ${business}.` };
    } else {
      return { error: "This platform connects with the Connect button instead." };
    }
    const replaced = await saveConnection({ provider, account, label: account, secret, meta: { via: "token" } });
    await auditConnection(user.email, provider, account, "token", replaced);
    revalidatePath("/", "layout");
    return { ok: `Connected ${account}${replacedNote(replaced)}.` };
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
