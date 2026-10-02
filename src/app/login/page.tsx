import { redirect } from "next/navigation";
import { currentUser, googleSignInEnabled, passwordSignInEnabled } from "@/lib/server/auth";
import { PasswordForm } from "@/components/LoginForms";
import { anyMemberPasswords } from "@/lib/server/store/team";
import { AuthShell } from "./shell";

const ERRORS: Record<string, string> = {
  not_allowed: "That Google account isn't allowed to sign in.",
  state: "Sign-in expired or was interrupted. Try again.",
  google: "Google sign-in failed. Try again.",
  google_disabled: "Google sign-in isn't configured.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  if (await currentUser().catch(() => null)) redirect("/");
  const google = googleSignInEnabled();
  const ownerPassword = passwordSignInEnabled();
  const members = await anyMemberPasswords().catch(() => false);
  const password = ownerPassword || members;
  return (
    <AuthShell title="Command Center">
      {error && <p className="mb-4 rounded-lg bg-critical/10 px-3 py-2 text-sm text-critical">{ERRORS[error] ?? "Sign-in failed."}</p>}
      {google && (
        <a href="/api/auth/google" className="flex w-full items-center justify-center gap-2 rounded-lg border border-line bg-bg px-3 py-2 font-medium hover:border-accent/60">
          <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
          Sign in with Google
        </a>
      )}
      {google && password && <div className="my-4 text-center text-xs uppercase tracking-wider text-muted">or</div>}
      {password && <PasswordForm withEmail={members} ownerPassword={ownerPassword} />}
      {!google && !password && (
        <p className="text-sm text-muted">No sign-in method is configured. Set <code>DASHBOARD_PASSWORD</code>, or <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code> and <code>ALLOWED_EMAILS</code>.</p>
      )}
    </AuthShell>
  );
}
