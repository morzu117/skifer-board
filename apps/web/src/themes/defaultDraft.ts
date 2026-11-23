import fixture from "../../../../contracts/themes/fixtures/valid/skifer_clair.json";
import type { ThemeDraft } from "./client";
import { decodeTheme } from "./document";

/** Chaque création part d'une copie du thème de référence validé par le contrat. */
export function defaultThemeDraft(): ThemeDraft {
  const { name, description, base, roles, categorical, sequential, diverging, typography, density, formats, chart_defaults } = decodeTheme(fixture);
  return { name, description, base, roles, categorical, sequential, diverging, typography, density, formats, chart_defaults };
}
