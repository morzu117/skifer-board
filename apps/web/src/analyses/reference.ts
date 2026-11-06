import { exact, revision, uuid } from "./shape";

/** Référence d'analyse d'une soumission d'exécution (plan 18, A8) : `{id, revision}` et rien d'autre. */
export interface AnalysisReference {
  id: string;
  revision: number;
}

export function decodeReference(value: unknown, path = "analyse"): AnalysisReference {
  const found = exact(value, ["id", "revision"], path);
  return { id: uuid(found.id, `${path}.id`), revision: revision(found.revision, `${path}.revision`) };
}

/** Identifiant d'événement d'ouverture : un UUID minuscule tiré côté client, rejouable (plan 18, A8). */
export function newEventId(): string {
  return crypto.randomUUID();
}
