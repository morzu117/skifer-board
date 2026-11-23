import { VIOLATION_LABELS } from "../analyses/labels";
import { DASHBOARD_RULE_LABELS } from "../dashboards/labels";
import { ROLE_LABELS, type Role } from "../spaces/model";
import type { ThemeRefusal } from "./refusal";

/** Libellés fermés des refus des routes de thèmes. */
export const REFUSAL_LABELS: Readonly<Record<ThemeRefusal["code"], string>> = {
  theme_not_found: "Thème introuvable", invalid_theme: "Thème invalide", already_approved: "Révision déjà approuvée", not_owner: "Vous n'êtes pas propriétaire", content_in_use: "Thème utilisé", content_unavailable: "Dépôt indisponible", revision_conflict: "Conflit de révision", forbidden: "Accès refusé", local_mode: "Mode local", space_not_found: "Espace introuvable", invalid_request: "Demande invalide", invalid_parameter: "Paramètre invalide",
};
export const INDEX_LABELS = { indexed: "À jour", index_stale: "Index périmé" } as const;

export const PROBLEM_LABELS: Readonly<Record<import("./chartTheme").PaletteRule | "name_required", string>> = {
  name_required: "Nom requis.", token_not_admissible: "Ce token n'est pas admissible pour cette base.", not_monotone: "Les contrastes des paliers doivent progresser.", even_diverging: "La palette divergente doit avoir un nombre impair de paliers.", non_neutral: "Le palier central doit être neutre.", diverging_sides: "Les extrémités doivent contraster davantage que le centre.", duplicate_color: "Les couleurs de la palette doivent être distinctes.", out_of_bounds: "Le nombre de paliers est hors limites.", duplicate_item: "Chaque token doit être distinct.", hex_color: "Une couleur brute n'est pas permise.",
};

export const EDITION_REFUSAL_LABELS: Readonly<Record<import("./edition").Refusal, string>> = {
  invalid_command: "Cette modification est invalide.", invalid_index: "Ce palier est hors limites.", token_not_admissible: "Ce token n’est pas admissible à cet emplacement.",
};

export const THEME_VIOLATION_LABELS: Readonly<Record<string, string>> = { ...VIOLATION_LABELS, ...PROBLEM_LABELS };

export const CONTENT_RULE_LABELS: Readonly<Record<string, string>> = { ...THEME_VIOLATION_LABELS, ...DASHBOARD_RULE_LABELS, stale: "révision périmée" };

/** Un seul libellé pour les refus des trois genres, en conservant les précisions du serveur. */
export function refusalText(value: { code: string; reason?: string; required?: string; field?: string; parameter?: string; detail?: string }): string {
  const labels: Readonly<Record<string, string>> = { ...REFUSAL_LABELS, page_template_not_found: "Modèle introuvable", invalid_page_template: "Modèle invalide", component_not_found: "Composant introuvable", invalid_component: "Composant invalide", analysis_not_found: "Analyse introuvable", personal_reference: "Référence personnelle" };
  const details = [
    value.reason === undefined ? undefined : `raison : ${CONTENT_RULE_LABELS[value.reason] ?? value.reason}`,
    value.required === undefined ? undefined : `rôle requis : ${Object.hasOwn(ROLE_LABELS, value.required) ? ROLE_LABELS[value.required as Role] : value.required}`,
    value.field === undefined ? undefined : `champ : ${value.field}`,
    value.parameter === undefined ? undefined : `paramètre : ${value.parameter}`,
    value.detail === undefined ? undefined : `détail : ${value.detail}`,
  ];
  return [labels[value.code] ?? `Refus du serveur · code : ${value.code}`, ...details.filter((part): part is string => part !== undefined)].join(" · ");
}


/** Noms affichés des domaines fermés du thème. */
export const FIELD_LABELS = { legend: "Légende", number_format: "Format des nombres", tooltip: "Infobulle" } as const;
export const OPTION_LABELS: Readonly<Record<string, string>> = {
  "": "Par défaut", "skifer-clair": "Skifer clair", "skifer-ardoise": "Skifer ardoise",
  sans: "Sans empattement", mono: "Chasse fixe", compact: "Compact", normal: "Normal", large: "Grande", airy: "Aérée",
  auto: "Automatique", integer: "Entier", decimal_1: "Une décimale", decimal_2: "Deux décimales", percent: "Pourcentage",
  short: "Court", medium: "Moyen", long: "Long", iso: "ISO", shown: "Affichée", hidden: "Masquée",
  value: "Valeur", value_and_definition: "Valeur et définition",
};
export const MARK_LABELS = { series: "Série", secondary: "Secondaire", selected: "Sélection", threshold: "Seuil", positive: "Positif", negative: "Négatif", total: "Total" } as const;
export const TEXT_LABELS = { text: "Texte", textStrong: "Texte fort", textMuted: "Texte atténué", thresholdLabel: "Libellé du seuil" } as const;
export const PALETTE_LABELS = { categorical: "Catégorielle", sequential: "Séquentielle", diverging: "Divergente" } as const;
export const CHART_LABELS = { value: "Valeur", bars: "Barres", line: "Ligne", grouped_bars: "Barres groupées" } as const;
/** Un chemin serveur reste visible, accompagné d'un nom lisible. */
export function themePathLabel(path: string): string {
  const parts = path.split("/").slice(1);
  const names: Readonly<Record<string, string>> = { name: "Nom", description: "Description", base: "Base", roles: "Rôles", marks: "Marques", typography: "Typographie", density: "Densité", formats: "Formats", chart_defaults: "Défauts des graphiques", number: "Nombres", date: "Dates", scale: "Échelle", sans: "Famille sans empattement", mono: "Famille à chasse fixe", owner: "Propriétaire", issuer: "Émetteur", subject: "Sujet", ...MARK_LABELS, ...TEXT_LABELS, ...PALETTE_LABELS, ...CHART_LABELS, ...FIELD_LABELS };
  return parts.map((part) => /^\d+$/.test(part) ? `Palier ${String(Number(part) + 1)}` : names[part] ?? part).join(" · ");
}
