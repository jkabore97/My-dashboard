"use client";

import { ArrowUp, Sparkles } from "lucide-react";
import { askAction, type AskState } from "@/app/actions/assistant";
import { useFormState } from "../useFormState";
import { SimpleMarkdown } from "./SimpleMarkdown";

const EXAMPLES = ["Which client hasn't paid?", "What broke this week?", "What should I do first today?", "How much did the solar produce this week?"];

export function AskForm({ enabled }: { enabled: boolean }) {
  const [state, onSubmit, pending] = useFormState<AskState>(askAction, {});
  return (
    <div>
      <form onSubmit={onSubmit} className="relative flex items-center">
        <input
          name="question"
          defaultValue={state.question ?? ""}
          disabled={!enabled}
          maxLength={1000}
          placeholder={enabled ? "Ask anything about your businesses…" : "Set ANTHROPIC_API_KEY to enable"}
          className="hud-input min-h-12 min-w-0 flex-1 rounded-full py-2.5 pl-4 pr-28 text-[17px] placeholder:text-muted disabled:opacity-60 sm:pr-32"
          autoFocus
        />
        <button disabled={!enabled || pending} className="hud-btn hud-btn-solid absolute right-1.5 min-h-9 rounded-full px-4">
          {pending ? <Sparkles size={15} className="animate-pulse" /> : <ArrowUp size={16} strokeWidth={2.5} />}
          {pending ? "Thinking…" : "Ask"}
        </button>
      </form>
      {!state.answer && !state.error && (
        <div className="mt-4">
          <div className="mb-2 px-1 text-[13px] text-muted">Try asking</div>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((q) => (
              <button
                key={q}
                type="button"
                disabled={!enabled || pending}
                onClick={(e) => {
                  const input = e.currentTarget.closest("div")!.parentElement!.parentElement!.querySelector<HTMLInputElement>("input[name=question]")!;
                  input.value = q;
                  input.form?.requestSubmit();
                }}
                className="min-h-10 rounded-full bg-fill px-3.5 text-left text-[14px] text-ink transition hover:bg-fill-2 active:opacity-70 disabled:opacity-50 sm:min-h-9"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}
      {state.error && <p className="mt-4 rounded-[14px] bg-critical/10 px-4 py-3 text-[15px] text-ink"><b className="font-semibold text-critical">Couldn&apos;t answer.</b> {state.error}</p>}
      {state.answer && (
        <div className="mt-5 rounded-[14px] bg-panel-2 p-4 sm:p-5" aria-live="polite">
          <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px]">
            <span className="inline-flex items-center gap-1.5 font-semibold text-violet"><Sparkles size={14} aria-hidden />Claude</span>
            {state.question ? <span className="min-w-0 text-muted">“{state.question}”</span> : null}
          </div>
          <SimpleMarkdown text={state.answer} />
        </div>
      )}
    </div>
  );
}
