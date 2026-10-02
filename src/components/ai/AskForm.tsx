"use client";

import { Sparkles } from "lucide-react";
import { askAction, type AskState } from "@/app/actions/assistant";
import { useFormState } from "../useFormState";
import { SimpleMarkdown } from "./SimpleMarkdown";

const EXAMPLES = ["Which client hasn't paid?", "What broke this week?", "What should I do first today?", "How much did the solar produce this week?"];

export function AskForm({ enabled }: { enabled: boolean }) {
  const [state, onSubmit, pending] = useFormState<AskState>(askAction, {});
  return (
    <div>
      <form onSubmit={onSubmit} className="flex flex-wrap gap-2">
        <input
          name="question"
          defaultValue={state.question ?? ""}
          disabled={!enabled}
          maxLength={1000}
          placeholder={enabled ? "Ask anything about your businesses…" : "Set ANTHROPIC_API_KEY to enable"}
          className="min-w-0 flex-1 basis-64 rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
          autoFocus
        />
        <button disabled={!enabled || pending} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          <Sparkles size={14} />
          {pending ? "Thinking…" : "Ask"}
        </button>
      </form>
      {!state.answer && !state.error && (
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((q) => (
            <button
              key={q}
              type="button"
              disabled={!enabled || pending}
              onClick={(e) => {
                const input = e.currentTarget.closest("div")!.parentElement!.querySelector<HTMLInputElement>("input[name=question]")!;
                input.value = q;
                input.form?.requestSubmit();
              }}
              className="rounded-full border border-line px-3 py-1 text-xs text-muted hover:border-accent/50 hover:text-ink disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
      )}
      {state.error && <p className="mt-4 text-sm text-critical">{state.error}</p>}
      {state.answer && (
        <div className="mt-4 rounded-lg border border-line bg-bg p-4" aria-live="polite">
          <SimpleMarkdown text={state.answer} />
        </div>
      )}
    </div>
  );
}
