import { googleClient, personalAccounts } from "../server/credentials";
import { hasGoogleScope } from "../server/google";
import { errorMessage, fromSource } from "../source";
import type { CalendarEvent, EmailMessage, SourceResult } from "../types";
import { calendarWindow, fetchGoogleEvents, fetchMicrosoftEvents, sortEvents } from "./calendar";
import { fetchGmailMail } from "./gmail";
import { fetchOutlookMail, outlookMailbox } from "./outlook";

// People's own mailboxes and calendars ("My mail & calendar" in Settings).
// Kept apart from the shared Gmail / Outlook / Calendar sources: every item
// carries its owner, nothing is business-tagged, a failing account never
// becomes a shared "Fix the connection" task, and the scoping step
// (scope.ts) hands each item to its owner alone, whoever else is looking.

export interface PersonalProblem {
  /** Whose mailbox it is; only they see the problem. */
  owner: string;
  provider: "microsoft" | "google";
  account: string;
  /** Mailbox id, as in EmailMessage.mailbox. */
  mailbox: string;
  error: string;
}

export interface PersonalData {
  emails: EmailMessage[];
  calendar: CalendarEvent[];
  problems: PersonalProblem[];
}

const empty = (): PersonalData => ({ emails: [], calendar: [], problems: [] });

/**
 * Mail (last 14 days) and calendar (today + 7 days) for every personal
 * account. Never fails as a whole: an account that can't be read is listed in
 * `problems` and reported through `fail` (keyed by mailbox), so its tasks
 * aren't auto-closed while it's down.
 */
export async function getPersonal(): Promise<SourceResult<PersonalData>> {
  const { microsoft, google } = await personalAccounts();
  const googleOn = googleClient() ? google : [];
  return fromSource<PersonalData>(
    "My mail",
    microsoft.length + googleOn.length > 0,
    async (fail) => {
      const window = calendarWindow();
      const jobs = [
        ...microsoft.map((a) => ({
          owner: a.owner!,
          provider: "microsoft" as const,
          account: a.account,
          mailbox: outlookMailbox(a.account),
          run: async () => {
            const [mail, events] = await Promise.all([fetchOutlookMail(a), fetchMicrosoftEvents(a, window)]);
            return { mail, events };
          },
        })),
        ...googleOn.map((a) => ({
          owner: a.owner!,
          provider: "google" as const,
          account: a.id,
          mailbox: a.id,
          run: async () => {
            const [mail, events] = await Promise.all([
              hasGoogleScope(a.scopes, "gmail") !== false ? fetchGmailMail(a) : Promise.resolve([]),
              hasGoogleScope(a.scopes, "calendar") !== false ? fetchGoogleEvents(a, window) : Promise.resolve([]),
            ]);
            return { mail, events };
          },
        })),
      ];
      const settled = await Promise.allSettled(jobs.map((j) => j.run()));
      const out = empty();
      settled.forEach((r, i) => {
        const j = jobs[i];
        if (r.status === "fulfilled") {
          // Belt and braces: whatever a fetcher returned, these items are the owner's.
          out.emails.push(...r.value.mail.map((e) => ({ ...e, owner: j.owner, business: undefined })));
          out.calendar.push(...r.value.events.map((e) => ({ ...e, owner: j.owner })));
        } else {
          const error = errorMessage(r.reason);
          out.problems.push({ owner: j.owner, provider: j.provider, account: j.account, mailbox: j.mailbox, error });
          fail(j.mailbox, `personal mailbox: ${error}`);
        }
      });
      out.emails.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
      sortEvents(out.calendar);
      return out;
    },
    empty,
  );
}
