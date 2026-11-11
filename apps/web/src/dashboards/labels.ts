import type { StateLabel } from "../analyses/labels";
import type { ListState, ReadState } from "../analyses/model";
import type { ChartKind, Visibility } from "../analyses/document";
import type { Block, Legend, NumberFormat, Tooltip, VisualPresentation } from "./document";
import type { Refusal as EditRefusal, Kind, Origin } from "./edition/commands";
import type { ExecutionRefusal } from "./edition/execution";
import type { ProblemCode } from "./edition/problems";
import type { DashboardRule } from "./refusal";

/**
 * Libellés des écrans de dashboards (plan 19, 19.5a). Chaque table est indexée par une union fermée du contrat ou du modèle
 * d'édition : une valeur nouvelle ne compile pas sans libellé, et les décodeurs refusent déjà toute valeur hors domaine, donc
 * aucun libellé n'est inventé pour ce qu'on ne connaît pas.
 */
export const VISIBILITY_LABELS: Readonly<Record<Visibility, string>> = { personal: "Personnel", shared: "Partagé" };

export const LIST_STATE_LABELS: Readonly<Record<ListState, StateLabel>> = {
  indexed: { label: "Indexé", tone: "success", reason: "L'index correspond au dépôt." },
  index_stale: { label: "Index en retard", tone: "warning", reason: "L'index ne correspond plus au dépôt : cette ligne peut être périmée, ouvrez le dashboard pour lire celui du dépôt." },
};

export const READ_STATE_LABELS: Readonly<Record<ReadState, StateLabel>> = {
  index_stale: { label: "Index en retard", tone: "warning", reason: "L'index de la base est en retard sur le dépôt : le contenu affiché vient du dépôt (git), les actions offertes restent celles que le serveur accorde." },
  unverified: { label: "Non vérifié", tone: "warning", reason: "Le catalogue sémantique n'a pas pu être lu : les tuiles ne sont ni confirmées ni infirmées, aucune n'est exécutée." },
  unresolved_reference: { label: "Référence non résolue", tone: "danger", reason: "Au moins une tuile est indisponible, avec sa raison. Aucune n'est remplacée ni devinée." },
  ready: { label: "Prêt", tone: "success", reason: "Toutes les tuiles sont prêtes." },
};

/** Pourquoi une tuile ne s'exécute pas : la raison est dite, jamais une approximation. */
export const TILE_REASON_LABELS: Readonly<Record<ExecutionRefusal, string>> = {
  analysis_unavailable: "L'analyse épinglée n'est pas disponible pour vous : elle est supprimée ou ne vous est pas ouverte.",
  unresolved_reference: "Une référence de l'analyse épinglée n'est pas résolue dans le catalogue.",
  filter_incompatible: "Un filtre commun ne s'applique pas à cette tuile : sa dimension, son opérateur ou ses valeurs ne conviennent pas.",
  unverified: "Le catalogue n'a pas pu être lu : la tuile n'est ni confirmée ni infirmée.",
  too_many_filters: "Les filtres de l'analyse et les filtres communs dépassent la limite de 32.",
  invalid_filter_value: "La valeur par défaut d'un filtre commun est invalide pour cette tuile.",
  reference_mismatch: "L'analyse lue n'est pas celle que le composant épingle.",
  tile_mismatch: "L'état de la tuile ne correspond pas au composant.",
};

export const KIND_LABELS: Readonly<Record<Kind, string>> = {
  section: "Section", row: "Rangée", column: "Colonne", container: "Conteneur", analysis: "Visuel", kpi: "KPI", text: "Texte", separator: "Séparateur",
};
export const GENDERS = {
  kind: { section: "f", row: "f", column: "f", container: "m", analysis: "m", kpi: "m", text: "m", separator: "m" } satisfies Record<Kind, "f" | "m">,
  presentation: { title: "m", chart: "m", legend: "f", number_format: "m", threshold: "m", tooltip: "f" } satisfies Record<keyof VisualPresentation, "f" | "m">,
  block: { paragraph: "m", heading: "m", list: "f" } satisfies Record<Block["type"], "f" | "m">,
} as const;
export const accord = (word: string, gender: "f" | "m"): string => `${word}${gender === "f" ? "e" : ""}`;

