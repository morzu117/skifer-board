import { bounded, decodeName } from "../analyses/document";
import { ContractError } from "../catalogue/decode";
import { LEGENDS, NUMBER_FORMATS, TOOLTIPS } from "../dashboards/document";
import { themeProblems as problems, type PaletteProblem } from "./chartTheme";
import type { Base, Role, TokenCatalog } from "./catalog";
import type { ThemeDraft } from "./client";
import type { ThemeDocument } from "./document";

export type Document = ThemeDocument | ThemeDraft;
export type Palette = "categorical" | "sequential" | "diverging";
export type Mark = "series" | "secondary" | "selected" | "threshold" | "positive" | "negative" | "total";
export type Chart = "value" | "bars" | "line" | "grouped_bars";
export type Command =
  | { type: "base"; value: Base }
  | { type: "mark"; role: Mark; token: string }
  | { type: "palette_add"; palette: Palette; index: number; token: string }
  | { type: "palette_remove"; palette: Palette; index: number }
  | { type: "palette_move"; palette: Palette; from: number; to: number }
  | { type: "typography"; field: "sans" | "mono" | "scale"; value: string }
  | { type: "density"; value: string }
  | { type: "format"; field: "number" | "date"; value: string }
  | { type: "chart_default"; chart: Chart; field: "legend" | "number_format" | "tooltip"; value: string | null }
  | { type: "name" | "description"; value: string };
export type Refusal = "invalid_command" | "invalid_index" | "token_not_admissible";
export type Result<T extends Document> = { ok: true; document: T } | { ok: false; reason: Refusal; document: T };
const palettes: readonly Palette[] = ["categorical", "sequential", "diverging"];
const marks: readonly Mark[] = ["series", "secondary", "selected", "threshold", "positive", "negative", "total"];
const charts: readonly Chart[] = ["value", "bars", "line", "grouped_bars"];
const options = { sans: ["sans"], mono: ["mono"], scale: ["compact", "normal", "large"], density: ["compact", "normal", "airy"], number: NUMBER_FORMATS, date: ["short", "medium", "long", "iso"], legend: LEGENDS, number_format: NUMBER_FORMATS, tooltip: TOOLTIPS } as const;
const accepts = (values: readonly string[], value: unknown): value is string => typeof value === "string" && values.includes(value);
const indexWithin = (index: number, length: number, end: boolean): boolean => Number.isInteger(index) && index >= 0 && index < length + Number(end);
/** Les paliers intermédiaires d'une échelle peuvent utiliser tout token connu du catalogue. */
export function choicesFor(catalog: TokenCatalog, base: Base, role: Role | "palette"): readonly string[] {
  return Object.keys(role === "palette" ? catalog.luminance : catalog.bases[base][role]);
}
/** Problèmes bloquants : mêmes chemins et codes que la validation serveur. */
export function themeProblems(draft: Document, catalog: TokenCatalog): PaletteProblem[] {
  return problems(draft as ThemeDocument, catalog);
}
export const canSave = (draft: Document, catalog: TokenCatalog): boolean => themeProblems(draft, catalog).length === 0;

