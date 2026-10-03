"use server";

import { revalidatePath } from "next/cache";
import { invalidateExternal } from "@/lib/aggregate";
import { clientIp, requireOwner, requireUser } from "@/lib/server/auth";
import { auditConnection } from "@/lib/server/connect";
import { sha256Hex } from "@/lib/server/crypto";
import { getAuthed } from "@/lib/server/oauth";
import { fetchSite } from "@/lib/connectors/hikvision";
import { assertPublicHost, siteAccount, validateSiteUrl } from "@/lib/server/site-credentials";
import { audit } from "@/lib/server/store/audit";
import { deleteConnection, listConnections, listConnectionSummaries, saveConnection, updateConnectionLabel, type Provider } from "@/lib/server/store/connections";
import { parseExportTable, parseServiceAccountKey } from "@/lib/billing/google";
import { gcpAccessToken, gcpApi, GcpApiError } from "@/lib/server/gcloud";
import type { GcloudSecret } from "@/lib/server/credentials";
import { billingCachesFor } from "@/lib/server/billing-refresh";
import { clearSlowCaches } from "@/lib/server/slow-cache";

/** Re-saving a connection (e.g. after adding a billing permission to the same token) re-reads only that platform's bills. */
const refreshBillsFor = (provider: string) => clearSlowCaches(billingCachesFor(provider)).catch(() => {});

export interface ConnectState {
  error?: string;
  ok?: string;
}

const replacedNote = (replaced: string[]) => (replaced.length ? `, replacing ${replaced.join(", ")}` : "");
const field = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

/** Saves a pasted API token after checking it actually works. */
export async function saveTokenConnection(_prev: ConnectState, form: FormData): Promise<ConnectState> {
  const user = await requireOwner();
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
      await refreshBillsFor(provider);
      await invalidateExternal();
      revalidatePath("/", "layout");
      return { ok: `Connected Cloudflare (${res.result.name})${replacedNote(replaced)}.` };
    } else if (provider === "hikvision") {
      const url = validateSiteUrl(field(form, "baseUrl"));
      if (!url.ok) return { error: url.error };
      const username = field(form, "username").slice(0, 64);
      if (!username) return { error: "Enter the NVR username." };
      const cfClientId = field(form, "cfClientId").slice(0, 200);
      const cfClientSecret = field(form, "cfClientSecret").slice(0, 200);
      if (!!cfClientId !== !!cfClientSecret) return { error: "Cloudflare Access needs both the client ID and the client secret." };
      const site = { baseUrl: url.url, username, password: token, ...(cfClientId ? { cfClientId, cfClientSecret } : {}) };
      account = siteAccount(url.url);
      // Saving over an existing site would silently swap its address and login.
      if ((await listConnectionSummaries()).some((c) => c.provider === "hikvision" && c.account === account)) {
        return { error: `${account} is already connected. Disconnect it first to change its login, or use a different path for another recorder.` };
      }
      const notPublic = await assertPublicHost(new URL(url.url).hostname).then(() => null, (err: Error) => err.message);
      if (notPublic) return { error: notPublic };
      const label = field(form, "label").slice(0, 80) || account;
      const business = field(form, "business").slice(0, 80) || null;
      // Proves the address, tunnel token and login all work before saving.
      const status = await fetchSite({ id: account, label, business, ...site });
      await saveConnection({ provider, account, label, business, secret: site, meta: { via: "token", model: status.device.model } });
      await auditConnection(user.email, provider, account, "token", []);
      await refreshBillsFor(provider);
      await invalidateExternal();
      revalidatePath("/", "layout");
      return { ok: `Connected ${label}: ${status.device.model ?? "Hikvision device"} with ${status.channels.length} camera${status.channels.length === 1 ? "" : "s"}.` };
    } else if (provider === "stripe") {
      if (!/^(rk|sk)_(live|test)_[A-Za-z0-9]+$/.test(token)) return { error: "Use a secret or restricted key (rk_live_… is best). Publishable keys (pk_…) can't read data." };
      const business = field(form, "business").slice(0, 80);
      if (!business) return { error: "Say which business this Stripe account belongs to." };
      await getAuthed("https://api.stripe.com/v1/balance", token);
      // Restricted keys may not read the account object; fall back to a stable key fingerprint.
      const acct = await getAuthed<{ id: string }>("https://api.stripe.com/v1/account", token).then((a) => a.id).catch(() => `key-${sha256Hex(token).slice(0, 10)}`);
      account = token.includes("_test_") ? `${acct} (test)` : acct;
      // A second key for the same account would count its revenue twice. A key
      // that can't read the account is identified by its fingerprint, so only
      // the very same key is caught then; the help text warns about the rest.
      const existing = (await listConnectionSummaries()).find((c) => c.provider === "stripe" && c.account === account);
      if (existing) return { error: `This Stripe account is already connected (${existing.business ?? existing.label ?? account}). Disconnect it first to replace its key.` };
      await saveConnection({ provider, account, label: business, business, secret, meta: { via: "token" } });
      await auditConnection(user.email, provider, account, "token", []);
      await refreshBillsFor(provider);
      await invalidateExternal();
      revalidatePath("/", "layout");
      return { ok: `Connected Stripe for ${business}.` };
    } else {
      return { error: "This platform connects with the Connect button instead." };
    }
    const replaced = await saveConnection({ provider, account, label: account, secret, meta: { via: "token" } });
    await auditConnection(user.email, provider, account, "token", replaced);
    await refreshBillsFor(provider);
    await invalidateExternal();
      revalidatePath("/", "layout");
    return { ok: `Connected ${account}${replacedNote(replaced)}.` };
  } catch (err) {
    return { error: `The platform rejected that token (${err instanceof Error ? err.message : "unknown error"}).` };
  }
}

