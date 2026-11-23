import { ContractError } from "../../catalogue/decode";
import type { ComponentDocument } from "../../components-lib/document";
import type { PageTemplateDraft } from "../../page-templates/client";
import { decodePageTemplate, type TemplateNode, type TemplateRow } from "../../page-templates/document";
import type { DashboardDocument, PublishedRow } from "../document";
import { referenceKey } from "./useReferenceStates";

/** Documents épinglés, indexés comme les lectures de useReferenceStates. */
export type ResolvedComponents = Readonly<Record<string, ComponentDocument | undefined>>;
export type ExtractionResult = { ok: true; draft: PageTemplateDraft } | { ok: false; reason: "unresolved_component"; id: string; revision: number } | { ok: false; reason: "component_id_mismatch"; id: string; revision: number } | { ok: false; reason: "invalid_template"; detail: string };
type RowsResult = { ok: true; rows: TemplateRow[] } | Exclude<ExtractionResult, { ok: true }>;

/** Copie le squelette sans exporter d'analyse, de référence de composant ni de cible de filtre. */
export function extractTemplate(source: DashboardDocument, components: ResolvedComponents): ExtractionResult {
  function rows(items: readonly PublishedRow[]): RowsResult {
    const result: TemplateRow[] = [];
    for (const row of items) {
      const columns: { id: string; span: number; children: TemplateNode[] }[] = [];
      for (const column of row.columns) {
        const children: TemplateNode[] = [];
        for (const node of column.children) {
          if (node.type === "container") {
            const nested = rows(node.rows);
            if (!nested.ok) return nested;
            children.push({ id: node.id, type: "container", rows: nested.rows });
          } else if (node.type === "text" || node.type === "separator") {
            children.push(structuredClone(node));
          } else {
            let expected: "visual" | "kpi";
            let title: string | undefined;
            if (node.type === "component") {
              const { component_id: id, revision } = node.component;
              const found = components[referenceKey({ kind: "component", id, revision })];
              if (found === undefined) return { ok: false, reason: "unresolved_component", id, revision };
              if (found.id !== id) return { ok: false, reason: "component_id_mismatch", id, revision };
              expected = found.kind; title = found.presentation.title;
            } else {
              expected = node.type === "analysis" ? "visual" : "kpi";
              title = node.presentation.title;
            }
            const label = Array.from(title || (expected === "visual" ? "Visuel" : "KPI")).slice(0, 80).join("");
            children.push({ id: node.id, type: "slot", expected, label });
          }
        }
        columns.push({ id: column.id, span: column.span, children });
      }
      result.push({ id: row.id, columns });
    }
    return { ok: true, rows: result };
  }
  const sections: { id: string; title?: string; rows: TemplateRow[] }[] = [];
  for (const section of source.layout.sections) {
    const extracted = rows(section.rows);
    if (!extracted.ok) return extracted;
    sections.push({ id: section.id, ...(section.title === undefined ? {} : { title: section.title }), rows: extracted.rows });
  }
  try {
    const document = decodePageTemplate({ api_version: "board.page_template/v1", id: source.id, owner: source.owner, name: source.name, description: source.description, defaults: structuredClone(source.defaults), filters: source.filters.map((filter) => Object.fromEntries(Object.entries(structuredClone(filter)).filter(([key]) => key !== "targets"))), layout: { sections } });
    const draft = Object.fromEntries(Object.entries(document).filter(([key]) => !["api_version", "id", "owner"].includes(key))) as PageTemplateDraft;
    return { ok: true, draft };
  } catch (error) {
    if (error instanceof ContractError) return { ok: false, reason: "invalid_template", detail: error.message };
    throw error;
  }
}
