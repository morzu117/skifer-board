import { readExact } from "../analyses/lossless";
import { ContractError } from "../catalogue/decode";
import { reportSessionLost } from "../identity/session";
import type { Fetch } from "../spaces/api";
import { reportSpaceLost } from "../spaces/lost";

/** Les refus et les succès sont décodés intégralement ; une annulation reste une annulation. */
export function requestFor<R extends { code: string }>(decodeRefusal: (value: unknown) => R) {
return async function request<T>(url: string, signal: AbortSignal | undefined, fetcher: Fetch, decode: (value: unknown, response: Response) => T, method: "GET" | "POST" | "PUT" | "DELETE" = "GET", body?: unknown): Promise<{ status: "ok"; value: T } | ({ status: "refused" } & R) | { status: "error"; message: string }> {
  let response: Response;
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    const options: RequestInit = { method, headers };
    if (signal !== undefined) options.signal = signal;
    if (body !== undefined) { headers["Content-Type"] = "application/json"; options.body = JSON.stringify(body); }
    response = await fetcher(url, options);
  } catch (error) {
    if (signal?.aborted === true) throw error;
    return { status: "error", message: "Le serveur Board ne répond pas." };
  }
  if (response.status === 401) {
    reportSessionLost();
    return { status: "error", message: "Session expirée : reconnectez-vous." };
  }
  try {
    if (response.ok) {
      return { status: "ok", value: decode(response.status === 204 ? null : await readExact(response), response) };
    }
    const refusal = decodeRefusal(await response.json());
    if (refusal.code === "space_not_found") reportSpaceLost();
    return { status: "refused", ...refusal };
  } catch (error) {
    if (signal?.aborted === true) throw error;
    return { status: "error", message: `Réponse du serveur hors contrat : ${error instanceof ContractError ? error.message : "corps illisible"}.` };
  }
};
}

import { spaceProblem } from "../analyses/client";
import { isRevision, isUuid, record } from "../analyses/shape";
import { spaceUrl } from "../spaces/api";
import type { Person } from "../analyses/document";

