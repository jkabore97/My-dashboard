import { redirect } from "next/navigation";
import { currentUser, googleSignInEnabled, memberPasswordsEnabled, microsoftSignInEnabled, passwordSignInEnabled, require2fa } from "@/lib/server/auth";
import { PasswordForm } from "@/components/LoginForms";
import { anyMemberPasswords } from "@/lib/server/store/team";
import { SeverityIcon } from "@/components/ui";
import { AuthPanel, AuthShell, msLogo } from "./shell";

const ERRORS: Record<string, string> = {
  not_allowed: "That account isn't allowed to sign in. Ask the owner to invite you, using the address you sign in to Microsoft with.",
  ms_mismatch: "This address is already linked to a different Microsoft account. Ask the owner to check your invite.",
  microsoft: "Microsoft sign-in failed. Try again.",
  microsoft_disabled: "Microsoft sign-in isn't configured.",
  state: "Sign-in expired or was interrupted. Try again.",
  google: "Google sign-in failed. Try again.",
  google_disabled: "Google sign-in isn't configured.",
};

const big = "hud-btn hud-btn-solid min-h-14 w-full gap-3 text-[13px] tracking-[0.18em]";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  if (await currentUser().catch(() => null)) redirect("/");
  const microsoft = microsoftSignInEnabled();
  const google = googleSignInEnabled();
  const ownerPassword = passwordSignInEnabled();
  const members = memberPasswordsEnabled() && (await anyMemberPasswords().catch(() => false));
  const password = ownerPassword || members;
  const twoFactor = require2fa();
  const intro = microsoft && !google && !password
    ? "Use the Microsoft account the owner invited."
    : google && !microsoft && !password ? "Use the Google account the owner invited." : "Use the account the owner invited.";
  return (
    <AuthShell>
      <div className="mx-auto grid max-w-[1040px] items-start gap-6 md:grid-cols-2 md:gap-8">
        <AuthPanel step={1} label="Identify" title="Sign in">
          <p className="text-[15px] leading-relaxed text-muted">{intro}{twoFactor ? " Everyone then confirms with an authenticator app." : ""}</p>
          {error && (
            <p role="alert" className="mt-4 flex items-start gap-2.5 border border-critical/40 bg-critical/10 px-3 py-2.5 text-sm">
              <SeverityIcon severity="critical" size={18} />
              <span><span className="hud-label mr-1.5 text-[11px] text-critical">Error</span>{ERRORS[error] ?? "Sign-in failed."}</span>
            </p>
          )}
          <div className="mt-6 grid gap-3">
            {microsoft && <a href="/api/auth/microsoft" className={big}>{msLogo}Sign in with Microsoft</a>}
            {google && (
              <a href="/api/auth/google" className={`${big} ${microsoft ? "hud-btn !bg-transparent !shadow-none" : ""}`}>
                <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
                Sign in with Google
              </a>
            )}
          </div>
          {(google || microsoft) && password && <div className="hud-label my-5 flex items-center gap-3 text-[11px] text-muted"><span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" /></div>}
          {password && <div className={google || microsoft ? "" : "mt-6"}><PasswordForm withEmail={members} ownerPassword={ownerPassword} /></div>}
          {!microsoft && !google && !password && (
            <p className="mt-5 text-sm text-muted">No sign-in method is configured. For Microsoft sign-in set <code className="font-mono text-[#9be7ff]">MS_CLIENT_ID</code>, <code className="font-mono text-[#9be7ff]">MS_CLIENT_SECRET</code> and your address in <code className="font-mono text-[#9be7ff]">ALLOWED_EMAILS</code> (see the README).</p>
          )}
          <ul className="mt-6 grid gap-2 border-t border-line/70 pt-5 text-sm text-muted">
            <li className="flex items-center gap-2.5"><span className="h-1.5 w-1.5 bg-emerald shadow-[0_0_6px_#3df5a0]" />Private dashboard · invited accounts only</li>
            {twoFactor && <li className="flex items-center gap-2.5"><span className="h-1.5 w-1.5 bg-emerald shadow-[0_0_6px_#3df5a0]" />Two-step verification required for everyone</li>}
            <li className="flex items-center gap-2.5"><span className="h-1.5 w-1.5 bg-emerald shadow-[0_0_6px_#3df5a0]" />Every sign-in is written to the audit log</li>
          </ul>
          {microsoft && <p className="mt-5 border border-dashed border-line p-4 text-sm leading-relaxed text-muted">Can&apos;t get in? Ask the owner to invite the address you sign in to Microsoft with.</p>}
        </AuthPanel>

        <AuthPanel step={2} label="Verify" title="Two-step verification" accent="#a98bff" state="next" className="hidden md:block">
          <p className="text-[15px] leading-relaxed text-muted">{twoFactor ? "After you sign in, open your authenticator app and enter the 6-digit code it shows, or one of your recovery codes." : "If you've turned on two-step verification, you'll enter the code from your authenticator app next."}</p>
          <div className="mt-6 grid grid-cols-6 gap-2" aria-hidden>
            {Array.from({ length: 6 }, (_, i) => <span key={i} className="aspect-[4/5] border border-violet/40 bg-violet/5" />)}
          </div>
          <p className="hud-label mt-6 text-[11px] text-muted">Unlocks after step 1</p>
        </AuthPanel>
      </div>
    </AuthShell>
  );
}
