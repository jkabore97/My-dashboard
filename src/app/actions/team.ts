"use server";

import { revalidatePath } from "next/cache";
import { clientIp, isEnvOwner, memberPasswordsEnabled, requireOwner } from "@/lib/server/auth";
import { audit } from "@/lib/server/store/audit";
import { getMember, INVITE_DAYS, inviteMember, reissueInvite, removeMember, setMemberDisabled, updateMember } from "@/lib/server/store/team";
import { bumpSessionVersion, resetMicrosoftLink, resetTotp } from "@/lib/server/store/users";
import { emailEnabled, sendEmail } from "@/lib/server/notify";
import { appUrl } from "@/lib/server/reports";
import { parseBusinessList, ROLE_DESCRIPTION, ROLE_LABEL, ROLES, type Role } from "@/lib/access";
import { errorMessage } from "@/lib/source";

export interface TeamState {
  error?: string;
  ok?: string;
  link?: string;
  at?: number;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const text = (f: FormData, k: string, max: number) => String(f.get(k) ?? "").trim().slice(0, max);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function accessFrom(f: FormData): { role: Role; businesses: string[] | null } | { error: string } {
  const role = text(f, "role", 20) as Role;
  if (!ROLES.includes(role)) return { error: "Pick a role." };
  if (f.get("allBusinesses") === "on") return { role, businesses: null };
  const businesses = parseBusinessList([...f.getAll("businesses").map(String), ...text(f, "otherBusinesses", 400).split(",")]);
  if (!businesses) return { error: "Pick at least one business, or All businesses." };
  if (businesses.length > 30) return { error: "That's too many businesses." };
  return { role, businesses };
}

const inviteLink = (token: string) => `${appUrl()}/invite/${token}`;

async function emailInvite(email: string, name: string | null, role: Role, link: string, by: string) {
  if (!emailEnabled()) return false;
  const hi = name ? `Hi ${name},` : "Hi,";
  const how = memberPasswordsEnabled() ? "Set your password here" : `Sign in with your Microsoft account (${email}) here`;
  const text = `${hi}\n\n${by} invited you to Kaj Command Center as ${ROLE_LABEL[role]}: ${ROLE_DESCRIPTION[role]}\n\n${how} (the link works for ${INVITE_DAYS} days):\n${link}\n\nYou'll also set up an authenticator app, which is required for everyone.`;
  const html = `<p>${esc(hi)}</p><p>${esc(by)} invited you to <strong>Kaj Command Center</strong> as <strong>${ROLE_LABEL[role]}</strong>: ${esc(ROLE_DESCRIPTION[role])}</p><p><a href="${esc(link)}">${esc(how)}</a> (the link works for ${INVITE_DAYS} days).</p><p>You'll also set up an authenticator app, which is required for everyone.</p>`;
  await sendEmail("You're invited to Kaj Command Center", html, text, email);
  return true;
}

export async function inviteMemberAction(_prev: TeamState, f: FormData): Promise<TeamState> {
  const user = await requireOwner();
  const email = text(f, "email", 200).toLowerCase();
  const name = text(f, "name", 80) || null;
  if (!EMAIL.test(email)) return { error: "Enter their email address." };
  if (isEnvOwner(email)) return { error: "That address is already an owner (set in the environment)." };
  const access = accessFrom(f);
  if ("error" in access) return { error: access.error };
  const res = await inviteMember({ email, name, ...access, by: user.email });
  if ("error" in res) return { error: res.error };
  const link = inviteLink(res.token);
  await audit(user.email, "team.invite", email, { ...access }, await clientIp());
  const emailed = await emailInvite(email, name, access.role, link, user.name).catch((err) => (console.error(`[team] invite email: ${errorMessage(err)}`), false));
  revalidatePath("/team");
  return { ok: emailed ? `Invite emailed to ${email}. You can also send them this link:` : `Send ${email} this link (it works once, for ${INVITE_DAYS} days):`, link, at: Date.now() };
}

export async function updateMemberAction(_prev: TeamState, f: FormData): Promise<TeamState> {
  const user = await requireOwner();
  const email = text(f, "email", 200).toLowerCase();
  if (email === user.email) return { error: "You can't change your own access. Ask another owner." };
  const access = accessFrom(f);
  if ("error" in access) return { error: access.error };
  if (!(await updateMember(email, { name: text(f, "name", 80) || null, ...access }))) return { error: "That person is no longer on the team." };
  await audit(user.email, "team.update", email, { ...access }, await clientIp());
  revalidatePath("/", "layout");
  return { ok: "Saved. It applies on their next page load.", at: Date.now() };
}

export async function reissueInviteAction(email: string): Promise<TeamState> {
  const user = await requireOwner();
  const member = await getMember(email);
  if (!member) return { error: "That person is no longer on the team." };
  const token = await reissueInvite(email, user.email);
  if (!token) return { error: "That person is no longer on the team." };
  const link = inviteLink(token);
  await audit(user.email, "team.invite_reissued", email, null, await clientIp());
  const emailed = await emailInvite(email, member.name, member.role, link, user.name).catch(() => false);
  revalidatePath("/team");
  return { ok: emailed ? "New invite emailed. The old link no longer works. Link:" : "New link (the old one no longer works):", link, at: Date.now() };
}

export async function setMemberDisabledAction(email: string, disabled: boolean): Promise<TeamState> {
  const user = await requireOwner();
  if (email === user.email) return { error: "You can't disable yourself." };
  if (!(await setMemberDisabled(email, disabled))) return { error: "That person is no longer on the team." };
  await audit(user.email, disabled ? "team.disable" : "team.enable", email, null, await clientIp());
  revalidatePath("/team");
  return { ok: disabled ? "Disabled and signed out." : "Enabled.", at: Date.now() };
}

export async function removeMemberAction(email: string): Promise<TeamState> {
  const user = await requireOwner();
  if (email === user.email) return { error: "You can't remove yourself." };
  if (!(await removeMember(email))) return { error: "That person is no longer on the team." };
  await audit(user.email, "team.remove", email, null, await clientIp());
  revalidatePath("/", "layout");
  return { ok: "Removed. Their tasks are now unassigned.", at: Date.now() };
}

/** For a member who lost their phone: removes their 2FA and signs them out; they set it up again at next sign-in. */
export async function resetMemberTwoFactorAction(email: string): Promise<TeamState> {
  const user = await requireOwner();
  if (email === user.email) return { error: "Reset your own 2FA from Settings." };
  if (!(await getMember(email))) return { error: "That person is no longer on the team." };
  await resetTotp(email);
  await bumpSessionVersion(email);
  await audit(user.email, "team.reset_2fa", email, null, await clientIp());
  revalidatePath("/team");
  return { ok: "2FA reset. They'll set it up again when they next sign in.", at: Date.now() };
}

/** For a member whose Microsoft account was recreated: their next Microsoft sign-in links the new one. */
export async function resetMicrosoftLinkAction(email: string): Promise<TeamState> {
  const user = await requireOwner();
  if (email === user.email) return { error: "Ask another owner to do this for you." };
  if (!(await getMember(email))) return { error: "That person is no longer on the team." };
  if (!(await resetMicrosoftLink(email))) return { error: "They haven't signed in with Microsoft yet." };
  await audit(user.email, "team.reset_microsoft_link", email, null, await clientIp());
  revalidatePath("/team");
  return { ok: "Microsoft link reset and signed out. Their next Microsoft sign-in links the account they use.", at: Date.now() };
}
