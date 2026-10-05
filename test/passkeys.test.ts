import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// A fake browser: one cookie jar and the request headers the server actions see.
const h = vi.hoisted(() => {
  const jar = new Map<string, string>();
  return {
    jar,
    headers: new Headers({ host: "kaj-command-center.vercel.app" }),
    cookies: {
      get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
      set: (name: string, value: string) => void jar.set(name, value),
      delete: (name: string) => void jar.delete(name),
    },
    verifyRegistrationResponse: vi.fn(),
    verifyAuthenticationResponse: vi.fn(),
  };
});
vi.mock("next/headers", () => ({ cookies: async () => h.cookies, headers: async () => h.headers }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@simplewebauthn/server", async (orig) => ({
  ...(await orig<object>()),
  verifyRegistrationResponse: h.verifyRegistrationResponse,
  verifyAuthenticationResponse: h.verifyAuthenticationResponse,
}));

import { getDb, pgliteDb, useDb } from "@/lib/server/db";
import { currentUser, readSession, sessionMethodAllowed, writeSession } from "@/lib/server/auth";
import { encrypt } from "@/lib/server/crypto";
import { generateSecret, totp } from "@/lib/server/totp";
import { enableTotp, ensureUser, getUser } from "@/lib/server/store/users";
import { inviteMember, setMemberDisabled } from "@/lib/server/store/team";
import { listPasskeys, passkeyCounts } from "@/lib/server/passkeys";
import {
  passkeyLoginOptions,
  passkeyLoginVerify,
  passkeyReauthWithCode,
  passkeyRegisterOptions,
  passkeyRegisterVerify,
  passkeySecondFactorOptions,
  passkeySecondFactorVerify,
  removePasskeyAction,
} from "@/app/actions/passkeys";
import { resetMemberPasskeysAction } from "@/app/actions/team";

const OWNER = "jean@kajconsulting.com";
const MEMBER = "amy@kajconsulting.com";
const ORIGIN = "https://kaj-command-center.vercel.app";
const RPID = "kaj-command-center.vercel.app";

/** Runs a server action that should redirect; returns where to. */
async function redirectOf(p: Promise<unknown>): Promise<string> {
  try {
    const r = await p;
    throw new Error(`expected a redirect, got ${JSON.stringify(r)}`);
  } catch (err) {
    const digest = (err as { digest?: string }).digest;
    if (typeof digest !== "string" || !digest.startsWith("NEXT_REDIRECT")) throw err;
    return digest.split(";")[2];
  }
}

const secrets = new Map<string, string>();
async function withTotp(email: string) {
  const secret = generateSecret();
  secrets.set(email, secret);
  await ensureUser(email);
  await enableTotp(email, encrypt(secret), 0, []);
  return (await getUser(email))!;
}

async function signIn(email: string, stage: "full" | "pending" = "full", method = "microsoft") {
  h.jar.clear();
  const u = (await getUser(email))!;
  await writeSession(email, stage, u.session_version, method);
}

let seq = 0;
/** Stores a passkey directly, as if registered earlier. */
async function addKey(email: string, counter = 0) {
  const db = await getDb();
  const id = `cred${++seq}`;
  await db.query("update users set webauthn_id = coalesce(webauthn_id, $2) where email = $1", [email, `handle-${email.split("@")[0]}`]);
  await db.query("insert into passkeys (id, user_email, public_key, counter, name) values ($1, $2, 'AQID', $3, $4)", [id, email, counter, `key ${seq}`]);
  const [u] = await db.query<{ webauthn_id: string }>("select webauthn_id from users where email = $1", [email]);
  return { id, handle: u.webauthn_id };
}

const assertion = (id: string, userHandle?: string) => ({
  id,
  rawId: id,
  type: "public-key",
  clientExtensionResults: {},
  response: { clientDataJSON: "e30", authenticatorData: "AA", signature: "AA", ...(userHandle ? { userHandle } : {}) },
});

const authOk = (id: string, newCounter = 0) => ({
  verified: true,
  authenticationInfo: { credentialID: id, newCounter, userVerified: true, credentialDeviceType: "multiDevice", credentialBackedUp: true, origin: ORIGIN, rpID: RPID },
});

async function auditActions(): Promise<string[]> {
  const db = await getDb();
  return (await db.query<{ action: string }>("select action from audit_log order by id")).map((r) => r.action);
}

beforeAll(async () => {
  await useDb(await pgliteDb());
});

