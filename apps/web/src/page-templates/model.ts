import { decodeSharedRevision } from "../shared-content/model";
import { type Person } from "../analyses/document";
import { exact, fail } from "../analyses/shape";
import { decodeThemeList, type IndexState, type ThemeListItem, type ThemeState } from "../themes/model";
import { decodePageTemplate, type PageTemplate } from "./document";

export { decodeThemeApprovals as decodePageTemplateApprovals, decodeThemeHistory as decodePageTemplateHistory, type ThemeApprovals as PageTemplateApprovals, type ThemeHistory as PageTemplateHistory } from "../themes/model";
export function decodePageTemplateConsumers(value: unknown, id: string): { id: string; consumers: readonly never[]; others: number } {
  const f = exact(value, ["id", "consumers", "others"], "consommateurs");
  if (f.id !== id || !Array.isArray(f.consumers) || f.consumers.length !== 0 || f.others !== 0) return fail("consommateurs", "aucun consommateur de modèle");
  return { id, consumers: [], others: 0 };
}
export interface PageTemplateRevision { id: string; space: string; revision: number; commit: string; committedAt: Date; revisedBy: Person; state: ThemeState; approvedRevision: number | null; indexState: IndexState; pageTemplate: PageTemplate }
export function decodePageTemplateRevision(value: unknown, space: string): PageTemplateRevision {
  const { document, ...metadata } = decodeSharedRevision(value, space, "page_template", decodePageTemplate);
  return { ...metadata, pageTemplate: document };
}
export interface PageTemplateList { pageTemplates: readonly ThemeListItem[]; unreadable: number }
export function decodePageTemplateList(value: unknown): PageTemplateList {
  const f = exact(value, ["page_templates", "unreadable"], "liste");
  const list = decodeThemeList({ themes: f.page_templates, unreadable: f.unreadable });
  return { pageTemplates: list.themes, unreadable: list.unreadable };
}
