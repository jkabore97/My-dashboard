import Link from "next/link";
import type { Metadata } from "next";
import { AcceptInviteForm } from "@/components/LoginForms";
import { googleSignInEnabled, memberPasswordsEnabled, microsoftSignInEnabled } from "@/lib/server/auth";
import { inviteByToken } from "@/lib/server/store/team";
import { ROLE_DESCRIPTION, ROLE_LABEL } from "@/lib/access";
import { AuthShell } from "../../login/shell";

export const metadata: Metadata = { referrer: "no-referrer", robots: { index: false, follow: false } };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await inviteByToken(token).catch(() => null);
  if (!invite || invite.status !== "ok") {
    return (
      <AuthShell title="Invite">
        <p className="text-sm text-muted">{invite?.status === "used" ? "This invite was already used. Sign in with your email and password." : "This invite link isn't valid or has expired. Ask the person who invited you for a new one."}</p>
        <Link href="/login" className="mt-4 inline-block text-sm text-accent hover:underline">Go to sign-in</Link>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Join Command Center">
      <p className="mb-1 text-sm">Hi {invite.name ?? invite.email}. You&apos;ve been invited as <strong>{ROLE_LABEL[invite.role]}</strong>.</p>
      <p className="mb-5 text-xs text-muted">{ROLE_DESCRIPTION[invite.role]}</p>
      {microsoftSignInEnabled() && (
        <a href={`/api/auth/microsoft?login_hint=${encodeURIComponent(invite.email)}`} className="mb-3 flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 font-medium text-bg hover:opacity-90">
          Sign in with Microsoft as {invite.email}
        </a>
      )}
      {memberPasswordsEnabled() ? <AcceptInviteForm token={token} email={invite.email} /> : <p className="text-xs text-muted">Use the Microsoft account for {invite.email}. You&apos;ll then set up an authenticator app; it&apos;s required for everyone.</p>}
      {googleSignInEnabled() && <p className="mt-4 text-xs text-muted">Or skip the password and <Link href="/login" className="text-accent hover:underline">sign in with Google</Link> as {invite.email}.</p>}
    </AuthShell>
  );
}
