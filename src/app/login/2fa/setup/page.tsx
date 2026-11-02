import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { enrollingUser } from "@/lib/server/auth";
import { otpauthUri } from "@/lib/server/totp";
import { pendingSecret } from "@/lib/server/twofactor";
import { EnrollForm } from "@/components/LoginForms";
import { AuthPanel, AuthShell } from "../../shell";

export default async function TwoFactorSetupPage() {
  const email = await enrollingUser();
  if (!email) redirect("/login");
  const secret = await pendingSecret(email);
  const qr = await QRCode.toDataURL(otpauthUri(secret, email), { margin: 1, width: 220, color: { dark: "#0b0d12", light: "#ffffff" } });
  return (
    <AuthShell>
      <div className="mx-auto max-w-[480px]">
        <AuthPanel step={2} label="Verify · first time" title="Set up two-step verification">
          <ol className="grid gap-2 text-[15px] text-muted">
            <li className="flex gap-3"><span className="font-semibold text-ink">1</span>Open an authenticator app (Google Authenticator, 1Password, Authy…).</li>
            <li className="flex gap-3"><span className="font-semibold text-ink">2</span>Scan this code, or type the key below.</li>
            <li className="flex gap-3"><span className="font-semibold text-ink">3</span>Enter the 6-digit code it shows, then save your recovery codes.</li>
          </ol>
          <div className="mx-auto my-5 w-fit rounded-xl bg-white p-2 shadow-[0_0_0_1px_var(--color-line)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="QR code for your authenticator app" width={200} height={200} />
          </div>
          <code className="block break-all rounded-lg bg-fill px-3 py-2 text-center font-mono text-[14px] tracking-widest text-ink">{secret.match(/.{1,4}/g)?.join(" ")}</code>
          <EnrollForm />
        </AuthPanel>
      </div>
    </AuthShell>
  );
}
