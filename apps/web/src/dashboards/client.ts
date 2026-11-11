import { rejected, only, run as call, spaceProblem } from "../analyses/client";
import { decodeName } from "../analyses/document";
import { isRevision, isUuid } from "../analyses/shape";
import { ContractError } from "../catalogue/decode";
import type { AdminOutcome, Call } from "../spaces/admin";
import { spaceUrl, type Fetch } from "../spaces/api";
import { decodeDashboardDraft, type DashboardDraft } from "./document";
import { decodeDashboardDiff, decodeDashboardHistory, decodeDashboardList, decodeDashboardRevision, type DashboardDiff, type DashboardHistory, type DashboardList, type DashboardRevision } from "./model";
import { DASHBOARD_REFUSALS } from "./refusal";

/**
 * Clients des routes de dashboards (plan 19, 19.3), sur le modèle de ceux des analyses (plan 18, 18.4) : refus fermés,
 * réponses décodées sans rien compléter, arguments vérifiés avant tout appel, statut de succès contrôlé route par route.
 * Le serveur reste l'autorité (droits, analyses épinglées, catalogue, révision attendue) ; Board n'émet ni ne stocke de
 * SQL, et un dashboard ne porte aucune requête.
 */
const base = (space: string) => `${spaceUrl(space)}/dashboards`;
const named = (space: string, id: string) => `${base(space)}/${encodeURIComponent(id)}`;

/** Un refus hors de l'union fermée des dashboards n'est pas un refus lisible : c'est une réponse hors contrat. */
const run = <T>(request: Call<T>, signal: AbortSignal | undefined, fetcher: Fetch): Promise<AdminOutcome<T>> => call(request, signal, fetcher, DASHBOARD_REFUSALS);

function problem(space: string, id: string, ...numbers: readonly number[]): string | null {
  const bad = spaceProblem(space);
  if (bad !== null) return bad;
  if (!isUuid(id)) return "L'identifiant de dashboard est invalide.";
  return numbers.every(isRevision) ? null : "Le numéro de révision est invalide.";
}

/** Corps d'une création ou d'une révision, ou la raison de son refus avant tout appel. */
function body(draft: DashboardDraft): DashboardDraft | null {
  try {
    return decodeDashboardDraft(draft);
  } catch {
    return null;
  }
}

const INVALID = "Le dashboard à enregistrer est invalide.";

/** Une première révision, créée pour son auteur : il en est le propriétaire. */
function first(found: DashboardRevision): DashboardRevision {
  if (found.revision !== 1 || found.currentRevision !== 1 || !found.permissions.owner || found.dashboard.owner.issuer !== found.revisedBy.issuer || found.dashboard.owner.subject !== found.revisedBy.subject) {
    throw new ContractError("révision : première révision de l'appelant attendue");
  }
  return found;
}

export function createDashboard(space: string, draft: DashboardDraft, fetcher: Fetch = fetch): Promise<AdminOutcome<DashboardRevision>> {
  const unknown = spaceProblem(space);
  if (unknown !== null) return rejected(unknown);
  const sent = body(draft);
  if (sent === null) return rejected(INVALID);
  return run({ url: base(space), method: "POST", body: sent, decode: (value, status) => {
    only(status, [201]);
    return first(decodeDashboardRevision(value, space));
  } }, undefined, fetcher);
}

export function fetchDashboards(space: string, signal: AbortSignal, fetcher: Fetch = fetch): Promise<AdminOutcome<DashboardList>> {
  const bad = spaceProblem(space);
  if (bad !== null) return rejected(bad);
  return run({ url: base(space), decode: (value, status) => { only(status, [200]); return decodeDashboardList(value); } }, signal, fetcher);
}

/** Révision courante : la révision lue est la courante. */
export function fetchDashboard(space: string, id: string, signal: AbortSignal, fetcher: Fetch = fetch): Promise<AdminOutcome<DashboardRevision>> {
  const bad = problem(space, id);
  if (bad !== null) return rejected(bad);
  return run({ url: named(space, id), decode: (value, status) => {
    only(status, [200]);
    const found = decodeDashboardRevision(value, space);
    if (found.id !== id || found.revision !== found.currentRevision) throw new ContractError("révision : révision courante du dashboard demandé attendue");
    return found;
  } }, signal, fetcher);
}

