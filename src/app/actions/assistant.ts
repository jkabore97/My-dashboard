"use server";

import { revalidatePath } from "next/cache";
import { requireSection, requireUser } from "@/lib/server/auth";
import { canSeeTask } from "@/lib/access";
import { AiRefusal, aiEnabled, askDashboard, draftReply } from "@/lib/server/ai";
import { buildAskContext } from "@/lib/server/ask-context";
import { getDashboard } from "@/lib/server/dashboard";
import { fixForTask, runFix } from "@/lib/server/fixes";
import { audit } from "@/lib/server/store/audit";
import { takeAttempt } from "@/lib/server/store/ratelimit";
import { getTask } from "@/lib/server/store/tasks";
import { requestSync } from "@/lib/server/sync";
import { env, errorMessage } from "@/lib/source";

// Claude features and one-click fixes. Every call is signed-in, rate-limited
// (AI calls cost money) and audited.

const AI_PER_HOUR = 60;

async function aiBudget(email: string) {
  return (await takeAttempt(`ai:${email}`, 3600)) <= AI_PER_HOUR;
}

export interface AskState {
  question?: string;
  answer?: string;
  error?: string;
}

export async function askAction(_prev: AskState, form: FormData): Promise<AskState> {
  const user = await requireSection("ask");
  const question = String(form.get("question") ?? "").trim().slice(0, 1000);
  if (!question) return { error: "Type a question." };
  if (!aiEnabled()) return { question, error: "Set ANTHROPIC_API_KEY to use Ask." };
  if (!(await aiBudget(user.email))) return { question, error: `You've reached ${AI_PER_HOUR} AI requests this hour. Try again later.` };
  try {
    const answer = await askDashboard(question, buildAskContext(await getDashboard()));
    await audit(user.email, "ai.ask", null, { chars: question.length });
    return { question, answer };
  } catch (err) {
    return { question, error: err instanceof AiRefusal ? err.message : `Claude couldn't answer (${errorMessage(err)}).` };
  }
}

export async function draftReplyAction(emailId: string): Promise<{ draft?: string; error?: string }> {
  const user = await requireSection("inbox");
  if (!aiEnabled()) return { error: "Set ANTHROPIC_API_KEY to draft replies." };
  const email = (await getDashboard()).emails.find((e) => e.id === emailId);
  if (!email) return { error: "That message is no longer in the inbox." };
  if (!(await aiBudget(user.email))) return { error: `You've reached ${AI_PER_HOUR} AI requests this hour.` };
  try {
    const draft = await draftReply(email, env("OWNER_NAME") ?? "Kaj Consulting");
    await audit(user.email, "ai.draft_reply", email.account, null);
    return { draft };
  } catch (err) {
    return { error: err instanceof AiRefusal ? err.message : `Couldn't draft a reply (${errorMessage(err)}).` };
  }
}

/** Runs the fix that matches a stored task. The fix is re-derived here; the client only names the task. */
export async function runFixAction(taskId: string): Promise<{ ok?: string; error?: string }> {
  const user = await requireUser();
  const task = await getTask(taskId);
  const fix = task && task.status === "open" && canSeeTask(user, user.email, task) ? fixForTask(task.sourceKey, task.url ?? null) : null;
  if (!task || !fix) return { error: "There's no one-click fix for this task any more." };
  try {
    const ok = await runFix(fix);
    await audit(user.email, `fix.${fix.kind}`, task.title, { fix });
    await requestSync();
    revalidatePath("/", "layout");
    return { ok };
  } catch (err) {
    await audit(user.email, `fix.${fix.kind}.failed`, task.title, { fix, error: errorMessage(err).slice(0, 300) });
    return { error: errorMessage(err) };
  }
}
