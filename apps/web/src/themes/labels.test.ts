import { expect, it } from "vitest";
import { LEGENDS, NUMBER_FORMATS, TOOLTIPS } from "../dashboards/document";
import schema from "../../../../contracts/themes/theme.v1.json";
import { BASES } from "./catalog";
import { CHART_LABELS, FIELD_LABELS, MARK_LABELS, OPTION_LABELS, TEXT_LABELS, themePathLabel } from "./labels";

it("traduit toutes les options et clés fermées de l'éditeur", () => {
  for (const value of ["", ...BASES, "sans", "mono", "compact", "normal", "large", "airy", ...NUMBER_FORMATS, "short", "medium", "long", "iso", ...LEGENDS, ...TOOLTIPS]) expect(OPTION_LABELS[value], value).toBeTruthy();
  for (const value of [...schema.properties.base.enum, ...schema.properties.typography.properties.scale.enum, ...schema.properties.density.enum, ...schema.properties.formats.properties.date.enum]) expect(OPTION_LABELS[value], value).toBeTruthy();
  expect(Object.keys(FIELD_LABELS).sort()).toEqual(Object.keys(schema.$defs.chart_default.properties).sort());
  expect(Object.keys(MARK_LABELS).sort()).toEqual([...schema.$defs.marks.required].sort());
  expect(Object.keys(TEXT_LABELS).sort()).toEqual([...schema.$defs.text_roles.required].sort());
  expect(Object.keys(CHART_LABELS).sort()).toEqual(Object.keys(schema.properties.chart_defaults.properties).sort());
  expect(themePathLabel("/roles/marks/series")).toBe("Rôles · Marques · Série");
  expect(themePathLabel("/categorical/0")).toBe("Catégorielle · Palier 1");
  expect(themePathLabel("/inconnu")).toBe("inconnu");
});
