import Link from "next/link";
import { redirect } from "next/navigation";
import { pendingUser } from "@/lib/server/auth";
import { getUser } from "@/lib/server/store/users";
import { PasskeySecondFactor, TwoFactorForm } from "@/components/LoginForms";
import { countPasskeys, passkeysUsableHere } from "@/lib/server/passkeys";
import { AuthPanel, AuthShell } from "../shell";

const initials = (email: string) => email.split("@")[0].replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "?";

export default async function TwoFactorPage() {
  const email = await pendingUser();
  if (!email) redirect("/login");
  if (!(await getUser(email))?.totp_enabled_at) redirect("/login/2fa/setup");
  const passkey = (await passkeysUsableHere().catch(() => false)) && (await countPasskeys(email).catch(() => 0)) > 0;
  return (
    <AuthShell>
      <div className="mx-auto grid max-w-[1040px] items-start gap-6 md:grid-cols-2 md:gap-8">
        <AuthPanel step={1} label="Identify" title="Signed in" state="done" className="hidden md:block">
          <p className="text-[15px] text-muted">First step done. One more check and you&apos;re in.</p>
        </AuthPanel>
        <AuthPanel step={2} label="Verify" title="Two-step verification" accent="#a98bff">
          <p className="text-[15px] text-muted">{passkey ? "Use your passkey, or the code from your authenticator app, to confirm" : "Open your authenticator app and enter the code for"}</p>
          <div className="mt-4 flex items-center gap-3 border border-line bg-bg/40 px-4 py-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center bg-gradient-to-br from-cyan to-violet font-display text-sm font-bold text-bg">{initials(email)}</span>
            <span className="min-w-0 truncate text-[15px] text-ink">{email}</span>
          </div>
          {passkey && (
            <div className="mt-5">
              <PasskeySecondFactor />
              <div className="hud-label my-5 flex items-center gap-3 text-[11px] text-muted"><span className="h-px flex-1 bg-line" />or enter a code<span className="h-px flex-1 bg-line" /></div>
            </div>
          )}
          <div className={passkey ? "" : "mt-5"}><TwoFactorForm autoFocus={!passkey} /></div>
          <div className="mt-4 flex flex-wrap justify-between gap-2 text-sm">
            <span className="text-muted">Lost your phone? Type a recovery code instead.</span>
            <Link href="/login" className="inline-flex min-h-10 items-center text-muted hover:text-ink sm:min-h-0">Use a different account</Link>
          </div>
        </AuthPanel>
      </div>
    </AuthShell>
  );
}
