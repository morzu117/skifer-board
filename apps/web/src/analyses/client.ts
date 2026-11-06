import { ContractError } from "../catalogue/decode";
import { call, type AdminOutcome, type Call } from "../spaces/admin";
import { spaceUrl, type Fetch } from "../spaces/api";
import { decodeAnalysisDraft, decodeName, type AnalysisDraft } from "./document";
import { decodeAnalysisList, decodeDiff, decodeHistory, decodeLastExecution, decodeOpened, decodeRevision, decodeUsage, type AnalysisList, type AnalysisRevision, type Diff, type History, type LastExecution, type Usage } from "./model";
import { readExact } from "./lossless";
import { newEventId } from "./reference";
import { ANALYSIS_REFUSALS } from "./refusal";
import { fail, isRevision, isUuid, uuid } from "./shape";

/**
 * Clients des routes d'analyses (plan 18, 18.4), sur le modèle des clients d'exécution : refus
 * fermés, réponses décodées sans rien compléter, arguments vérifiés avant tout appel. Le serveur
 * reste l'autorité (droits, catalogue, révision attendue) ; Board n'émet ni ne stocke de SQL.
 */
const base = (space: string) => `${spaceUrl(space)}/analyses`;
const named = (space: string, id: string) => `${base(space)}/${encodeURIComponent(id)}`;
const rejected = <T>(message: string): Promise<AdminOutcome<T>> => Promise.resolve({ status: "error", message });

/** Un refus hors de l'union fermée des analyses n'est pas un refus lisible : c'est une réponse hors contrat. */
function run<T>(request: Call<T>, signal: AbortSignal | undefined, fetcher: Fetch): Promise<AdminOutcome<T>> {
  return call({ ...request, read: readExact }, signal, fetcher).then((outcome) => (outcome.status === "refused" && !(ANALYSIS_REFUSALS as readonly string[]).includes(outcome.code)
    ? { status: "error", message: "Réponse du serveur hors contrat : refus inattendu." }
    : outcome));
}

function problem(id: string, ...numbers: readonly number[]): string | null {
  if (!isUuid(id)) return "L'identifiant d'analyse est invalide.";
  return numbers.every(isRevision) ? null : "Le numéro de révision est invalide.";
}

function only(status: number, allowed: readonly number[]): void {
  if (!allowed.includes(status)) fail("statut", `HTTP ${allowed.join(" ou ")}`);
}

export function createAnalysis(space: string, draft: AnalysisDraft, fetcher: Fetch = fetch): Promise<AdminOutcome<AnalysisRevision>> {
  let body: AnalysisDraft;
  try {
    body = decodeAnalysisDraft(draft);
  } catch {
    return rejected("L'analyse à enregistrer est invalide.");
  }
  return run({ url: base(space), method: "POST", body, decode: (value, status) => {
    only(status, [201]);
    const found = decodeRevision(value, space);
    if (found.revision !== 1 || found.currentRevision !== 1) throw new ContractError("révision : première révision attendue");
    return found;
  } }, undefined, fetcher);
}

export function fetchAnalyses(space: string, signal: AbortSignal, fetcher: Fetch = fetch): Promise<AdminOutcome<AnalysisList>> {
  return run({ url: base(space), decode: (value, status) => { only(status, [200]); return decodeAnalysisList(value); } }, signal, fetcher);
}

/** Révision courante : la révision lue est la courante. */
export function fetchAnalysis(space: string, id: string, signal: AbortSignal, fetcher: Fetch = fetch): Promise<AdminOutcome<AnalysisRevision>> {
  const bad = problem(id);
  if (bad !== null) return rejected(bad);
  return run({ url: named(space, id), decode: (value, status) => {
    only(status, [200]);
    const found = decodeRevision(value, space);
    if (found.id !== id || found.revision !== found.currentRevision) throw new ContractError("révision : révision courante de l'analyse demandée attendue");
    return found;
  } }, signal, fetcher);
}

/** Révision numérotée, courante ou passée, éventuellement d'une analyse supprimée. */
export function fetchAnalysisRevision(space: string, id: string, revision: number, signal: AbortSignal, fetcher: Fetch = fetch): Promise<AdminOutcome<AnalysisRevision>> {
  const bad = problem(id, revision);
  if (bad !== null) return rejected(bad);
  return run({ url: `${named(space, id)}/revisions/${String(revision)}`, decode: (value, status) => {
    only(status, [200]);
    const found = decodeRevision(value, space);
    if (found.id !== id || found.revision !== revision) throw new ContractError("révision : révision demandée attendue");
    return found;
  } }, signal, fetcher);
}

/** Historique, suppression comprise ; une révision masquée n'a que son numéro. */
export function fetchHistory(space: string, id: string, signal: AbortSignal, fetcher: Fetch = fetch): Promise<AdminOutcome<History>> {
  const bad = problem(id);
  if (bad !== null) return rejected(bad);
  return run({ url: `${named(space, id)}/revisions`, decode: (value, status) => { only(status, [200]); return decodeHistory(value, id); } }, signal, fetcher);
}

