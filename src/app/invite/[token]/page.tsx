import Link from "next/link";
import type { Metadata } from "next";
import { Mail } from "lucide-react";
import { AcceptInviteForm } from "@/components/LoginForms";
import { googleSignInEnabled, memberPasswordsEnabled, microsoftSignInEnabled, require2fa } from "@/lib/server/auth";
import { inviteByToken } from "@/lib/server/store/team";
import { PATH_SECTION, ROLE_DESCRIPTION, ROLE_LABEL } from "@/lib/access";
import { NAV_GROUPS } from "@/lib/nav";
import { Tag } from "@/components/ui";
import { ROLE_COLOR, sectionLabels } from "@/components/admin/roles";
import { AuthPanel, AuthShell, msLogo } from "../../login/shell";

export const metadata: Metadata = { referrer: "no-referrer", robots: { index: false, follow: false } };

function Step({ n, title, children, on = false }: { n: number; title: string; children: React.ReactNode; on?: boolean }) {
  return (
    <div className={`border p-3.5 ${on ? "border-cyan shadow-[inset_0_0_0_1px_#3fd0ff]" : "border-line/80"}`}>
      <div className="flex items-center gap-2.5">
        <span className={`grid h-6 w-6 shrink-0 place-items-center border font-mono text-xs ${on ? "border-cyan text-cyan" : "border-ink/60 text-ink"}`}>{n}</span>
        <span className={`hud-label text-[12px] ${on ? "text-cyan" : "text-ink"}`}>{title}</span>
      </div>
      <p className="mt-1.5 text-[13px] leading-snug text-muted">{children}</p>
    </div>
  );
}

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await inviteByToken(token).catch(() => null);
  if (!invite || invite.status !== "ok") {
    return (
      <AuthShell brand="compact" footer={false}>
        <div className="mx-auto max-w-[560px]">
          <AuthPanel title="Invite" accent="#ff5fd7" label="Team invite">
            <p className="text-[15px] text-muted">{invite?.status === "used" ? "This invite was already used. Sign in with the account you joined with." : "This invite link isn't valid or has expired. Ask the person who invited you for a new one."}</p>
            <Link href="/login" className="hud-btn hud-btn-solid mt-6 min-h-11">Go to sign-in</Link>
          </AuthPanel>
        </div>
      </AuthShell>
    );
  }
  const microsoft = microsoftSignInEnabled();
  const passwords = memberPasswordsEnabled();
  const pages = sectionLabels({ role: invite.role, businesses: null, sections: invite.sections }, NAV_GROUPS, PATH_SECTION);
  const color = ROLE_COLOR[invite.role];
  return (
    <AuthShell brand="compact" footer={false}>
      <div className="mx-auto max-w-[700px]">
        <section className="hud-panel" style={{ "--a": "#ff5fd7" } as React.CSSProperties}>
          <div className="border-b border-line/70 bg-[radial-gradient(ellipse_at_top,rgb(255_95_215/0.12),transparent_70%)] px-5 pb-6 pt-8 text-center sm:px-10">
            <div className="mx-auto grid h-20 w-20 rotate-45 place-items-center border border-pink shadow-[0_0_16px_rgb(255_95_215/0.5)]">
              <Mail className="-rotate-45 text-pink" size={26} />
            </div>
            <div className="hud-label mt-6 text-[12px] text-pink">Team invite</div>
            <h1 className="mt-2 font-display text-[26px] font-semibold tracking-[0.04em] sm:text-[30px]">Join Command Center</h1>
            <p className="mt-2 text-[15px] text-muted">Hi <span className="text-ink">{invite.name ?? invite.email}</span>. You&apos;ve been invited as <span className="text-ink">{ROLE_LABEL[invite.role]}</span>.</p>
          </div>
          <div className="px-5 py-6 sm:px-10">
            <div className="flex flex-col items-start gap-3 border p-4 sm:flex-row" style={{ borderColor: `color-mix(in srgb, ${color} 45%, transparent)`, background: `color-mix(in srgb, ${color} 5%, transparent)` }}>
              <Tag color={color}>{ROLE_LABEL[invite.role]}</Tag>
              <p className="text-sm text-muted">{invite.sections ? "With the pages picked for you below." : ROLE_DESCRIPTION[invite.role]}</p>
            </div>
            <div className="hud-label mb-2 mt-5 text-[11px] text-muted">You&apos;ll see</div>
            <ul className="flex flex-wrap gap-2">
              {pages.map((p) => <li key={p} className="border border-line px-3 py-1 text-sm">{p}</li>)}
            </ul>

            <div className="mt-6">
              {microsoft && (
                <a href={`/api/auth/microsoft?login_hint=${encodeURIComponent(invite.email)}`} className="hud-btn hud-btn-solid min-h-16 w-full gap-3 whitespace-normal py-3 text-center">
                  {msLogo}
                  <span className="min-w-0">Sign in with Microsoft as<span className="block break-all font-mono text-[13px] normal-case tracking-normal">{invite.email}</span></span>
                </a>
              )}
              {passwords ? <div className={microsoft ? "mt-6 border-t border-line/70 pt-5" : ""}><AcceptInviteForm token={token} email={invite.email} /></div> : null}
            </div>

            {microsoft && !passwords && (
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <Step n={1} title="Microsoft" on>Sign in with the account for this address.</Step>
                <Step n={2} title="Authenticator">Scan a QR code.{require2fa() ? " Required for everyone." : ""}</Step>
                <Step n={3} title="Recovery codes">Save them, then you&apos;re in.</Step>
              </div>
            )}
            {!passwords && <p className="mt-5 text-center text-[13px] text-muted">Use the Microsoft account for {invite.email}. This link works once.{require2fa() ? " You'll then set up an authenticator app; it's required for everyone." : ""}</p>}
            {googleSignInEnabled() && <p className="mt-4 text-center text-[13px] text-muted">Or skip the password and <Link href="/login" className="text-cyan hover:underline">sign in with Google</Link> as {invite.email}.</p>}
          </div>
        </section>
        <p className="mt-6 text-center text-[13px] text-muted">Not expecting this? You can ignore it.</p>
      </div>
    </AuthShell>
  );
}