/** Refus fermés du modèle d'édition, tels qu'une commande les rend. */
export const EDIT_REFUSAL_LABELS: Readonly<Record<EditRefusal, string>> = {
  not_found: "Élément introuvable.",
  incompatible_parent: "Cet élément ne peut pas être placé là : son parent n'est pas compatible.",
  invalid_index: "Position hors limites.",
  invalid_property: "Cette propriété ne s'applique pas à cet élément.",
  invalid_document: "Le dashboard ne serait plus valide.",
};

export const PROBLEM_LABELS: Readonly<Record<ProblemCode, string>> = {
  analysis_unavailable: "Analyse indisponible : la tuile ne s'exécute pas.",
  unresolved_reference: "Référence non résolue : la tuile reste indisponible.",
  unverified: "Tuile non vérifiée : le catalogue n'a pas pu être lu.",
  filter_without_target: "Filtre sans cible : il ne s'applique à aucune tuile.",
  filter_incompatible: "Filtre incompatible avec une de ses cibles.",
  limit_reached: "Limite du format atteinte.",
  revision_behind: "Révision d'analyse en retard sur la dernière.",
  kpi_incompatible: "KPI incompatible : l'analyse épinglée ne rend pas une valeur unique.",
  chart_incompatible: "Type de graphique incompatible avec les dimensions de l'analyse.",
};

export const LIMIT_LABELS: Readonly<Record<string, string>> = {
  "/layout/sections": "sections", "/filters": "filtres", nodes: "éléments de mise en page", components: "composants", executable: "composants exécutables", tile_filters: "filtres de la tuile",
};

export const CHART_LABELS: Readonly<Record<ChartKind, string>> = { value: "Valeur", bars: "Barres", line: "Ligne", grouped_bars: "Barres groupées" };
export const LEGEND_LABELS: Readonly<Record<Legend, string>> = { auto: "Automatique", shown: "Affichée", hidden: "Masquée" };
export const NUMBER_FORMAT_LABELS: Readonly<Record<NumberFormat, string>> = {
  auto: "Valeur exacte", integer: "Entier", decimal_1: "Une décimale", decimal_2: "Deux décimales", percent: "Pourcentage", compact: "Compact",
};
export const TOOLTIP_LABELS: Readonly<Record<Tooltip, string>> = { value: "Valeur", value_and_definition: "Valeur et définition" };
export const ORIGIN_LABELS: Readonly<Record<Origin, string>> = { theme: "Thème", analysis: "Analyse", dashboard: "Dashboard", component: "Composant" };

/** Règle du serveur qu'un `invalid_dashboard` nomme, avec le chemin JSON de la violation. */
export const DASHBOARD_RULE_LABELS: Readonly<Record<DashboardRule, string>> = {
  wrong_type: "type de valeur incorrect", value_not_allowed: "valeur non permise", bad_format: "format incorrect", out_of_bounds: "hors des bornes",
  duplicate_item: "élément répété", unknown_field: "champ inconnu", missing_field: "champ manquant", field_not_allowed: "champ non permis ici",
  schema_violation: "document hors du schéma", invalid_filter: "filtre invalide", metric_not_in_query: "métrique absente de la requête",
  group_by_not_in_query: "regroupement absent des dimensions de la requête", reserved_name: "nom réservé", unsupported_value: "valeur non prise en charge",
  unreadable_document: "document illisible", not_representable: "non représentable", id_mismatch: "identifiant incohérent", bad_identifier: "identifiant incorrect",
  bad_revision: "numéro de révision incorrect", bad_actor: "auteur incorrect", duplicate_id: "identifiant répété", row_overflow: "rangée de plus de 12 douzièmes",
  too_deep: "plus de trois niveaux de rangées", container_not_alone: "un conteneur occupe seul sa colonne", filter_without_target: "filtre sans cible",
  unknown_target: "cible absente du document", target_not_executable: "cible qui ne s'exécute pas", default_not_allowed: "valeur par défaut hors des valeurs autorisées",
  analysis_unavailable: "analyse épinglée indisponible", kpi_requires_value: "un KPI demande une valeur unique", chart_incompatible: "type de graphique incompatible",
  dimension_not_exposed: "dimension non exposée par le modèle", filter_type_mismatch: "type de filtre incompatible", operator_not_allowed: "opérateur non permis",
  filter_value_incompatible: "valeur de filtre incompatible", too_many_filters: "trop de filtres sur une tuile",
};