export function fetchDiff(space: string, id: string, base: number, other: number, signal: AbortSignal, fetcher: Fetch = fetch): Promise<AdminOutcome<Diff>> {
  const bad = problem(id, base, other);
  if (bad !== null) return rejected(bad);
  return run({ url: `${named(space, id)}/diff?${new URLSearchParams({ base: String(base), other: String(other) }).toString()}`, decode: (value, status) => {
    only(status, [200]);
    return decodeDiff(value, id, base, other);
  } }, signal, fetcher);
}

/** Une révision enregistrée, ou la courante rendue telle quelle (200) quand le contenu est identique. */
export interface Revised {
  revision: AnalysisRevision;
  unchanged: boolean;
}

/** Crée la révision qui suit `expectedRevision` ; une autre révision entre-temps répond `revision_conflict`. */
export function reviseAnalysis(space: string, id: string, draft: AnalysisDraft, expectedRevision: number, fetcher: Fetch = fetch): Promise<AdminOutcome<Revised>> {
  const bad = problem(id, expectedRevision);
  if (bad !== null) return rejected(bad);
  let body: AnalysisDraft;
  try {
    body = decodeAnalysisDraft(draft);
  } catch {
    return rejected("L'analyse à enregistrer est invalide.");
  }
  return run({ url: `${named(space, id)}/revisions`, method: "POST", body: { ...body, expected_revision: expectedRevision }, decode: (value, status) => {
    only(status, [200, 201]);
    const found = decodeRevision(value, space);
    const unchanged = status === 200;
    if (found.id !== id || found.revision !== (unchanged ? expectedRevision : expectedRevision + 1) || found.currentRevision !== found.revision) {
      throw new ContractError("révision : révision attendue");
    }
    return { revision: found, unchanged };
  } }, undefined, fetcher);
}

/** Copie personnelle de l'appelant, nommée « Copie de … » par le serveur sauf nom donné. */
export function duplicateAnalysis(space: string, id: string, name?: string, fetcher: Fetch = fetch): Promise<AdminOutcome<AnalysisRevision>> {
  const bad = problem(id);
  if (bad !== null) return rejected(bad);
  const request: Pick<Call<AnalysisRevision>, "body"> = {};
  if (name !== undefined) {
    try {
      request.body = { name: decodeName(name, "nom") };
    } catch {
      return rejected("Le nom de la copie est invalide.");
    }
  }
  return run({ url: `${named(space, id)}/duplicate`, method: "POST", ...request, decode: (value, status) => {
    only(status, [201]);
    const found = decodeRevision(value, space);
    if (found.id === id || found.revision !== 1 || found.currentRevision !== 1 || found.analysis.visibility !== "personal" || !found.permissions.owner) {
      throw new ContractError("révision : copie personnelle de l'appelant attendue");
    }
    return found;
  } }, undefined, fetcher);
}

/** Supprime la révision courante `expectedRevision` ; l'historique reste dans le dépôt. */
export function deleteAnalysis(space: string, id: string, expectedRevision: number, fetcher: Fetch = fetch): Promise<AdminOutcome<null>> {
  const bad = problem(id, expectedRevision);
  if (bad !== null) return rejected(bad);
  return run({ url: `${named(space, id)}?${new URLSearchParams({ expected_revision: String(expectedRevision) }).toString()}`, method: "DELETE", decode: (value, status) => {
    only(status, [204]);
    return null;
  } }, undefined, fetcher);
}

/**
 * Consigne l'ouverture d'une révision. `eventId` est tiré par le client : rejouer le même
 * identifiant ne compte qu'une fois. `recorded: false` : la base n'a pas pu consigner, rejouer.
 */
export function openAnalysis(space: string, id: string, revision: number, eventId: string = newEventId(), fetcher: Fetch = fetch): Promise<AdminOutcome<{ recorded: boolean }>> {
  const bad = problem(id, revision);
  if (bad !== null) return rejected(bad);
  try {
    uuid(eventId, "event_id");
  } catch {
    return rejected("L'identifiant d'événement est invalide.");
  }
  return run({ url: `${named(space, id)}/opened`, method: "POST", body: { event_id: eventId, revision }, decode: (value, status) => {
    only(status, [202]);
    return decodeOpened(value);
  } }, undefined, fetcher);
}

export function fetchUsage(space: string, id: string, signal: AbortSignal, fetcher: Fetch = fetch): Promise<AdminOutcome<Usage>> {
  const bad = problem(id);
  if (bad !== null) return rejected(bad);
  return run({ url: `${named(space, id)}/usage`, decode: (value, status) => { only(status, [200]); return decodeUsage(value, id); } }, signal, fetcher);
}

/**
 * Dernière exécution de la session qui référençait l'analyse, toutes révisions confondues. Le serveur ne rend
 * jamais celle d'une autre personne ; sans exécution, `last` vaut `null`.
 */
export function fetchLastExecution(space: string, id: string, signal: AbortSignal, fetcher: Fetch = fetch): Promise<AdminOutcome<LastExecution>> {
  const bad = problem(id);
  if (bad !== null) return rejected(bad);
  return run({ url: `${named(space, id)}/last-execution`, decode: (value, status) => { only(status, [200]); return decodeLastExecution(value, space, id); } }, signal, fetcher);
}