beforeEach(async () => {
  vi.stubEnv("APP_URL", ORIGIN);
  vi.stubEnv("SIGN_IN_METHODS", "microsoft");
  vi.stubEnv("MS_CLIENT_ID", "id");
  vi.stubEnv("MS_CLIENT_SECRET", "secret");
  vi.stubEnv("ALLOWED_EMAILS", OWNER);
  vi.stubEnv("PASSKEYS", "");
  h.jar.clear();
  h.verifyRegistrationResponse.mockReset();
  h.verifyAuthenticationResponse.mockReset();
  const db = await getDb();
  await db.exec("truncate users cascade; truncate audit_log; truncate rate_limits; truncate webauthn_challenges;");
  await withTotp(OWNER);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("passkey sessions", () => {
  it("are accepted under SIGN_IN_METHODS=microsoft, unless passkeys are switched off", () => {
    expect(sessionMethodAllowed("passkey")).toBe(true);
    expect(sessionMethodAllowed("password")).toBe(false);
    vi.stubEnv("PASSKEYS", "false");
    expect(sessionMethodAllowed("passkey")).toBe(false);
  });
});

describe("adding a passkey", () => {
  it("binds options to APP_URL, requires a discoverable credential with user verification, and verifies against the stored challenge", async () => {
    await signIn(OWNER);
    const r = await passkeyRegisterOptions();
    expect(r.error).toBeUndefined();
    const o = r.options!;
    expect(o.rp.id).toBe(RPID);
    expect(o.authenticatorSelection).toMatchObject({ residentKey: "required", userVerification: "required" });
    expect(o.user.name).toBe(OWNER);
    expect(Buffer.from(o.user.id, "base64url").toString("latin1")).not.toContain("kajconsulting"); // a random handle, not the email
    expect(Buffer.from(o.user.id, "base64url")).toHaveLength(32);

    h.verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: { fmt: "none", aaguid: "00000000-0000-0000-0000-000000000000", credential: { id: "newcred", publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ["internal", "hybrid"] }, credentialType: "public-key", userVerified: true, credentialDeviceType: "multiDevice", credentialBackedUp: true, origin: ORIGIN },
    });
    const response = { id: "newcred", rawId: "newcred", type: "public-key", response: { clientDataJSON: "e30", attestationObject: "AA" }, clientExtensionResults: {} };
    const v = await passkeyRegisterVerify(response, "  iPhone  ");
    expect(v.ok).toMatch(/iPhone/);
    const args = h.verifyRegistrationResponse.mock.calls[0][0];
    expect(args).toMatchObject({ expectedChallenge: o.challenge, expectedOrigin: ORIGIN, expectedRPID: RPID, requireUserVerification: true });
    expect(await listPasskeys(OWNER)).toMatchObject([{ id: "newcred", name: "iPhone", synced: true }]);
    expect(await auditActions()).toContain("passkey.register");

    // The challenge was single-use: replaying the same response fails before verification.
    const again = await passkeyRegisterVerify(response, "iPhone");
    expect(again.error).toMatch(/already used|too long/);
    expect(h.verifyRegistrationResponse).toHaveBeenCalledTimes(1);
  });

  it("derives the RP from APP_URL even when the request comes from another host", async () => {
    h.headers = new Headers({ host: "evil.example" });
    try {
      await signIn(OWNER);
      const r = await passkeyRegisterOptions();
      expect(r.options?.rp.id).toBe(RPID);
    } finally {
      h.headers = new Headers({ host: RPID });
    }
  });

  it("refuses a response without user verification", async () => {
    await signIn(OWNER);
    await passkeyRegisterOptions();
    h.verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: { credential: { id: "c", publicKey: new Uint8Array([1]), counter: 0 }, userVerified: false, credentialDeviceType: "singleDevice", credentialBackedUp: false, origin: ORIGIN },
    });
    const v = await passkeyRegisterVerify({ id: "c", rawId: "c", type: "public-key", response: {} }, "x");
    expect(v.error).toBeTruthy();
    expect(await listPasskeys(OWNER)).toEqual([]);
  });

  it("needs a recent sign-in, or a re-check with the authenticator code", async () => {
    await signIn(OWNER);
    const later = Date.now() + 11 * 60_000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    const r = await passkeyRegisterOptions();
    expect(r).toMatchObject({ reauth: true });
    expect(r.options).toBeUndefined();

    const bad = new FormData();
    bad.set("code", "000000");
    expect((await passkeyReauthWithCode({}, bad)).error).toBeTruthy();
    const good = new FormData();
    good.set("code", totp(secrets.get(OWNER)!, later));
    expect((await passkeyReauthWithCode({}, good)).ok).toBeTruthy();
    expect((await passkeyRegisterOptions()).options).toBeTruthy();
  });

  it("isn't offered before 2FA is set up", async () => {
    await ensureUser("new@kajconsulting.com");
    vi.stubEnv("ALLOWED_EMAILS", `${OWNER},new@kajconsulting.com`);
    vi.stubEnv("REQUIRE_2FA", "false");
    await signIn("new@kajconsulting.com");
    expect((await passkeyRegisterOptions()).error).toMatch(/two-step/);
  });
});

