"use client";

import { useTransition } from "react";
import { disconnectMine, disconnectPersonal } from "@/app/actions/connections";

const cls = "hud-btn min-h-10 shrink-0 px-2.5 py-1 text-[10.5px] text-muted [--b:#7f97ab] hover:text-critical sm:min-h-0";

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
