"use server";

import { renderWeeklyReport } from "@/lib/brief";
import { requireOwner, requireSection } from "@/lib/server/auth";
import { inBusiness } from "@/lib/access";
import { emailEnabled, sendEmail } from "@/lib/server/notify";
import { appUrl, buildMorningBrief, knownBusinesses, weeklyReport } from "@/lib/server/reports";
import { audit } from "@/lib/server/store/audit";
import { errorMessage } from "@/lib/source";

export async function emailWeeklyReport(business: string, to: string): Promise<{ ok?: string; error?: string }> {
  const user = await requireSection("reports");
  if (!inBusiness(user, business)) return { error: "Unknown business or date." };
  if (!emailEnabled()) return { error: "Email isn't configured (RESEND_API_KEY, BRIEF_EMAIL_FROM, BRIEF_EMAIL_TO)." };
  if (!(await knownBusinesses()).includes(business) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return { error: "Unknown business or date." };
  try {
    const r = renderWeeklyReport(await weeklyReport(business, to), `${appUrl()}/reports?business=${encodeURIComponent(business)}&to=${to}`);
    // Sent to whoever asked, when they signed in with an email address; otherwise to the brief's recipients.
    await sendEmail(r.subject, r.html, r.text, user.email.includes("@") ? user.email : undefined);
    await audit(user.email, "report.email", business, { to });
    return { ok: "Sent." };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function sendBriefNow(): Promise<{ ok?: string; error?: string }> {
  const user = await requireOwner();
  if (!emailEnabled()) return { error: "Email isn't configured (RESEND_API_KEY, BRIEF_EMAIL_FROM, BRIEF_EMAIL_TO)." };
  try {
    const b = await buildMorningBrief();
    await sendEmail(b.subject, b.html, b.text);
    await audit(user.email, "brief.send_now", null, null);
    return { ok: "Morning brief sent." };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