describe("signing in with a passkey", () => {
  it("creates a full session with no TOTP step, recorded as a passkey session", async () => {
    const key = await addKey(OWNER);
    const r = await passkeyLoginOptions();
    expect(r.options?.rpId).toBe(RPID);
    expect(r.options?.userVerification).toBe("required");
    expect(r.options?.allowCredentials ?? []).toEqual([]); // discoverable: no username, no credential list
    h.verifyAuthenticationResponse.mockResolvedValue(authOk(key.id, 0));
    expect(await redirectOf(passkeyLoginVerify(assertion(key.id, key.handle)))).toBe("/");
    expect(h.verifyAuthenticationResponse.mock.calls[0][0]).toMatchObject({ expectedChallenge: r.options!.challenge, expectedOrigin: ORIGIN, expectedRPID: RPID, requireUserVerification: true });
    const s = await readSession();
    expect(s).toMatchObject({ sub: OWNER, stage: "full", m: "passkey" });
    expect(await currentUser()).toMatchObject({ email: OWNER });
    expect(await auditActions()).toContain("login.passkey");
    expect((await listPasskeys(OWNER))[0].lastUsedAt).toBeTruthy();
  });

  it("rejects an expired challenge and a replayed one", async () => {
    const key = await addKey(OWNER);
    await passkeyLoginOptions();
    const db = await getDb();
    await db.query("update webauthn_challenges set expires_at = now() - interval '1 second'");
    h.verifyAuthenticationResponse.mockResolvedValue(authOk(key.id, 0));
    expect((await passkeyLoginVerify(assertion(key.id, key.handle))).error).toMatch(/too long|already used/);
    expect(h.verifyAuthenticationResponse).not.toHaveBeenCalled();

    // A fresh challenge works once; the same response can't be used twice.
    await passkeyLoginOptions();
    const cookie = [...h.jar.entries()].find(([k]) => k === "kcc_wa_login")!;
    await redirectOf(passkeyLoginVerify(assertion(key.id, key.handle)));
    h.jar.set(cookie[0], cookie[1]);
    expect((await passkeyLoginVerify(assertion(key.id, key.handle))).error).toMatch(/too long|already used/);
    expect(h.verifyAuthenticationResponse).toHaveBeenCalledTimes(1);
  });

  it("is blocked for a disabled member and for an owner no longer in ALLOWED_EMAILS", async () => {
    await inviteMember({ email: MEMBER, name: "Amy", role: "assistant", businesses: null, by: OWNER });
    await withTotp(MEMBER);
    const key = await addKey(MEMBER);
    await setMemberDisabled(MEMBER, true);
    await passkeyLoginOptions();
    h.verifyAuthenticationResponse.mockResolvedValue(authOk(key.id, 0));
    expect((await passkeyLoginVerify(assertion(key.id, key.handle))).error).toMatch(/can't sign in/);
    expect(await readSession()).toBeNull();
    expect(await auditActions()).toContain("login.passkey.denied");

    const owner = await addKey(OWNER);
    vi.stubEnv("ALLOWED_EMAILS", "someone-else@kajconsulting.com");
    h.jar.clear();
    await passkeyLoginOptions();
    h.verifyAuthenticationResponse.mockResolvedValue(authOk(owner.id, 0));
    expect((await passkeyLoginVerify(assertion(owner.id, owner.handle))).error).toBeTruthy();
    expect(await readSession()).toBeNull();
  });

  it("rejects a signature counter that didn't go up (cloned authenticator) and stores one that did", async () => {
    const key = await addKey(OWNER, 5);
    for (const n of [5, 3]) {
      h.jar.clear();
      await passkeyLoginOptions();
      h.verifyAuthenticationResponse.mockResolvedValue(authOk(key.id, n));
      expect((await passkeyLoginVerify(assertion(key.id, key.handle))).error).toBeTruthy();
    }
    // The library's own counter check (it throws) is also treated as a failure.
    h.jar.clear();
    await passkeyLoginOptions();
    h.verifyAuthenticationResponse.mockRejectedValue(new Error("Response counter value 4 was lower than expected 5"));
    expect((await passkeyLoginVerify(assertion(key.id, key.handle))).error).toBeTruthy();
    const db = await getDb();
    const [{ detail }] = await db.query<{ detail: { reason: string } }>("select detail from audit_log where action = 'login.passkey.failed' order by id desc limit 1");
    expect(detail.reason).toBe("counter regression");

    h.jar.clear();
    await passkeyLoginOptions();
    h.verifyAuthenticationResponse.mockResolvedValue(authOk(key.id, 6));
    await redirectOf(passkeyLoginVerify(assertion(key.id, key.handle)));
    const [row] = await db.query<{ counter: string }>("select counter from passkeys where id = $1", [key.id]);
    expect(Number(row.counter)).toBe(6);
  });

  it("rejects unknown credentials and a user handle that doesn't match", async () => {
    const key = await addKey(OWNER);
    await passkeyLoginOptions();
    h.verifyAuthenticationResponse.mockResolvedValue(authOk("nope", 0));
    expect((await passkeyLoginVerify(assertion("nope", key.handle))).error).toBeTruthy();
    await passkeyLoginOptions();
    h.verifyAuthenticationResponse.mockResolvedValue(authOk(key.id, 0));
    expect((await passkeyLoginVerify(assertion(key.id, "someone-elses-handle"))).error).toBeTruthy();
    expect(h.verifyAuthenticationResponse).not.toHaveBeenCalled();
  });

  it("is rate limited per IP", async () => {
    vi.stubEnv("TRUSTED_PROXY", "true");
    h.headers = new Headers({ host: RPID, "x-real-ip": "203.0.113.9" });
    try {
      let last: { error?: string } = {};
      for (let i = 0; i < 21; i++) {
        await passkeyLoginOptions();
        last = await passkeyLoginVerify(assertion("unknown"));
      }
      expect(last.error).toMatch(/Too many/);
    } finally {
      h.headers = new Headers({ host: RPID });
    }
  });
});

describe("a passkey on the 2FA step (after Microsoft)", () => {
  it("completes 2FA only with a passkey of the same person", async () => {
    await inviteMember({ email: MEMBER, name: "Amy", role: "assistant", businesses: null, by: OWNER });
    await withTotp(MEMBER);
    const mine = await addKey(OWNER);
    const theirs = await addKey(MEMBER);

    await signIn(OWNER, "pending", "microsoft");
    const r = await passkeySecondFactorOptions();
    expect(r.options?.allowCredentials?.map((c) => c.id)).toEqual([mine.id]);
    h.verifyAuthenticationResponse.mockResolvedValue(authOk(theirs.id, 0));
    expect((await passkeySecondFactorVerify(assertion(theirs.id, theirs.handle))).error).toBeTruthy();
    expect(await readSession()).toMatchObject({ stage: "pending" });
    expect(await auditActions()).toContain("login.2fa.passkey.failed");

    await passkeySecondFactorOptions();
    h.verifyAuthenticationResponse.mockResolvedValue(authOk(mine.id, 0));
    expect(await redirectOf(passkeySecondFactorVerify(assertion(mine.id, mine.handle)))).toBe("/");
    expect(await readSession()).toMatchObject({ sub: OWNER, stage: "full", m: "microsoft" });
    expect(await currentUser()).toMatchObject({ email: OWNER });
  });

  it("can't use a challenge issued to someone else", async () => {
    await inviteMember({ email: MEMBER, name: "Amy", role: "assistant", businesses: null, by: OWNER });
    await withTotp(MEMBER);
    const theirs = await addKey(MEMBER);
    await addKey(OWNER);
    await signIn(MEMBER, "pending");
    await passkeySecondFactorOptions(); // challenge for Amy
    const cookie = h.jar.get("kcc_wa_second_factor")!;
    await signIn(OWNER, "pending"); // same browser, now the owner's pending session
    h.jar.set("kcc_wa_second_factor", cookie);
    h.verifyAuthenticationResponse.mockResolvedValue(authOk(theirs.id, 0));
    expect((await passkeySecondFactorVerify(assertion(theirs.id, theirs.handle))).error).toBeTruthy();
    expect(h.verifyAuthenticationResponse).not.toHaveBeenCalled();
  });
});

describe("removing passkeys", () => {
  it("lets people remove only their own", async () => {
    await inviteMember({ email: MEMBER, name: "Amy", role: "assistant", businesses: null, by: OWNER });
    await withTotp(MEMBER);
    const mine = await addKey(OWNER);
    const theirs = await addKey(MEMBER);
    await signIn(OWNER);
    expect((await removePasskeyAction(theirs.id)).error).toBeTruthy();
    expect((await removePasskeyAction(mine.id)).ok).toBeTruthy();
    expect((await passkeyCounts()).get(MEMBER)).toBe(1);
    expect(await auditActions()).toContain("passkey.remove");
  });

  it("owner reset removes a member's passkeys and signs them out", async () => {
    await inviteMember({ email: MEMBER, name: "Amy", role: "assistant", businesses: null, by: OWNER });
    const before = (await withTotp(MEMBER)).session_version;
    await addKey(MEMBER);
    await addKey(MEMBER);
    await signIn(OWNER);
    const r = await resetMemberPasskeysAction(MEMBER);
    expect(r.ok).toMatch(/Removed 2 passkeys/);
    expect(await listPasskeys(MEMBER)).toEqual([]);
    expect((await getUser(MEMBER))!.session_version).toBeGreaterThan(before);
    expect(await auditActions()).toContain("team.reset_passkeys");
  });
});