export async function disconnect(id: string) {
  const user = await requireOwner();
  const removed = await deleteConnection(id);
  if (removed) await audit(user.email, "connection.remove", `${removed.provider}:${removed.account}`, null, await clientIp());
  await invalidateExternal();
      revalidatePath("/", "layout");
}

export async function relabelConnection(id: string, form: FormData) {
  const user = await requireOwner();
  const label = field(form, "label").slice(0, 80) || null;
  const business = field(form, "business").slice(0, 80) || null;
  await updateConnectionLabel(id, label, business);
  await audit(user.email, "connection.relabel", id, { label, business });
  await invalidateExternal();
      revalidatePath("/", "layout");
}

/** Someone disconnects their own mailbox and calendar (only ever their own). */
export async function disconnectMine(id: string) {
  const user = await requireUser();
  const removed = await deleteConnection(id, { ownerEmail: user.email });
  if (!removed) return;
  await audit(user.email, "connection.remove_personal", `${removed.provider}:${removed.account}`, null, await clientIp());
  await invalidateExternal();
  revalidatePath("/", "layout");
}

/** An owner removes someone's personal mailbox (they never see its content). */
export async function disconnectPersonal(id: string) {
  const user = await requireOwner();
  const removed = await deleteConnection(id, "personal");
  if (!removed) return;
  await audit(user.email, "connection.remove_personal", `${removed.provider}:${removed.account}`, { of: removed.owner_email }, await clientIp());
  await invalidateExternal();
  revalidatePath("/", "layout");
}

/**
 * Google Cloud: a pasted service-account JSON key (checked, then stored
 * encrypted; never sent back) and an optional BigQuery billing-export table.
 * With a key already saved, the key may be left empty to change only the table.
 */
export async function saveGoogleCloudConnection(_prev: ConnectState, form: FormData): Promise<ConnectState> {
  const user = await requireOwner();
  const keyText = String(form.get("key") ?? "");
  const tableText = field(form, "exportTable").slice(0, 300);
  const table = tableText ? parseExportTable(tableText) : null;
  if (tableText && !table) return { error: "The export table id should look like project.dataset.gcp_billing_export_v1_XXXXXX." };
  let secret: GcloudSecret;
  if (keyText.trim()) {
    const parsed = parseServiceAccountKey(keyText);
    if ("error" in parsed) return { error: parsed.error };
    secret = { ...parsed.key, exportTable: table?.id ?? null };
  } else {
    const existing = (await listConnections<GcloudSecret>("gcloud")).filter((c) => !c.ownerEmail).at(-1);
    if (!existing) return { error: "Paste the service account's JSON key." };
    secret = { ...existing.secret, exportTable: table?.id ?? null };
  }
  try {
    // Proves the key works before saving it.
    const token = await gcpAccessToken(secret);
    let warning = "";
    if (table) {
      await gcpApi(token, `https://bigquery.googleapis.com/bigquery/v2/projects/${table.project}/datasets/${table.dataset}/tables/${table.table}`).catch((err: unknown) => {
        warning = err instanceof GcpApiError && (err.status === 403 || err.status === 404)
          ? ` The export table isn't readable yet (${err.status}): grant BigQuery Data Viewer on the dataset and BigQuery Job User on ${table.project}.`
          : ` The export table couldn't be checked (${err instanceof Error ? err.message : "error"}).`;
      });
    }
    const replaced = await saveConnection({ provider: "gcloud", account: secret.clientEmail, label: secret.projectId, secret, meta: { via: "key", projectId: secret.projectId, exportTable: secret.exportTable } });
    await auditConnection(user.email, "gcloud", secret.clientEmail, "token", replaced);
    await refreshBillsFor("gcloud");
    await invalidateExternal();
    revalidatePath("/", "layout");
    return { ok: `Connected Google Cloud as ${secret.clientEmail}${secret.exportTable ? ` with billing export ${secret.exportTable}` : " (no billing export table yet)"}${replacedNote(replaced)}.${warning}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Google Cloud rejected the key." };
  }
}
