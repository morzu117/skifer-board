import type { ReactNode } from "react";
import { refusalText, ReadFailure } from "../spaces/AdminParts";
import type { AdminOutcome, Refusal } from "../spaces/admin";
import { Banner } from "../ui/Banner";

export type Failed = Exclude<AdminOutcome<unknown>, { status: "ok" }>;

/** Refus tel que le serveur le dit, avec ce que son code porte : les consommateurs qui bloquent, la révision attendue. */
export function analysisRefusalText(refusal: Refusal): string {
  const base = refusalText(refusal);
  if (refusal.code === "analysis_in_use" && refusal.consumers !== undefined) {
    return `${base} Consommateurs : ${refusal.consumers.map((consumer) => `dashboard ${consumer.id}`).join(", ")}.`;
  }
  return base;
}

/** Échec d'une lecture : le mode local se dit neutre, tout autre refus ou erreur s'affiche tel quel, sans rien d'autre. */
export function Unavailable({ outcome, title, local }: { outcome: Failed; title: string; local: ReactNode }) {
  if (outcome.status === "refused" && outcome.code === "local_mode") return <Banner tone="neutral">{local}</Banner>;
  return <ReadFailure outcome={outcome} title={title} />;
}
