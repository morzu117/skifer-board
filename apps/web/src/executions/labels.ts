import type { BadgeTone } from "../ui/Badge";
import type { ExecutionError, ExecutionState } from "./model";

/** Libellés des états et des raisons d'une exécution, partagés par le centre d'exécutions, l'Explorateur et la fiche d'analyse. */
export const STATE_LABELS: Record<ExecutionState, string> = {
  queued: "En attente", running: "En cours", succeeded: "Réussie", denied: "Refusée",
  failed: "Échouée", timed_out: "Délai dépassé", cancelled: "Annulée",
};
export const STATE_TONES: Record<ExecutionState, BadgeTone> = {
  queued: "neutral", running: "warning", succeeded: "success", denied: "danger",
  failed: "danger", timed_out: "danger", cancelled: "neutral",
};
export const ERROR_LABELS: Record<ExecutionError, string> = {
  deny: "Accès refusé", require_human: "Validation humaine requise", cancelled: "Exécution annulée",
  execution_timed_out: "Délai d'exécution dépassé", execution_failed: "Échec de l'exécution",
  execution_lost: "Suivi de l'exécution perdu", invalid_upstream: "Réponse de la source invalide",
  connector_unavailable: "Connecteur ou source indisponible", engine_unavailable: "Moteur sémantique indisponible",
  evidence_invalid: "Preuve invalide", worker_unavailable: "Service d'exécution indisponible",
  server_restarted: "Serveur redémarré", credential_rejected: "Identifiant de connexion refusé ou expiré",
  redirect_refused: "Redirection de la source refusée", endpoint_not_configured: "Point d'accès non configuré",
  identity_unavailable: "Identité de connexion indisponible", vault_unavailable: "Coffre indisponible",
  credential_not_found: "Identifiant de connexion introuvable",
};
