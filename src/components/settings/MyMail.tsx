"use client";

import { useTransition } from "react";
import { disconnectMine, disconnectPersonal } from "@/app/actions/connections";

const cls = "hud-btn hud-btn-danger min-h-9 shrink-0 px-3 py-1 text-[13px] sm:min-h-8";

/** Disconnects the signed-in person's own mailbox and calendar. */
export function DisconnectMineButton({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition();
  return (
    <button disabled={pending} onClick={() => confirm(`Disconnect ${name}? Its mail and calendar leave the dashboard, and its stored sign-in is deleted.`) && start(() => disconnectMine(id))} className={cls}>
      {pending ? "Removing…" : "Disconnect"}
    </button>
  );
}

/** Owner: removes someone's personal mailbox without ever seeing what's in it. */
export function DisconnectPersonalButton({ id, who }: { id: string; who: string }) {
  const [pending, start] = useTransition();
  return (
    <button disabled={pending} onClick={() => confirm(`Disconnect ${who}'s personal mailbox? They can connect it again from their Settings.`) && start(() => disconnectPersonal(id))} className={cls}>
      {pending ? "Removing…" : "Disconnect"}
    </button>
  );
}
