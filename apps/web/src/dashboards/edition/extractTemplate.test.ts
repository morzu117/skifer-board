import { expect, it, vi } from "vitest";
import * as templateDocument from "../../page-templates/document";
import example from "../../../../../contracts/page_templates/extraction/dashboard-vers-modele.json";
import { decodeComponent } from "../../components-lib/document";
import { decodeDashboard } from "../document";
import { extractTemplate } from "./extractTemplate";
import { referenceKey } from "./useReferenceStates";

const source = () => decodeDashboard(structuredClone(example.dashboard));
const component = () => decodeComponent(structuredClone(example.components[0]?.document));
const key = () => referenceKey({ kind: "component", id: component().id, revision: 2 });
const components = () => ({ [key()]: component() });

it("reproduit exactement l'extraction serveur, sans muter les entrées", () => {
  const dashboard = source(); const resolved = components();
  const before = structuredClone({ dashboard, resolved });
  const result = extractTemplate(dashboard, resolved);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  expect({ api_version: "board.page_template/v1", id: example.template_id, owner: dashboard.owner, ...result.draft }).toEqual(example.expected);
  expect({ dashboard, resolved }).toEqual(before);
  const inspect = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(inspect); return; }
    if (typeof value !== "object" || value === null) return;
    for (const [key, child] of Object.entries(value)) { expect(["analysis_id", "targets", "component_id", "reference", "component"]).not.toContain(key); inspect(child); }
  };
  inspect(result.draft);
  const children = result.draft.layout.sections[0]?.rows[0]?.columns[0]?.children;
  expect(children?.[1]).toMatchObject({ type: "slot", expected: "kpi", label: "KPI" });
  expect(children?.[2]).toMatchObject({ type: "slot", expected: "visual", label: "É".repeat(80) });
});
it("refuse une référence non résolue ou incohérente", () => {
  const id = component().id;
  expect(extractTemplate(source(), {})).toEqual({ ok: false, reason: "unresolved_component", id, revision: 2 });
  expect(extractTemplate(source(), { [key()]: { ...component(), id: "00000000-0000-4000-8000-000000000099" } })).toEqual({ ok: false, reason: "component_id_mismatch", id, revision: 2 });
});
it("emploie le libellé par défaut pour un visuel sans titre et copie les valeurs", () => {
  const dashboard = source();
  const node = dashboard.layout.sections[0]?.rows[0]?.columns[0]?.children[0];
  if (node?.type !== "analysis") throw new Error("visuel attendu");
  delete node.presentation.title;
  const result = extractTemplate(dashboard, { [key()]: { ...component(), presentation: {} } });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  const children = result.draft.layout.sections[0]?.rows[0]?.columns[0]?.children;
  expect(children?.[0]).toMatchObject({ label: "Visuel" });
  expect(children?.[2]).toMatchObject({ label: "Visuel" });
  expect(result.draft.defaults).not.toBe(dashboard.defaults);
});
it("propage le refus dans un conteneur", () => {
  const dashboard = source();
  const section = dashboard.layout.sections[0];
  if (!section) throw new Error("section attendue");
  const shared = section.rows[0]?.columns[0]?.children[2];
  const container = section.rows[1]?.columns[0]?.children[0];
  if (shared?.type !== "component" || container?.type !== "container") throw new Error("conteneur attendu");
  const nested = container.rows[0]?.columns[0];
  if (!nested) throw new Error("colonne attendue");
  const first = section.rows[0]?.columns[0];
  if (!first) throw new Error("colonne initiale attendue");
  (first.children as unknown[]).splice(2, 1);
  (nested.children as (typeof shared)[]).splice(0, nested.children.length, shared);
  expect(extractTemplate(dashboard, {})).toMatchObject({ ok: false, reason: "unresolved_component" });
});

it("conserve une section sans titre", () => {
  const dashboard = source(); const section = dashboard.layout.sections[0];
  if (!section) throw new Error("section attendue");
  delete section.title;
  const result = extractTemplate(dashboard, components());
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  expect(result.draft.layout.sections[0]).not.toHaveProperty("title");
});
it("renvoie un refus si le modèle extrait ne respecte pas son contrat", () => {
  const dashboard = source(); dashboard.description = "x".repeat(2001);
  const result = extractTemplate(dashboard, components());
  expect(result).toMatchObject({ ok: false, reason: "invalid_template" });
  if (result.ok || result.reason !== "invalid_template") throw new Error("refus de contrat attendu");
  expect(result.detail).toContain("description");
});
it("ne masque pas les erreurs étrangères au contrat", () => {
  const spy = vi.spyOn(templateDocument, "decodePageTemplate").mockImplementation(() => { throw new Error("panne inattendue"); });
  try { expect(() => extractTemplate(source(), components())).toThrow("panne inattendue"); } finally { spy.mockRestore(); }
});
