import { fetchComponent, fetchComponentRevision } from "../../components-lib/client";
import { useEffect, useMemo, useState } from "react";
import { fetchTheme, fetchThemeRevision } from "../../themes/client";
import type { ThemeDocument } from "../../themes/document";
import type { ComponentDocument } from "../../components-lib/document";
import type { Fetch } from "../../spaces/api";
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

/** Chaque résultat remplace celui de sa clé dès sa réception, y compris un refus. */
export function useReferenceStates(space: string, identity: string, dashboard: string, references: readonly Reference[], fetcher: Fetch): Readonly<Record<string, ReferenceState>> {
  const unique = [...new Map(references.map((reference) => [referenceKey(reference), reference])).values()];
  const key = JSON.stringify(unique);
  const scope = useMemo(() => ({ space, identity, dashboard, fetcher }), [space, identity, dashboard, fetcher]);
  const [snapshot, setSnapshot] = useState<{ scope: object; values: Record<string, ReferenceState> }>({ scope, values: {} });
  useEffect(() => {
    const controller = new AbortController();
    const currents = new Map<string, Promise<{ status: "ok"; value: { revision: number; approvedRevision: number | null } } | { status: "error" | "refused" }>>();
    const load = async (reference: Reference): Promise<void> => {
      const group = `${reference.kind}:${reference.id}`;
      let current = currents.get(group);
      if (current === undefined) {
        current = reference.kind === "component" ? fetchComponent(space, reference.id, controller.signal, fetcher) : fetchTheme(space, reference.id, controller.signal, fetcher);
        currents.set(group, current);
      }
      const pinned = reference.kind === "component" ? fetchComponentRevision(space, reference.id, reference.revision, controller.signal, fetcher) : fetchThemeRevision(space, reference.id, reference.revision, controller.signal, fetcher);
      const [latest, read] = await Promise.all([current, pinned]);
      if (controller.signal.aborted) return;
      const value: ReferenceState = latest.status === "ok" && read.status === "ok" ? { state: read.value.state, approved_revision: latest.value.approvedRevision, current_revision: latest.value.revision, ...("theme" in read.value ? { theme: read.value.theme } : {}), ...("component" in read.value ? { component: read.value.component } : {}) } : { state: "unresolved" };
      setSnapshot((previous) => ({ scope, values: { ...(previous.scope === scope ? previous.values : {}), [referenceKey(reference)]: value } }));
    };
    const parsed = JSON.parse(key) as Reference[];
    for (const reference of parsed) void load(reference).catch(() => {
      if (!controller.signal.aborted) setSnapshot((previous) => ({ scope, values: { ...(previous.scope === scope ? previous.values : {}), [referenceKey(reference)]: { state: "unresolved" } } }));
    });
    return () => { controller.abort(); };
  }, [key, scope, space, fetcher]);
  // Le contenu épinglé est immuable ; approbation et révision courante gardent les valeurs précédentes pendant la relecture, le serveur restant juge.
  return useMemo(() => {
    const values = snapshot.scope === scope ? snapshot.values : {};
    const parsed = JSON.parse(key) as Reference[];
    return Object.fromEntries(parsed.flatMap((reference) => { const name = referenceKey(reference); const value = values[name]; return value === undefined ? [] : [[name, value]]; }));
  }, [key, scope, snapshot]);
}
