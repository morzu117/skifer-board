import { fetchComponent, fetchComponentRevision } from "../../components-lib/client";
import { useMemo } from "react";
import { fetchTheme, fetchThemeRevision } from "../../themes/client";
import type { ThemeDocument } from "../../themes/document";
import type { ComponentDocument } from "../../components-lib/document";
import type { Fetch } from "../../spaces/api";
import { useOutcome } from "../../ui/useOutcome";
import { executableNodes, type DashboardDraft } from "../document";

export type Reference = { kind: "theme" | "component"; id: string; revision: number };
export type ReferenceState = { state: "draft" | "approved"; approved_revision: number | null; current_revision: number; theme?: ThemeDocument; component?: ComponentDocument } | { state: "unresolved" };
export const referenceKey = (reference: Reference): string => `${reference.kind}:${reference.id}:${String(reference.revision)}`;

/** Références distinctes du brouillon, même dans les conteneurs. */
export function referencesOf(document: DashboardDraft): Reference[] {
  const references: Reference[] = document.theme ? [{ kind: "theme", id: document.theme.theme_id, revision: document.theme.revision }] : [];
  for (const node of executableNodes(document)) if (node.type === "component") references.push({ kind: "component", id: node.component.component_id, revision: node.component.revision });
  return [...new Map(references.map((reference) => [referenceKey(reference), reference])).values()].sort((a, b) => referenceKey(a).localeCompare(referenceKey(b)));
}

/** Les lectures utilisent l'identité de la session ; une erreur n'établit aucune approbation. */
export function useReferenceStates(space: string, identity: string, dashboard: string, references: readonly Reference[], fetcher: Fetch): Readonly<Record<string, ReferenceState>> {
  const unique = [...new Map(references.map((reference) => [referenceKey(reference), reference])).values()];
  const key = JSON.stringify([space, identity, dashboard, unique]);
  // Une nouvelle identité d'objet distingue aussi A → B → A d'une même lecture de A.
  const generation = useMemo(() => ({ key }), [key]);
  const result = useOutcome(generation, async (signal) => {
    const currents = new Map<string, Promise<{ status: "ok"; value: { revision: number } } | { status: "error" | "refused" }>>();
    const load = async (reference: Reference): Promise<readonly [string, ReferenceState]> => {
      const group = `${reference.kind}:${reference.id}`;
      let current = currents.get(group);
      if (current === undefined) {
        current = reference.kind === "component" ? fetchComponent(space, reference.id, signal, fetcher) : fetchTheme(space, reference.id, signal, fetcher);
        currents.set(group, current);
      }
      const pinned = reference.kind === "component" ? fetchComponentRevision(space, reference.id, reference.revision, signal, fetcher) : fetchThemeRevision(space, reference.id, reference.revision, signal, fetcher);
      const [latest, read] = await Promise.all([current, pinned]);
      return [referenceKey(reference), latest.status === "ok" && read.status === "ok" ? { state: read.value.state, approved_revision: read.value.approvedRevision, current_revision: latest.value.revision, ...("theme" in read.value ? { theme: read.value.theme } : {}), ...("component" in read.value ? { component: read.value.component } : {}) } : { state: "unresolved" }];
    };
    return Object.fromEntries(await Promise.all(unique.map(load)));
  });
  return "status" in result && result.status === "loading" ? {} : result as Readonly<Record<string, ReferenceState>>;
}
