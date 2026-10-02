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
          className="hud-input min-h-11 min-w-0 flex-1 basis-64 px-3.5 py-2.5 text-[15px] placeholder:text-muted/70 disabled:opacity-60"
          autoFocus
        />
        <button disabled={!enabled || pending} className="hud-btn hud-btn-solid min-h-11 px-5">
          <Sparkles size={14} />
          {pending ? "Thinking…" : "Ask"}
        </button>
      </form>
      {!state.answer && !state.error && (
        <div className="mt-4 flex flex-wrap gap-2">
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
              className="hud-cut min-h-10 border border-line bg-cyan/[0.04] px-3 text-left text-[13px] text-[#b7c7d4] transition hover:border-cyan/50 hover:text-ink disabled:opacity-50 sm:min-h-9"
            >
              {q}
            </button>
          ))}
        </div>
      )}
      {state.error && <p className="mt-4 text-sm text-critical">{state.error}</p>}
      {state.answer && (
        <div className="hud-cut mt-5 border border-violet/40 bg-[#040a10]/60 p-4 sm:p-5" aria-live="polite">
          <div className="hud-label mb-2 text-[11px] text-violet">✦ Claude · answer{state.question ? <span className="ml-2 font-sans normal-case tracking-normal text-muted">“{state.question}”</span> : null}</div>
          <SimpleMarkdown text={state.answer} />
        </div>
      )}
    </div>
  );
}
