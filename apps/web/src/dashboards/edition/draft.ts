import { decodeDashboardDraft, type DashboardDocument, type DashboardDraft } from "../document";

/**
 * Ce que le serveur garde d'un dashboard, sous la forme que l'éditeur compare à son brouillon : les champs d'un brouillon, dans
 * l'ordre du décodeur (`isDirty` compare des textes JSON, l'ordre des clés doit donc être le même des deux côtés).
 */
export const draftOf = (document: DashboardDocument): DashboardDraft => decodeDashboardDraft({
  name: document.name,
  description: document.description,
  visibility: document.visibility,
  defaults: document.defaults,
  filters: document.filters,
  layout: document.layout,
});