type Revision = { id: string; revision: number; commit: string; state: string; revisedBy: Person };
/** Une seule implémentation des routes de contenus partagés ; les formats restent propres à chaque genre. */
export function sharedClient<Draft, R extends Revision, L, H, A, C, Diff, Approval, Ref extends { code: string }>(config: {
  segment: string; label: string; apiVersion: string;
  document: (value: unknown) => { owner: Person };
  revision: (value: unknown, space: string) => R;
  owner: (revision: R) => Person;
  list: (value: unknown) => L; history: (value: unknown, id: string) => H;
  approvals: (value: unknown, id: string) => A; consumers: (value: unknown, id: string) => C;
  diff: (value: unknown, id: string, from: number, to: number) => Diff;
  approval: (value: unknown, id: string) => Approval;
  refusal: (value: unknown) => Ref;
}) {
  const request = requestFor(config.refusal);
  const base = (space: string) => `${spaceUrl(space)}/${config.segment}`;
  const named = (space: string, id: string) => `${base(space)}/${encodeURIComponent(id)}`;
  const rejected = (message: string) => Promise.resolve({ status: "error" as const, message });
  const problem = (space: string, id: string, number?: number) => spaceProblem(space) ?? (!isUuid(id) ? `L'identifiant du ${config.label} est invalide.` : number !== undefined && !isRevision(number) ? "Le numéro de révision est invalide." : null);
  const only = (response: Response, allowed: readonly number[]): void => { if (!allowed.includes(response.status)) throw new ContractError(`statut : HTTP ${allowed.join(" ou ")} attendu`); };
  function checkedDraft(value: Draft): Draft | null {
    try {
      const fields = record(value, config.label);
      if (["api_version", "id", "owner"].some((key) => Object.hasOwn(fields, key))) return null;
      const document = config.document({ ...fields, api_version: config.apiVersion, id: "00000000-0000-4000-8000-000000000001", owner: { issuer: "client", subject: "client" } });
      return Object.fromEntries(Object.entries(document).filter(([key]) => !["api_version", "id", "owner"].includes(key))) as Draft;
    } catch { return null; }
  }
  function written(value: unknown, response: Response, space: string): R & { etag: string } {
    const saved = config.revision(value, space); const etag = response.headers.get("etag");
    if (etag !== `"${saved.commit}"`) throw new ContractError("ETag : commit de la révision attendu");
    return { ...saved, etag };
  }
  function list(space: string, signal: AbortSignal, fetcher: Fetch = fetch) {
    const bad = spaceProblem(space);
    return bad === null ? request(base(space), signal, fetcher, (value, response) => { only(response, [200]); return config.list(value); }) : rejected(bad);
  }
  function read(space: string, id: string, signal: AbortSignal, fetcher: Fetch = fetch, number?: number) {
    const bad = problem(space, id, number); if (bad !== null) return rejected(bad);
    const query = number === undefined ? "" : `?${new URLSearchParams({ revision: String(number) }).toString()}`;
    return request(`${named(space, id)}${query}`, signal, fetcher, (value, response) => {
      only(response, [200]); const saved = written(value, response, space);
      if (saved.id !== id || (number !== undefined && saved.revision !== number)) throw new ContractError("révision : document demandé attendu");
      return saved;
    });
  }
  const readRevision = (space: string, id: string, number: number, signal: AbortSignal, fetcher: Fetch = fetch) => read(space, id, signal, fetcher, number);
  function subresource<T>(space: string, id: string, signal: AbortSignal, fetcher: Fetch, segment: string, decode: (value: unknown, id: string) => T) {
    const bad = problem(space, id);
    return bad === null ? request(`${named(space, id)}/${segment}`, signal, fetcher, (value, response) => { only(response, [200]); return decode(value, id); }) : rejected(bad);
  }
  const history = (space: string, id: string, signal: AbortSignal, fetcher: Fetch = fetch) => subresource(space, id, signal, fetcher, "history", config.history);
  const approvals = (space: string, id: string, signal: AbortSignal, fetcher: Fetch = fetch) => subresource(space, id, signal, fetcher, "approvals", config.approvals);
  const consumers = (space: string, id: string, signal: AbortSignal, fetcher: Fetch = fetch) => subresource(space, id, signal, fetcher, "consumers", config.consumers);
  function create(space: string, draft: Draft, fetcher: Fetch = fetch) {
    const bad = spaceProblem(space); if (bad !== null) return rejected(bad);
    const sent = checkedDraft(draft); if (sent === null) return rejected(`Le ${config.label} à enregistrer est invalide.`);
    return request(base(space), undefined, fetcher, (value, response) => {
      only(response, [201]); const saved = written(value, response, space); const owner = config.owner(saved);
      if (saved.revision !== 1 || saved.state !== "draft" || owner.issuer !== saved.revisedBy.issuer || owner.subject !== saved.revisedBy.subject) throw new ContractError("révision : première révision brouillon du propriétaire attendue");
      return saved;
    }, "POST", sent);
  }
  function revise(space: string, id: string, draft: Draft, expectedRevision: number, fetcher: Fetch = fetch) {
    const bad = problem(space, id, expectedRevision); if (bad !== null) return rejected(bad);
    const sent = checkedDraft(draft); if (sent === null) return rejected(`Le ${config.label} à enregistrer est invalide.`);
    return request(named(space, id), undefined, fetcher, (value, response) => { only(response, [200, 201]); const saved = written(value, response, space); if (saved.id !== id || saved.revision !== expectedRevision + (response.status === 201 ? 1 : 0)) throw new ContractError("révision : numéro attendu"); return saved; }, "PUT", { ...sent, expected_revision: expectedRevision });
  }
  function remove(space: string, id: string, expectedRevision: number, fetcher: Fetch = fetch) {
    const bad = problem(space, id, expectedRevision); if (bad !== null) return rejected(bad);
    const query = new URLSearchParams({ expected_revision: String(expectedRevision) });
    return request(`${named(space, id)}?${query.toString()}`, undefined, fetcher, (value, response) => { only(response, [204]); return value as null; }, "DELETE");
  }
  function diff(space: string, id: string, from: number, to: number, signal: AbortSignal, fetcher: Fetch = fetch) {
    const bad = problem(space, id, from) ?? problem(space, id, to); if (bad !== null) return rejected(bad);
    const query = new URLSearchParams({ from: String(from), to: String(to) });
    return request(`${named(space, id)}/diff?${query.toString()}`, signal, fetcher, (value, response) => { only(response, [200]); return config.diff(value, id, from, to); });
  }
  function approve(space: string, id: string, number: number, expectedRevision: number, fetcher: Fetch = fetch) {
    const bad = problem(space, id, number) ?? problem(space, id, expectedRevision); if (bad !== null) return rejected(bad);
    return request(`${named(space, id)}/approvals`, undefined, fetcher, (value, response) => { only(response, [201]); return config.approval(value, id); }, "POST", { revision: number, expected_revision: expectedRevision });
  }
  return { list, read, readRevision, history, approvals, consumers, create, revise, remove, diff, approve };
}
