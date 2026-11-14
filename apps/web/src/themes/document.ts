import schema from "../../../../contracts/themes/theme.v1.json";
import { bounded, decodeName, decodePerson } from "../analyses/document";
import { distinct, exact, fail, items, pick, record, uuid } from "../analyses/shape";
import { LEGENDS, NUMBER_FORMATS, TOOLTIPS } from "../dashboards/document";

/** Décode le schéma du thème ; les contrastes et luminances sont vérifiés par le serveur. */
export function decodeTheme(value: unknown, path = "theme") {
  const found = exact(value, ["api_version", "id", "name", "description", "owner", "base", "roles", "categorical", "sequential", "diverging", "typography", "density", "formats", "chart_defaults"], path);
  if (found.api_version !== "board.theme/v1") return fail(`${path}.api_version`, "board.theme/v1");
  const token = (v: unknown, p: string) => pick(v, schema.$defs.token.enum, p);
  const roles = exact(found.roles, ["marks", "text"], `${path}.roles`);
  const roleSet = (v: unknown, keys: readonly string[], p: string) => {
    const obj = exact(v, keys, p);
    return Object.fromEntries(keys.map((key) => [key, token(obj[key], `${p}.${key}`)]));
  };
  const palette = (v: unknown, p: string, min: number, max: number) => items(v, p, max, min).map((item, index) => token(item, `${p}[${String(index)}]`));
  const typography = exact(found.typography, ["sans", "mono", "scale"], `${path}.typography`);
  const formats = exact(found.formats, ["number", "date"], `${path}.formats`);
  const charts = record(found.chart_defaults, `${path}.chart_defaults`);
  const allowed = ["value", "bars", "line", "grouped_bars"];
  if (!Object.keys(charts).every((key) => allowed.includes(key))) return fail(`${path}.chart_defaults`, "types de graphiques connus");
  const chartDefaults = Object.fromEntries(Object.entries(charts).map(([key, value]) => {
    const p = `${path}.chart_defaults.${key}`;
    const entry = record(value, p);
    if (!Object.keys(entry).every((name) => ["legend", "number_format", "tooltip"].includes(name))) return fail(p, "défauts connus");
    return [key, { ...(Object.hasOwn(entry, "legend") ? { legend: pick(entry.legend, LEGENDS, `${p}.legend`) } : {}), ...(Object.hasOwn(entry, "number_format") ? { number_format: pick(entry.number_format, NUMBER_FORMATS, `${p}.number_format`) } : {}), ...(Object.hasOwn(entry, "tooltip") ? { tooltip: pick(entry.tooltip, TOOLTIPS, `${p}.tooltip`) } : {}) }];
  }));
  const name = decodeName(found.name, `${path}.name`);
  const description = bounded(found.description, `${path}.description`, 0, 2000, true);
  const owner = decodePerson(found.owner, `${path}.owner`);
  if (/#\p{ASCII_Hex_Digit}{6}/u.test([name, description, owner.issuer, owner.subject].join("\n"))) return fail(path, "aucune couleur hexadécimale");
  const diverging = palette(found.diverging, `${path}.diverging`, 3, 7);
  if (diverging.length % 2 !== 1 || !["neutral.fg", "neutral.bg"].includes(diverging[Math.floor(diverging.length / 2)] as string)) return fail(`${path}.diverging`, "centre neutre et nombre impair de paliers");
  return { api_version: "board.theme/v1" as const, id: uuid(found.id, `${path}.id`), name, description, owner, base: pick(found.base, ["skifer-clair", "skifer-ardoise"] as const, `${path}.base`), roles: { marks: roleSet(roles.marks, ["series", "secondary", "selected", "threshold", "positive", "negative", "total"], `${path}.roles.marks`), text: roleSet(roles.text, ["text", "textStrong", "textMuted", "thresholdLabel"], `${path}.roles.text`) }, categorical: distinct(palette(found.categorical, `${path}.categorical`, 2, 8), `${path}.categorical`), sequential: palette(found.sequential, `${path}.sequential`, 3, 7), diverging, typography: { sans: pick(typography.sans, ["sans"] as const, `${path}.typography.sans`), mono: pick(typography.mono, ["mono"] as const, `${path}.typography.mono`), scale: pick(typography.scale, ["compact", "normal", "large"] as const, `${path}.typography.scale`) }, density: pick(found.density, ["compact", "normal", "airy"] as const, `${path}.density`), formats: { number: pick(formats.number, NUMBER_FORMATS, `${path}.formats.number`), date: pick(formats.date, ["short", "medium", "long", "iso"] as const, `${path}.formats.date`) }, chart_defaults: chartDefaults };
}
export type ThemeDocument = ReturnType<typeof decodeTheme>;
