import type { PageTemplateRevision } from "../../page-templates/model";
import type { TemplateNode, TemplateRow } from "../../page-templates/document";
import { decodeDashboardDraft, type DashboardDraft, type LayoutNode, type Row } from "../document";

/** Instancie un modèle sans réutiliser les identifiants de son arbre ni inventer de cibles de filtre. */
export function instantiateTemplate(template: Pick<PageTemplateRevision, "revision" | "pageTemplate">, options: { name: string; visibility: DashboardDraft["visibility"]; theme?: { theme_id: string; revision: number } }, uuid: () => string = () => crypto.randomUUID()): DashboardDraft {
  const node = (item: TemplateNode): LayoutNode => {
    if (item.type === "slot") return { id: uuid(), type: "slot", slot: { expected: item.expected, label: item.label } };
    if (item.type === "container") return { id: uuid(), type: "container", rows: rows(item.rows) };
    return { ...item, id: uuid() };
  };
  const rows = (items: readonly TemplateRow[]): Row[] => items.map((row) => ({ id: uuid(), columns: row.columns.map((column) => ({ id: uuid(), span: column.span, children: column.children.map(node) })) }));
  const source = template.pageTemplate;
  return decodeDashboardDraft({ name: options.name, description: source.description, visibility: options.visibility, defaults: source.defaults, ...(options.theme === undefined ? {} : { theme: options.theme }), template: { template_id: source.id, revision: template.revision }, filters: source.filters.map((filter) => ({ ...filter, id: uuid(), targets: [] })), layout: { sections: source.layout.sections.map((section) => ({ ...section, id: uuid(), rows: rows(section.rows) })) } });
}
