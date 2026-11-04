import { formatInstant } from "../format/date";
import { Banner } from "../ui/Banner";
import { Reading, refusalText } from "./AdminParts";
import type { AdminOutcome } from "./admin";
import type { Probe } from "./connections";

export function ProbeOutcome({ outcome }: { outcome: AdminOutcome<Probe> | { status: "testing" } }) {
  if (outcome.status === "testing") return <Reading>Essai de la connexion en cours…</Reading>;
  if (outcome.status === "refused") return <Banner tone="danger">Essai refusé : {refusalText(outcome)}</Banner>;
  if (outcome.status === "error") return <Banner tone="danger">Essai indisponible : {outcome.message}</Banner>;
  return <Banner tone="neutral">Essai réussi pour l'identité {outcome.value.identity} · état {outcome.value.state} · expiration {outcome.value.credentialExpiresAt === null ? "inconnue" : formatInstant(outcome.value.credentialExpiresAt)} · annulation {outcome.value.canCancel ? "disponible" : "indisponible"}.</Banner>;
}