/** Applique une commande à une copie ; les problèmes interchamps restent visibles pendant l'édition. */
export function applyCommand<T extends Document>(document: T, command: Command, catalog: TokenCatalog): Result<T> {
  const copy = structuredClone(document);
  const refuse = (reason: Refusal): Result<T> => ({ ok: false, reason, document });
  switch (command.type) {
    case "base":
      if (!accepts(["skifer-clair", "skifer-ardoise"], command.value)) return refuse("invalid_command");
      copy.base = command.value; break;
    case "mark":
      if (!marks.includes(command.role)) return refuse("invalid_command");
      if (!Object.hasOwn(catalog.bases[copy.base].mark, command.token)) return refuse("token_not_admissible");
      copy.roles.marks[command.role] = command.token; break;
    case "palette_add": {
      if (!palettes.includes(command.palette)) return refuse("invalid_command");
      const values = copy[command.palette] as string[];
      if (!indexWithin(command.index, values.length, true)) return refuse("invalid_index");
      const required = command.palette === "categorical" || (command.palette === "sequential" && command.index === values.length) || (command.palette === "diverging" && (command.index === 0 || command.index === values.length));
      if (!Object.hasOwn(catalog.luminance, command.token) || (required && !Object.hasOwn(catalog.bases[copy.base].mark, command.token))) return refuse("token_not_admissible");
      values.splice(command.index, 0, command.token); break;
    }
    case "palette_remove": {
      if (!palettes.includes(command.palette)) return refuse("invalid_command");
      const values = copy[command.palette] as string[];
      if (!indexWithin(command.index, values.length, false)) return refuse("invalid_index");
      values.splice(command.index, 1); break;
    }
    case "palette_move": {
      if (!palettes.includes(command.palette)) return refuse("invalid_command");
      const values = copy[command.palette] as string[];
      if (!indexWithin(command.from, values.length, false) || !indexWithin(command.to, values.length, false)) return refuse("invalid_index");
      const token = values[command.from] as string;
      const required = command.palette === "categorical" || (command.palette === "sequential" && command.to === values.length - 1) || (command.palette === "diverging" && (command.to === 0 || command.to === values.length - 1));
      if (!Object.hasOwn(catalog.luminance, token) || (required && !Object.hasOwn(catalog.bases[copy.base].mark, token))) return refuse("token_not_admissible");
      values.splice(command.from, 1); values.splice(command.to, 0, token); break;
    }
    case "typography":
      if (!["sans", "mono", "scale"].includes(command.field) || !accepts(options[command.field], command.value)) return refuse("invalid_command");
      Object.assign(copy.typography, { [command.field]: command.value }); break;
    case "density":
      if (!accepts(options.density, command.value)) return refuse("invalid_command");
      copy.density = command.value as typeof copy.density; break;
    case "format":
      if (!["number", "date"].includes(command.field) || !accepts(options[command.field], command.value)) return refuse("invalid_command");
      Object.assign(copy.formats, { [command.field]: command.value }); break;
    case "chart_default": {
      if (!charts.includes(command.chart) || !["legend", "number_format", "tooltip"].includes(command.field) || (command.value !== null && !accepts(options[command.field], command.value))) return refuse("invalid_command");
      const current = copy.chart_defaults[command.chart];
      const entry = command.value === null ? Object.fromEntries(Object.entries(current ?? {}).filter(([key]) => key !== command.field)) : { ...current, [command.field]: command.value };
      copy.chart_defaults = Object.keys(entry).length === 0
        ? Object.fromEntries(Object.entries(copy.chart_defaults).filter(([key]) => key !== command.chart))
        : { ...copy.chart_defaults, [command.chart]: entry };
      break;
    }
    case "name": case "description":
      try { copy[command.type] = command.type === "name" ? decodeName(command.value, "nom") : bounded(command.value, "description", 0, 2000, true); }
      catch (error) { if (!(error instanceof ContractError)) throw error; return refuse("invalid_command"); }
      break;
    default: return refuse("invalid_command");
  }
  return { ok: true, document: copy };
}
export interface History<T extends Document> { past: readonly T[]; present: T; future: readonly T[]; saved: T }
export const createHistory = <T extends Document>(document: T): History<T> => ({ past: [], present: document, future: [], saved: document });
export function dispatch<T extends Document>(history: History<T>, command: Command, catalog: TokenCatalog): { history: History<T>; result: Result<T> } {
  const result = applyCommand(history.present, command, catalog);
  if (!result.ok || JSON.stringify(result.document) === JSON.stringify(history.present)) return { history, result };
  return { history: { ...history, past: [...history.past, history.present].slice(-99), present: result.document, future: [] }, result };
}
export function undo<T extends Document>(history: History<T>): History<T> {
  const previous = history.past.at(-1);
  return previous === undefined ? history : { ...history, past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] };
}
export function redo<T extends Document>(history: History<T>): History<T> {
  const next = history.future[0];
  return next === undefined ? history : { ...history, past: [...history.past, history.present], present: next, future: history.future.slice(1) };
}
/** Un brouillon comportant un problème ne peut pas être marqué comme enregistré. */
export const markSaved = <T extends Document>(history: History<T>, catalog: TokenCatalog): History<T> => canSave(history.present, catalog) ? { ...history, saved: history.present } : history;
export const isDirty = <T extends Document>(history: History<T>): boolean => JSON.stringify(history.present) !== JSON.stringify(history.saved);
