import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { enrollingUser } from "@/lib/server/auth";
import { otpauthUri } from "@/lib/server/totp";
import { pendingSecret } from "@/lib/server/twofactor";
import { EnrollForm } from "@/components/LoginForms";
import { AuthShell } from "../../shell";

export default async function TwoFactorSetupPage() {
  const email = await enrollingUser();
  if (!email) redirect("/login");
  const secret = await pendingSecret(email);
  const qr = await QRCode.toDataURL(otpauthUri(secret, email), { margin: 1, width: 220, color: { dark: "#0b0d12", light: "#ffffff" } });
  return (
    <AuthShell title="Set up two-step verification">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
        <li>Open an authenticator app (Google Authenticator, 1Password, Authy…).</li>
        <li>Scan this code, or type the key below.</li>
      </ol>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={qr} alt="QR code for your authenticator app" width={220} height={220} className="mx-auto my-4 rounded-lg" />
      <code className="block break-all rounded bg-bg px-2 py-1 text-center text-xs tracking-widest">{secret.match(/.{1,4}/g)?.join(" ")}</code>
      <EnrollForm />
    </AuthShell>
  );
}
