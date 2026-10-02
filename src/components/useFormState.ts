"use client";

import { useActionState, useTransition, type FormEvent } from "react";

/**
 * Like useActionState, but submits through onSubmit instead of <form action>.
 * React resets a form after a form action runs, even when the server rejected
 * the input, which wipes what the person typed. Submitting this way keeps the
 * fields; forms that should clear on success reset themselves explicitly.
 */
export function useFormState<S>(action: (prev: S, form: FormData) => Promise<S>, initial: S) {
  const [state, dispatch, pending] = useActionState<S, FormData>(action as (prev: Awaited<S>, form: FormData) => Promise<S>, initial as Awaited<S>);
  const [, start] = useTransition();
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const data = new FormData(e.currentTarget, submitter);
    start(() => dispatch(data));
  };
  return [state, onSubmit, pending] as const;
}
