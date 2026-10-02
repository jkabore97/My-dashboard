import type { DealStage } from "./server/store/pipeline";

// Shared by server pages and client components (a "use client" module can't
// hand plain values to server components).
export const STAGE_LABEL: Record<DealStage, string> = { lead: "Lead", proposal: "Proposal sent", negotiation: "Negotiation", won: "Won", lost: "Lost" };