/** Révision numérotée, courante ou passée, éventuellement d'un dashboard supprimé. */
export function fetchDashboardRevision(space: string, id: string, revision: number, signal: AbortSignal, fetcher: Fetch = fetch): Promise<AdminOutcome<DashboardRevision>> {
  const bad = problem(space, id, revision);
  if (bad !== null) return rejected(bad);
  return run({ url: `${named(space, id)}/revisions/${String(revision)}`, decode: (value, status) => {
    only(status, [200]);
    const found = decodeDashboardRevision(value, space);
    if (found.id !== id || found.revision !== revision) throw new ContractError("révision : révision demandée attendue");
    return found;
  } }, signal, fetcher);
}

/** Historique, suppression comprise ; une révision masquée n'a que son numéro. */
export function fetchDashboardHistory(space: string, id: string, signal: AbortSignal, fetcher: Fetch = fetch): Promise<AdminOutcome<DashboardHistory>> {
  const bad = problem(space, id);
  if (bad !== null) return rejected(bad);
  return run({ url: `${named(space, id)}/revisions`, decode: (value, status) => { only(status, [200]); return decodeDashboardHistory(value, id); } }, signal, fetcher);
}

/** Écart structurel entre deux révisions, nœud par nœud (ajouté, retiré, modifié, déplacé). */
export function fetchDashboardDiff(space: string, id: string, base: number, other: number, signal: AbortSignal, fetcher: Fetch = fetch): Promise<AdminOutcome<DashboardDiff>> {
  const bad = problem(space, id, base, other);
  if (bad !== null) return rejected(bad);
  return run({ url: `${named(space, id)}/diff?${new URLSearchParams({ base: String(base), other: String(other) }).toString()}`, decode: (value, status) => {
    only(status, [200]);
    return decodeDashboardDiff(value, id, base, other);
  } }, signal, fetcher);
}

/** Une révision enregistrée, ou la courante rendue telle quelle (200) quand le contenu est identique. */
export interface RevisedDashboard {
  revision: DashboardRevision;
  unchanged: boolean;
}

/** Crée la révision qui suit `expectedRevision` ; une autre révision entre-temps répond `revision_conflict`. */
export function reviseDashboard(space: string, id: string, draft: DashboardDraft, expectedRevision: number, fetcher: Fetch = fetch): Promise<AdminOutcome<RevisedDashboard>> {
  const bad = problem(space, id, expectedRevision);
  if (bad !== null) return rejected(bad);
  const sent = body(draft);
  if (sent === null) return rejected(INVALID);
  return run({ url: `${named(space, id)}/revisions`, method: "POST", body: { ...sent, expected_revision: expectedRevision }, decode: (value, status) => {
    only(status, [200, 201]);
    const found = decodeDashboardRevision(value, space);
    const unchanged = status === 200;
    if (found.id !== id || found.revision !== (unchanged ? expectedRevision : expectedRevision + 1) || found.currentRevision !== found.revision) {
      throw new ContractError("révision : révision attendue");
    }
    return { revision: found, unchanged };
  } }, undefined, fetcher);
}

/** Copie personnelle de l'appelant, nommée « Copie de … » par le serveur sauf nom donné. */
export function duplicateDashboard(space: string, id: string, name?: string, fetcher: Fetch = fetch): Promise<AdminOutcome<DashboardRevision>> {
  const bad = problem(space, id);
  if (bad !== null) return rejected(bad);
  const request: Pick<Call<DashboardRevision>, "body"> = {};
  if (name !== undefined) {
    try {
      request.body = { name: decodeName(name, "nom") };
    } catch {
      return rejected("Le nom de la copie est invalide.");
    }
  }
  return run({ url: `${named(space, id)}/duplicate`, method: "POST", ...request, decode: (value, status) => {
    only(status, [201]);
    const found = first(decodeDashboardRevision(value, space));
    if (found.id === id || found.dashboard.visibility !== "personal") throw new ContractError("révision : copie personnelle d'un autre dashboard attendue");
    return found;
  } }, undefined, fetcher);
}

/** Supprime la révision courante `expectedRevision` ; l'historique reste dans le dépôt. */
export function deleteDashboard(space: string, id: string, expectedRevision: number, fetcher: Fetch = fetch): Promise<AdminOutcome<null>> {
  const bad = problem(space, id, expectedRevision);
  if (bad !== null) return rejected(bad);
  return run({ url: `${named(space, id)}?${new URLSearchParams({ expected_revision: String(expectedRevision) }).toString()}`, method: "DELETE", decode: (value, status) => {
    only(status, [204]);
    return null;
  } }, undefined, fetcher);
}
