import Link from "next/link";
import { redirect } from "next/navigation";
import { pendingUser } from "@/lib/server/auth";
import { getUser } from "@/lib/server/store/users";
import { TwoFactorForm } from "@/components/LoginForms";
import { AuthShell } from "../shell";

export default async function TwoFactorPage() {
  const email = await pendingUser();
  if (!email) redirect("/login");
  if (!(await getUser(email))?.totp_enabled_at) redirect("/login/2fa/setup");
  return (
    <AuthShell title="Two-step verification">
      <p className="mb-4 text-sm text-muted">Open your authenticator app and enter the code for <strong className="text-ink">{email}</strong>.</p>
      <TwoFactorForm />
      <Link href="/login" className="mt-4 block text-center text-xs text-muted hover:text-ink">Use a different account</Link>
    </AuthShell>
  );
}
