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
      <div className="mx-auto max-w-[440px]">
        <AuthPanel step={2} label="Verify" title="Two-step verification">
          <p className="text-[15px] text-muted">{passkey ? "Use your passkey, or the code from your authenticator app, to confirm" : "Open your authenticator app and enter the code for"}</p>
          <div className="mt-4 flex items-center gap-3 rounded-xl bg-panel-2 px-3.5 py-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-b from-[#a1a1a6] to-[#86868b] text-[14px] font-semibold text-white">{initials(email)}</span>
            <span className="min-w-0 truncate text-[15px] text-ink">{email}</span>
          </div>
          {passkey && (
            <div className="mt-5">
              <PasskeySecondFactor />
              <div className="my-5 flex items-center gap-3 text-[13px] text-muted"><span className="h-px flex-1 bg-line" />or enter a code<span className="h-px flex-1 bg-line" /></div>
            </div>
          )}
          <div className={passkey ? "" : "mt-5"}><TwoFactorForm autoFocus={!passkey} /></div>
          <div className="mt-4 flex flex-wrap justify-between gap-2 text-[14px]">
            <span className="text-muted">Lost your phone? Type a recovery code instead.</span>
            <Link href="/login" className="inline-flex min-h-10 items-center text-cyan hover:underline sm:min-h-0">Use a different account</Link>
          </div>
        </AuthPanel>
      </div>
    </AuthShell>
  );
}
