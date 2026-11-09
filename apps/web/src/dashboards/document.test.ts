import { describe, expect, it } from "vitest";
import schema from "../../../../contracts/dashboards/dashboard.v1.json";
import { ContractError } from "../catalogue/decode";
import { CHART_KINDS } from "../analyses/document";
import { loadYaml } from "../test/yaml";
import {
  API_VERSION, BLOCK_TYPES, COMMON_OPERATORS, EXECUTABLE_TYPES, HEADING_LEVELS, LEGENDS, LIMITS, NODE_TYPES, NUMBER_FORMATS, TOOLTIPS,
  decodeDashboard, decodeDashboardDraft, executables,
} from "./document";
import { DASHBOARD_RULES } from "./refusal";
import { changed, draftOf, EXPECTED_NAMES, expectation, explained, fixtures, ID } from "./testing";

const named = (name: string) => loadYaml(fixtures("valid").find((item) => item.name === name)?.text ?? "") as Record<string, unknown>;
const minimal = named("minimal");
const complete = named("complete-shared");
const refused = (value: unknown, label = ""): void => {
  expect(() => decodeDashboard(value), label).toThrow(ContractError);
};

/**
 * Fixtures invalides que le web ne peut pas juger, chacune avec sa raison. Le serveur les refuse parce que PyYAML lit
 * `2.0` ou `1.0` comme un flottant ; `JSON.parse` (ou le lecteur des fixtures) lit le même nombre comme l'entier `2` ou
 * `1` : rien dans le document reçu ne distingue les deux. Le serveur ne rend jamais un tel document.
 */
const UNJUDGEABLE: Readonly<Record<string, string>> = {
  "span-float": "span écrit 6.0 : un flottant pour le serveur, l'entier 6 pour le navigateur",
  "revision-float": "reference.revision écrit 1.0 : un flottant pour le serveur, l'entier 1 pour le navigateur",
  "heading-level-float": "heading.level écrit 2.0 : un flottant pour le serveur, l'entier 2 pour le navigateur",
  "filter-default-type-not-allowed": "default [1] et allowed [1.0, 2.0] : un entier hors d'une liste de flottants pour le serveur, deux fois le nombre 1 pour le navigateur",
};

/** Nœuds de test : des identifiants distincts, déterministes. */
let sequence = 0;
const fresh = (): string => `00000000-0000-4000-8000-${(sequence += 1).toString(16).padStart(12, "0")}`;
const separator = () => ({ id: fresh(), type: "separator" });
const words = (blocks: unknown[]) => ({ id: fresh(), type: "text", blocks });
const paragraph = (...texts: string[]) => ({ type: "paragraph", content: texts.map((text) => ({ text })) });
const analysis = (extra: Record<string, unknown> = {}) => ({ id: fresh(), type: "analysis", reference: { analysis_id: fresh(), revision: 1 }, presentation: {}, ...extra });
const kpi = () => ({ id: fresh(), type: "kpi", reference: { analysis_id: fresh(), revision: 1 }, presentation: {} });
const cell = (children: unknown[], span = 1) => ({ id: fresh(), span, children });
const line = (...columns: unknown[]) => ({ id: fresh(), columns });
const part = (...rows: unknown[]) => ({ id: fresh(), rows });
const container = (...rows: unknown[]) => ({ id: fresh(), type: "container", rows });
const sections = (...list: unknown[]) => ({ sections: list });
const document = (layout: unknown, filters: unknown[] = []) => ({ ...minimal, layout, filters });
const alone = (child: unknown) => document(sections(part(line(cell([child], 12)))));
const filterOf = (targets: string[], extra: Record<string, unknown> = {}) => ({ id: fresh(), label: "Région", dimension: "region", operator: "eq", targets, ...extra });
/** Un document dont l'unique visuel (`pinned`) est la cible du filtre `extra`. */
const filtered = (extra: Record<string, unknown>) => {
  const target = analysis();
  return document(sections(part(line(cell([target], 12)))), [filterOf([target.id], extra)]);
};

describe("corpus de fixtures de contracts/dashboards/", () => {
  it("accepte chaque fixture valide, sans rien perdre ni ajouter", () => {
    const valid = fixtures("valid");
    expect(valid.map((item) => item.name)).toEqual(["complete-shared", "minimal", "personal-text"]);
    for (const item of valid) {
      const loaded = loadYaml(item.text);
      expect(decodeDashboard(loaded), item.name).toEqual(loaded);
      expect(decodeDashboardDraft(draftOf(loaded as object)), item.name).toEqual(draftOf(loaded as object));
    }
  });

  it("garde le texte d'auteur tel quel, sans l'interpréter : ni HTML, ni lien, ni script", () => {
    const loaded = named("personal-text");
    const decoded = decodeDashboard(loaded);
    expect(JSON.stringify(decoded)).toContain("<script>");
    expect(JSON.stringify(decoded)).toContain("javascript:alert(1)");
    expect(decoded).toEqual(loaded);
  });

  it("lit la fixture équivalente comme le minimum, quel que soit l'ordre ou le style des clés", () => {
    const [equivalent] = fixtures("equivalent");
    expect(fixtures("equivalent")).toHaveLength(1);
    expect(equivalent?.name).toBe("minimal-reordered");
    expect(decodeDashboard(loadYaml(equivalent?.text ?? ""))).toEqual(decodeDashboard(minimal));
  });

  it("a un verdict du serveur pour chaque fixture invalide, et chaque verdict a sa fixture", () => {
    const invalid = fixtures("invalid");
    expect(invalid.length).toBeGreaterThanOrEqual(90);
    expect(EXPECTED_NAMES).toEqual(invalid.map((item) => item.name));
    for (const item of invalid) {
      const verdict = expectation(item.name);
      expect(verdict?.code, item.name).toBe("invalid_dashboard");
      expect(["structural", "semantic"], item.name).toContain(verdict?.layer);
      expect(verdict?.violations.length, item.name).toBeGreaterThan(0);
    }
  });

  it("refuse chaque fixture invalide par une erreur de contrat, sauf les quatre que le web ne peut pas juger", () => {
    const accepted: string[] = [];
    for (const item of fixtures("invalid")) {
      try {
        decodeDashboard(loadYaml(item.text));
        accepted.push(item.name);
      } catch (error) {
        expect(error, item.name).toBeInstanceOf(ContractError);
      }
    }
    expect(accepted).toEqual(Object.keys(UNJUDGEABLE).sort());
    for (const [name, reason] of Object.entries(UNJUDGEABLE)) {
      expect(reason.length, name).toBeGreaterThan(20);
      expect(expectation(name)?.violations[0]?.path, name).toMatch(/^\/(?:filters|layout)\//);
    }
  });

  it("refuse chaque fixture invalide pour la raison que le serveur donne, au même endroit", () => {
    for (const item of fixtures("invalid").filter((one) => !(one.name in UNJUDGEABLE))) {
      let message = "";
      try {
        decodeDashboard(loadYaml(item.text));
      } catch (error) {
        message = error instanceof ContractError ? error.message : String(error);
      }
      const violations = expectation(item.name)?.violations ?? [];
      expect(explained(message, violations), `${item.name} : « ${message} » pour ${JSON.stringify(violations)}`).toBeDefined();
    }
  });

  it("n'explique pas un refus par une autre règle ou un autre endroit", () => {
    const violations = [{ path: "/layout/sections/0/rows/0/columns/0/span", rule: "wrong_type" }];
    expect(explained("dashboard.layout.sections[0].rows[0].columns[0].span : entier attendu", violations)).toBeDefined();
    expect(explained("dashboard.layout.sections[0].rows[0] : largeurs de colonnes de somme au plus 12 attendu", violations)).toBeUndefined();
    expect(explained("dashboard.layout.sections[0].rows[1].columns[0].span : entier attendu", violations)).toBeUndefined();
    expect(explained("dashboard.name : entier attendu", violations)).toBeUndefined();
    expect(explained("pas un message de contrat", violations)).toBeUndefined();
    expect(explained("dashboard : champs name attendu", [{ path: "", rule: "missing_field" }])).toBeDefined();
  });

  it("refuse aussi les fixtures invalides une fois privées des champs que le serveur pose", () => {
    // Le corps d'une création n'a ni api_version, ni id, ni owner : les mêmes défauts y sont refusés.
    const accepted = fixtures("invalid").map((item) => item.name).filter((name) => {
      const loaded = loadYaml(fixtures("invalid").find((item) => item.name === name)?.text ?? "");
      if (typeof loaded !== "object" || loaded === null || Array.isArray(loaded)) return false;
      try {
        decodeDashboardDraft(draftOf(loaded));
        return true;
      } catch {
        return false;
      }
    });
    // Seuls les défauts de ces trois champs passent (avec les quatre fixtures que le web ne juge pas).
    expect(accepted.filter((name) => !(name in UNJUDGEABLE))).toEqual(["bad-api-version", "bad-id", "bad-id-uppercase", "owner-email", "owner-missing-subject"]);
  });

  it("garde les règles du schéma : mêmes énumérations, mêmes champs, mêmes bornes", () => {
    const defs = schema.$defs;
    expect(schema.properties.api_version.const).toBe(API_VERSION);
    expect(schema.properties.visibility.enum).toEqual(["personal", "shared"]);
    expect(defs.legend.enum).toEqual([...LEGENDS]);
    expect(defs.number_format.enum).toEqual([...NUMBER_FORMATS]);
    expect(defs.tooltip.enum).toEqual([...TOOLTIPS]);
    expect(defs.common_filter.properties.operator.enum).toEqual([...COMMON_OPERATORS]);
    expect(defs.node.properties.type.enum).toEqual([...NODE_TYPES]);
    expect(defs.block.properties.type.enum).toEqual([...BLOCK_TYPES]);
    expect(defs.heading_block.properties.level.enum).toEqual([...HEADING_LEVELS]);
    expect(defs.visual_presentation.properties.chart.enum).toEqual([...CHART_KINDS]);
    expect(Object.keys(defs.visual_presentation.properties).sort()).toEqual(["chart", "legend", "number_format", "threshold", "title", "tooltip"]);
    expect(Object.keys(defs.kpi_presentation.properties).sort()).toEqual(["number_format", "threshold", "title", "tooltip"]);
    expect(Object.keys(schema.properties).sort()).toEqual(Object.keys(complete).sort());
    expect(schema.required.sort()).toEqual(Object.keys(complete).sort());
    expect(EXECUTABLE_TYPES.every((type) => (NODE_TYPES as readonly string[]).includes(type))).toBe(true);
    expect(defs.analysis_component.required).toEqual(["id", "type", "reference", "presentation"]);
    expect(defs.kpi_component.required).toEqual(["id", "type", "reference", "presentation"]);
    for (const one of [schema, defs.person, defs.defaults, defs.visual_presentation, defs.kpi_presentation, defs.threshold, defs.common_filter, defs.layout, defs.section, defs.row, defs.column, defs.container, defs.reference,
      defs.analysis_component, defs.kpi_component, defs.separator_component, defs.text_component, defs.segment, defs.paragraph_block, defs.heading_block, defs.list_block]) {
      expect(one.additionalProperties).toBe(false);
    }
    expect([schema.properties.filters.maxItems, defs.layout.properties.sections.maxItems, defs.rows.maxItems, defs.row.properties.columns.maxItems, defs.column.properties.children.maxItems])
      .toEqual([LIMITS.filters, LIMITS.sections, LIMITS.rows, LIMITS.columns, LIMITS.children]);
    expect([defs.common_filter.properties.targets.maxItems, defs.common_filter.properties.allowed.maxItems, defs.text_component.properties.blocks.maxItems, defs.list_block.properties.items.maxItems])
      .toEqual([LIMITS.targets, LIMITS.values, LIMITS.blocks, LIMITS.items]);
    expect([defs.segments.maxItems, defs.segments.minItems]).toEqual([LIMITS.segments, 1]);
    expect([defs.column.properties.span.minimum, defs.column.properties.span.maximum]).toEqual([1, LIMITS.grid]);
    expect([defs.name.maxLength, defs.short_label.maxLength, defs.segment.properties.text.maxLength, defs.scalar.maxLength, schema.properties.description.maxLength])
      .toEqual([LIMITS.title, LIMITS.label, LIMITS.segment, LIMITS.string, 2000]);
    expect([defs.threshold.properties.value.minimum, defs.threshold.properties.value.maximum]).toEqual([-LIMITS.threshold, LIMITS.threshold]);
    expect(defs.reference.properties.revision.maximum).toBe(999_999_999);
  });
});

describe("document board.dashboard/v1", () => {
  it("refuse un champ en trop à chaque niveau, SQL, requête, environnement et thème compris", () => {
    const base = "layout.sections.1.rows.0.columns";
    for (const path of [
      "sql", "query", "environment", "secret", "data", "rows", "table", "theme", "owner.email", "defaults.chart", "filters.0.column", "layout.rows", `${base}.0.sql`, `${base}.0.style`, "layout.sections.0.title2",
      `${base}.0.children.0.query`, `${base}.0.children.0.sql`, `${base}.0.children.0.reference.token`, `${base}.1.children.0.presentation.option`, `${base}.1.children.0.presentation.color`,
      `${base}.1.children.0.presentation.threshold.color`, "layout.sections.0.rows.0.columns.0.children.0.blocks.0.content.0.href", "layout.sections.0.rows.0.columns.0.children.0.blocks.0.content.0.html",
      "layout.sections.0.rows.0.columns.0.children.0.blocks.0.content.0.style", "layout.sections.0.rows.0.columns.0.children.0.blocks.0.image",
    ]) {
      refused(changed(complete, path, "x"));
    }
    // Un séparateur ne porte rien d'autre que son identifiant et son type.
    refused(changed(complete, "layout.sections.1.rows.1.columns.0.children.0.rows.0.columns.1.children.0.label", "x"));
  });

  it("refuse un champ manquant ou un type inattendu à chaque niveau", () => {
    const first = "layout.sections.0.rows.0.columns.0";
    const tiles = "layout.sections.1.rows.0.columns";
    for (const path of [
      "api_version", "id", "owner", "name", "description", "visibility", "defaults", "filters", "layout", "owner.issuer", "owner.subject", "layout.sections", "layout.sections.0.id", "layout.sections.0.rows",
      "layout.sections.0.rows.0.id", "layout.sections.0.rows.0.columns", `${first}.id`, `${first}.span`, `${first}.children`, `${first}.children.0.id`, `${first}.children.0.type`, `${first}.children.0.blocks`,
      `${first}.children.0.blocks.0.type`, `${first}.children.0.blocks.0.level`, `${first}.children.0.blocks.0.content`, `${first}.children.0.blocks.1.content`, `${first}.children.0.blocks.2.ordered`, `${first}.children.0.blocks.2.items`,
      `${first}.children.0.blocks.1.content.0.text`, `${tiles}.0.children.0.reference`, `${tiles}.0.children.0.presentation`, `${tiles}.0.children.0.reference.analysis_id`, `${tiles}.0.children.0.reference.revision`,
      "filters.0.id", "filters.0.label", "filters.0.dimension", "filters.0.operator", "filters.0.targets",
    ]) {
      refused(changed(complete, path, undefined), path);
    }
    for (const [path, value] of [
      ["layout", []], ["layout", null], ["layout.sections", {}], ["layout.sections.0", 3], ["layout.sections.0.rows", {}], ["layout.sections.0.rows.0", null], ["layout.sections.0.rows.0.columns", "x"], [first, []],
      [`${first}.children`, {}], [`${first}.children.0`, "x"], [`${first}.children.0.blocks`, {}], [`${first}.children.0.blocks.0`, "x"], [`${first}.children.0.blocks.0.content`, "x"], [`${first}.children.0.blocks.0.content.0`, "x"],
      [`${first}.children.0.blocks.2.ordered`, "yes"], [`${first}.children.0.blocks.2.items`, {}], [`${first}.children.0.blocks.2.items.0`, "x"], [`${tiles}.0.children.0.reference`, []], [`${tiles}.0.children.0.presentation`, []],
      [`${tiles}.0.children.0.presentation.threshold`, 3], ["defaults", []], ["defaults", null], ["filters", {}], ["filters.0", 3], ["filters.0.targets", "x"], ["owner", "x"], ["name", 12], ["description", null], ["id", 1], ["filters.0.label", 1],
      ["filters.0.dimension", 1], [`${first}.id`, 7], [`${first}.span`, "6"],
    ] as const) {
      refused(changed(complete, path, value), path);
    }
    for (const value of [null, [], "x", 1]) refused(value);
  });

  it("refuse une version, une visibilité, un type, un graphique ou un format hors domaine", () => {
    const tile = "layout.sections.1.rows.0.columns";
    for (const [path, value] of [
      ["api_version", "board.dashboard/v2"], ["api_version", "board.analysis/v1"], ["visibility", "public"], ["defaults.legend", "left"], ["defaults.number_format", "money"], ["defaults.tooltip", "none"],
      ["filters.0.operator", "like"], ["filters.0.operator", "gt"], [`${tile}.1.children.0.presentation.chart`, "pie"], [`${tile}.1.children.0.presentation.legend`, "left"],
      [`${tile}.1.children.0.presentation.number_format`, "money"], [`${tile}.1.children.0.presentation.tooltip`, "none"], [`${tile}.0.children.0.presentation.number_format`, "money"],
      ["layout.sections.0.rows.0.columns.0.children.0.type", "html"], ["layout.sections.0.rows.0.columns.0.children.0.blocks.0.type", "image"], ["layout.sections.0.rows.0.columns.0.children.0.blocks.0.level", 3],
      ["layout.sections.0.rows.0.columns.0.children.0.blocks.0.level", "1"], ["layout.sections.0.rows.0.columns.0.children.0.blocks.0.level", true],
    ] as const) {
      refused(changed(complete, path, value));
    }
    // Un visuel peut préciser son graphique et sa légende : un KPI, ni l'un ni l'autre.
    refused(changed(complete, `${tile}.0.children.0.presentation.chart`, "value"));
    refused(changed(complete, `${tile}.0.children.0.presentation.legend`, "shown"));
    expect(decodeDashboard(changed(complete, `${tile}.1.children.0.presentation`, { chart: "grouped_bars", legend: "hidden" })).layout.sections[1]?.rows[0]?.columns[1]?.children[0]).toMatchObject({ presentation: { chart: "grouped_bars", legend: "hidden" } });
  });

  it("borne les textes comme le schéma, en caractères et non en octets", () => {
    const withName = (name: unknown) => changed(minimal, "name", name);
    expect(decodeDashboard(withName("a".repeat(120))).name).toHaveLength(120);
    expect(decodeDashboard(withName("😀".repeat(120))).name).toHaveLength(240);
    for (const name of ["", "a".repeat(121), "😀".repeat(121), "a\tb", "a\nb", "a\u0000b", "a\u007fb", "a\u0085b", "a b", "a b", "a\ud800b", 12]) refused(withName(name));
    const described = (description: unknown) => changed(minimal, "description", description);
    expect(decodeDashboard(described("a".repeat(2000))).description).toHaveLength(2000);
    expect(decodeDashboard(described("a\tb\nc\n")).description).toBe("a\tb\nc\n");
    for (const description of ["a".repeat(2001), "a\u0000b", "a\rb", "a\u001fb", "a\u009fb", "a b", "\udfff", 12, new Date("2026-01-01")]) refused(described(description));
    const subject = (value: unknown) => changed(minimal, "owner.subject", value);
    expect(decodeDashboard(subject("a".repeat(512))).owner.subject).toHaveLength(512);
    for (const value of ["", "a".repeat(513), "a\nb", "a\u0000b"]) refused(subject(value));
    // Les titres de section et de composant suivent `name`, les libellés de filtre et de seuil `short_label`.
    const titled = (title: unknown) => document(sections({ ...part(), title }));
    expect(decodeDashboard(titled("a".repeat(120))).layout.sections[0]?.title).toHaveLength(120);
    for (const title of ["", "a".repeat(121), "a\nb", 3]) refused(titled(title));
    const labelled = (label: unknown) => filtered({ label });
    expect(decodeDashboard(labelled("a".repeat(80))).filters[0]?.label).toHaveLength(80);
    for (const label of ["", "a".repeat(81), "a\nb", 3]) refused(labelled(label));
  });

  it("refuse les identifiants et dimensions hors format", () => {
    for (const value of ["not-a-uuid", ID.toUpperCase(), `${ID}\n`, "", 12, null]) {
      refused(changed(minimal, "id", value));
      refused(document(sections({ ...part(), id: value })));
    }
    const target = analysis();
    const withDimension = (dimension: unknown) => document(sections(part(line(cell([target], 12)))), [filterOf([target.id], { dimension })]);
    expect(decodeDashboard(withDimension("a".repeat(80))).filters[0]?.dimension).toHaveLength(80);
    for (const dimension of ["1region", "re gion", "a".repeat(81), "", "x;y", 1]) refused(withDimension(dimension));
    const withId = (reference: unknown) => alone({ ...analysis(), reference });
    for (const reference of [{ analysis_id: ID.toUpperCase(), revision: 1 }, { analysis_id: "x", revision: 1 }, { analysis_id: ID, revision: 1, extra: 1 }, { analysis_id: ID }, { revision: 1 }]) refused(withId(reference));
  });

  it("borne la révision épinglée : entier de 1 à 999 999 999", () => {
    const pinned = (revision: unknown) => alone({ ...analysis(), reference: { analysis_id: ID, revision } });
    for (const revision of [1, 999_999_999]) expect(decodeDashboard(pinned(revision))).toBeDefined();
    for (const revision of [0, -1, 1_000_000_000, 1.5, "1", null, true, 2 ** 53, Number.NaN, Number.POSITIVE_INFINITY]) refused(pinned(revision));
  });

  it("borne la largeur des colonnes et leur somme à la grille de 12", () => {
    const widths = (...spans: number[]) => document(sections(part(line(...spans.map((span) => cell([], span))))));
    for (const spans of [[12], [6, 6], [4, 4, 4], [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], [5, 7], [], [3]]) expect(decodeDashboard(widths(...spans))).toBeDefined();
    for (const spans of [[13], [0], [-1], [12, 1], [7, 6], [4, 4, 4, 1], [1.5], [6, 7]]) refused(widths(...spans));
    refused(document(sections(part(line(cell([], 6), cell([], Number.NaN))))));
    refused(document(sections(part(line(...Array.from({ length: 13 }, () => cell([], 1)))))));
  });

  it("garde un conteneur seul dans sa colonne et trois niveaux de rangées au plus", () => {
    const nested = (levels: number): unknown => {
      let inner: unknown = separator();
      for (let level = 0; level < levels; level += 1) inner = container(line(cell([inner], 12)));
      return document(sections(part(line(cell([inner], 12)))));
    };
    // Section, puis deux conteneurs : trois niveaux de rangées. Un troisième conteneur en ferait un quatrième.
    for (const levels of [0, 1, 2]) expect(decodeDashboard(nested(levels))).toBeDefined();
    refused(nested(3));
    refused(nested(4));
    const together = (...children: unknown[]) => document(sections(part(line(cell(children, 12)))));
    expect(decodeDashboard(together(container(line(cell([separator()], 12)))))).toBeDefined();
    expect(decodeDashboard(together(separator(), analysis()))).toBeDefined();
    refused(together(container(), separator()));
    refused(together(separator(), container()));
    refused(together(container(), container()));
  });

  it("borne chaque liste comme le schéma, au plus et à la limite", () => {
    const wide = <T>(count: number, make: () => T): T[] => Array.from({ length: count }, make);
    const spread = (count: number) => document(sections(...wide(count, () => part())));
    expect(decodeDashboard(spread(LIMITS.sections)).layout.sections).toHaveLength(20);
    refused(spread(LIMITS.sections + 1));
    const stacked = (count: number) => document(sections(part(...wide(count, () => line()))));
    expect(decodeDashboard(stacked(LIMITS.rows)).layout.sections[0]?.rows).toHaveLength(24);
    refused(stacked(LIMITS.rows + 1));
    const crowded = (count: number) => document(sections(part(line(cell(wide(count, separator), 12)))));
    expect(decodeDashboard(crowded(LIMITS.children)).layout.sections[0]?.rows[0]?.columns[0]?.children).toHaveLength(16);
    refused(crowded(LIMITS.children + 1));
    const filters = (count: number) => {
      const target = analysis();
      return document(sections(part(line(cell([target], 12)))), wide(count, () => filterOf([target.id])));
    };
    expect(decodeDashboard(filters(LIMITS.filters)).filters).toHaveLength(32);
    refused(filters(LIMITS.filters + 1));
    const aimed = (count: number) => {
      const targets = wide(count, analysis);
      return document(sections(part(line(cell(targets.slice(0, 16), 12)), line(cell(targets.slice(16, 32), 12)), line(cell(targets.slice(32), 12)))), [filterOf(targets.map((one) => one.id))]);
    };
    expect(decodeDashboard(aimed(LIMITS.targets)).filters[0]?.targets).toHaveLength(40);
    refused(aimed(LIMITS.targets + 1));
  });

  it("borne les éléments de mise en page, les composants et les composants exécutables", () => {
    const wide = <T>(count: number, make: () => T): T[] => Array.from({ length: count }, make);
    // 20 sections de 24 rangées sans colonne : 500 éléments ; les colonnes ajoutent le reste.
    const nodes = (total: number) => {
      let columns = total - 20 - 480;
      return document(sections(...wide(20, () => part(...wide(24, () => {
        const here = Math.min(columns, 12);
        columns -= here;
        return line(...wide(here, () => cell([])));
      })))));
    };
    expect(decodeDashboard(nodes(LIMITS.nodes))).toBeDefined();
    refused(nodes(LIMITS.nodes + 1));
    const pieces = (count: number) => {
      const all = wide(count, separator);
      return document(sections(...Array.from({ length: Math.ceil(count / 16) }, (_, at) => part(line(cell(all.slice(at * 16, (at + 1) * 16), 12))))));
    };
    expect(decodeDashboard(pieces(LIMITS.components))).toBeDefined();
    refused(pieces(LIMITS.components + 1));
    const spread = (all: unknown[]) => document(sections(...Array.from({ length: Math.ceil(all.length / 16) }, (_, at) => part(line(cell(all.slice(at * 16, (at + 1) * 16), 12))))));
    const tiles = (count: number, make: () => unknown) => spread(wide(count, make));
    expect(decodeDashboard(tiles(LIMITS.executable, analysis))).toBeDefined();
    expect(decodeDashboard(tiles(LIMITS.executable, kpi))).toBeDefined();
    refused(tiles(LIMITS.executable + 1, analysis));
    refused(tiles(LIMITS.executable + 1, kpi));
    // Les textes et séparateurs comptent parmi les 64 composants, non parmi les 40 composants exécutables.
    expect(decodeDashboard(spread([...wide(40, analysis), ...wide(12, separator), ...wide(12, () => words([]))])).layout.sections).toHaveLength(4);
    refused(spread([...wide(40, analysis), ...wide(25, separator)]));
  });

  it("garde chaque identifiant unique dans tout le document, filtres compris", () => {
    const shared = fresh();
    refused(document(sections({ ...part(), id: shared }, { ...part(), id: shared })));
    refused(document(sections({ ...part(line({ ...cell([]), id: shared })), id: shared })));
    refused(document(sections(part(line(cell([{ ...separator(), id: shared }, { ...separator(), id: shared }], 12))))));
    refused(document(sections(part(line(cell([{ ...analysis(), id: shared }, { ...kpi(), id: shared }], 12))))));
    const target = analysis();
    refused(document(sections({ ...part(line(cell([target], 12))), id: shared }), [{ ...filterOf([target.id]), id: shared }]));
    refused(document(sections(part(line(cell([target], 12)))), [filterOf([target.id]), { ...filterOf([target.id]), id: target.id }]));
    // Deux visuels peuvent épingler la même analyse : seul l'identifiant du composant est unique.
    expect(decodeDashboard(document(sections(part(line(cell([{ ...analysis(), reference: { analysis_id: ID, revision: 1 } }, { ...analysis(), reference: { analysis_id: ID, revision: 1 } }], 12)))))).layout.sections).toHaveLength(1);
  });

  it("garde chaque cible d'un filtre : au moins une, distinctes, existantes et exécutables", () => {
    const board = analysis();
    const figure = kpi();
    const note = words([paragraph("x")]);
    const base = (...filters: unknown[]) => document(sections(part(line(cell([board, figure, note, separator()], 12)))), filters);
    expect(decodeDashboard(base(filterOf([board.id, figure.id]))).filters[0]?.targets).toEqual([board.id, figure.id]);
    for (const targets of [[], [note.id], [fresh()], [board.id, board.id], [board.id, "x"], [1], [board.id, ID.toUpperCase()], "x"]) refused(base(filterOf(targets as string[])));
    // Une section, une colonne, une rangée, un autre filtre ou un séparateur ne sont pas des tuiles.
    const column0 = cell([board], 12);
    const row0 = line(column0);
    const part0 = part(row0);
    const other = filterOf([board.id]);
    for (const aimed of [part0.id, row0.id, column0.id, other.id]) refused(document(sections(part0), [other, filterOf([aimed])]));
    const bar = separator();
    refused(document(sections(part(line(cell([board, bar], 12)))), [filterOf([bar.id])]));
    // Un filtre ne cible pas ce qui est déclaré après lui : les filtres se jugent après toute la mise en page.
    expect(decodeDashboard(document(sections(part(line(cell([board], 12)))), [filterOf([board.id])])).filters).toHaveLength(1);
  });

  it("applique les règles de valeurs de filtres de la soumission", () => {
    const decoded = (extra: Record<string, unknown>) => decodeDashboard(filtered(extra)).filters[0];
    // eq : un scalaire.
    for (const value of ["Nord", 1, 0, -2.5, true, false, "a".repeat(1024)]) expect(decoded({ default: value })?.default).toBe(value);
    for (const value of [["Nord"], null, {}, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, "a".repeat(1025), "x; DROP TABLE t", "a\nb", "--", "/*", "'", "\\"]) refused(filtered({ default: value }));
    // in : une liste homogène, sans doublon.
    expect(decoded({ operator: "in", default: ["Nord", "Sud"] })?.default).toEqual(["Nord", "Sud"]);
    expect(decoded({ operator: "in", default: [true, false] })?.default).toEqual([true, false]);
    expect(decoded({ operator: "in", default: [1, 2.5] })?.default).toEqual([1, 2.5]);
    expect(decoded({ operator: "in", default: Array.from({ length: 100 }, (_, index) => index) })?.default).toHaveLength(100);
    for (const value of ["Nord", [], ["a", "a"], ["a", 1], [1, true], [[1]], Array.from({ length: 101 }, (_, index) => index), null, {}, [null], [{}]]) refused(filtered({ operator: "in", default: value }));
    // between : deux bornes de même type, ordonnées quand ce sont des nombres.
    expect(decoded({ operator: "between", default: [1, 5] })?.default).toEqual([1, 5]);
    expect(decoded({ operator: "between", default: [5, 5] })?.default).toEqual([5, 5]);
    expect(decoded({ operator: "between", default: ["b", "a"] })?.default).toEqual(["b", "a"]);
    expect(decoded({ operator: "between", default: [true, false] })?.default).toEqual([true, false]);
    for (const value of [[5, 1], [1], [1, 2, 3], ["a", 1], [1, "a"], [true, 1], "a", 1, [], null]) refused(filtered({ operator: "between", default: value }));
    // allowed : une liste de 1 à 100 scalaires homogènes et distincts, quel que soit l'opérateur.
    for (const operator of ["eq", "in", "between"]) expect(decoded({ operator, allowed: ["Nord", "Sud"] })?.allowed).toEqual(["Nord", "Sud"]);
    for (const value of [[], "Nord", ["a", "a"], ["a", 1], Array.from({ length: 101 }, (_, index) => index), null, [null], ["x; DROP"], [["a"]]]) refused(filtered({ allowed: value }));
    expect(decoded({ allowed: Array.from({ length: 100 }, (_, index) => index) })?.allowed).toHaveLength(100);
  });

  it("refuse un défaut hors des valeurs autorisées, seulement quand les deux existent", () => {
    const decoded = (extra: Record<string, unknown>) => decodeDashboard(filtered(extra)).filters[0];
    expect(decoded({ default: "Nord", allowed: ["Nord", "Sud"] })?.default).toBe("Nord");
    expect(decoded({ operator: "in", default: ["Sud", "Nord"], allowed: ["Nord", "Sud", "Est"] })?.default).toEqual(["Sud", "Nord"]);
    expect(decoded({ operator: "between", default: [1, 5], allowed: [5, 1] })?.default).toEqual([1, 5]);
    expect(decoded({ default: "Est" })?.allowed).toBeUndefined();
    expect(decoded({ allowed: ["Est"] })?.default).toBeUndefined();
    refused(filtered({ default: "Est", allowed: ["Nord", "Sud"] }));
    refused(filtered({ operator: "in", default: ["Nord", "Est"], allowed: ["Nord", "Sud"] }));
    refused(filtered({ operator: "between", default: [1, 5], allowed: [1] }));
    // Le type compte : la chaîne « 1 » n'est pas le nombre 1.
    refused(filtered({ default: 1, allowed: ["1"] }));
  });

  it("borne le seuil, le texte et ses blocs", () => {
    const threshold = (value: unknown, label: unknown = "Objectif") => alone({ ...analysis(), presentation: { threshold: { value, label } } });
    for (const value of [0, -1, 1e15, -1e15, 12.5, 999_999_999_999_999]) expect(decodeDashboard(threshold(value))).toBeDefined();
    for (const value of [1e15 + 1, -1e15 - 1, 1e16, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "12", true, null]) refused(threshold(value));
    expect(decodeDashboard(threshold(1, "a".repeat(80)))).toBeDefined();
    for (const label of ["", "a".repeat(81), "a\nb", 1, null]) refused(threshold(1, label));
    // Un KPI a les mêmes seuils, formats et infobulles.
    expect(decodeDashboard(alone({ ...kpi(), presentation: { title: "Total", number_format: "percent", threshold: { value: 3, label: "Cible" }, tooltip: "value" } })).layout.sections).toHaveLength(1);

    const block = (...blocks: unknown[]) => alone(words(blocks));
    for (const level of HEADING_LEVELS) expect(decodeDashboard(block({ type: "heading", level, content: [{ text: "T" }] }))).toBeDefined();
    for (const level of [0, 3, "1", true, null, 1.5, undefined]) refused(block({ type: "heading", level, content: [{ text: "T" }] }));
    refused(block({ type: "heading", content: [{ text: "T" }] }));
    expect(decodeDashboard(block({ type: "paragraph", content: [{ text: "a", emphasis: true, strong: true }] }))).toBeDefined();
    for (const mark of [false, 1, "true", null]) {
      refused(block({ type: "paragraph", content: [{ text: "a", emphasis: mark }] }));
      refused(block({ type: "paragraph", content: [{ text: "a", strong: mark }] }));
    }
    for (const content of [[], Array.from({ length: 21 }, () => ({ text: "a" })), [{ text: "" }], [{ text: "a\nb" }], [{ text: "a b" }], [{ text: 1 }], [{}], "a"]) refused(block({ type: "paragraph", content }));
    expect(decodeDashboard(block({ type: "paragraph", content: Array.from({ length: 20 }, () => ({ text: "a" })) }))).toBeDefined();
    expect(decodeDashboard(block({ type: "paragraph", content: [{ text: "😀".repeat(1000) }] }))).toBeDefined();
    refused(block({ type: "paragraph", content: [{ text: "😀".repeat(1001) }] }));
    expect(decodeDashboard(block({ type: "list", ordered: false, items: Array.from({ length: 30 }, () => [{ text: "a" }]) }))).toBeDefined();
    for (const entries of [[], Array.from({ length: 31 }, () => [{ text: "a" }]), [[]], [{ text: "a" }], "a"]) refused(block({ type: "list", ordered: true, items: entries }));
    expect(decodeDashboard(block(...Array.from({ length: 30 }, () => paragraph("a")))).layout.sections).toHaveLength(1);
    refused(block(...Array.from({ length: 31 }, () => paragraph("a"))));
    for (const type of ["image", "html", "link", "table", "code", 3, undefined]) refused(block({ type, content: [{ text: "a" }] }));
    refused(block({ type: "paragraph", content: [{ text: "a" }], level: 1 }));
    refused(block({ type: "list", ordered: false, items: [[{ text: "a" }]], content: [{ text: "a" }] }));
    refused(block({ content: [{ text: "a" }] }));
    refused(block("paragraph"));
    // Le texte de tout un composant compte ses caractères (points de code), listes comprises, au plus 5 000.
    const long = (...counts: number[]) => block(...counts.map((size) => paragraph("😀".repeat(size))));
    expect(decodeDashboard(long(1000, 1000, 1000, 1000, 1000))).toBeDefined();
    refused(long(1000, 1000, 1000, 1000, 1001));
    expect(decodeDashboard(block({ type: "list", ordered: true, items: [[{ text: "a".repeat(1000) }, { text: "b".repeat(1000) }], [{ text: "c".repeat(1000) }]] }, paragraph("d".repeat(1000), "e".repeat(1000))))).toBeDefined();
    refused(block({ type: "list", ordered: true, items: [[{ text: "a".repeat(1000) }, { text: "b".repeat(1000) }], [{ text: "c".repeat(1000) }]] }, paragraph("d".repeat(1000), "e".repeat(1000), "f")));
  });

  it("refuse ce que JSON ne sait pas écrire : fonction, date, table, symbole, grand entier", () => {
    for (const value of [() => 1, new Date("2026-01-01"), new Map(), Symbol("x"), 1n]) {
      refused(changed(minimal, "name", value));
      refused(changed(minimal, "defaults", { legend: value }));
    }
  });

  it("n'accepte que les présentations sémantiques : jamais de couleur, de thème ni d'option de rendu", () => {
    const tile = (presentation: unknown) => alone({ ...analysis(), presentation });
    for (const [key, value] of [["color", "#fff"], ["colors", ["#fff"]], ["palette", "x"], ["theme", "dark"], ["option", {}], ["renderer", "svg"], ["style", "x"], ["css", "x"], ["width", 3], ["height", 3], ["sql", "SELECT 1"], ["query", {}], ["href", "x"]] as const) {
      refused(tile({ [key]: value }));
      refused(alone({ ...kpi(), presentation: { [key]: value } }));
      refused(changed(minimal, "defaults", { [key]: value }));
    }
    expect(decodeDashboard(tile({ chart: "bars", title: "T", legend: "shown", number_format: "decimal_2", tooltip: "value_and_definition", threshold: { value: 1, label: "L" } })).layout.sections).toHaveLength(1);
  });

  it("lit une création sans api_version, id ni owner, et les refuse dans une création", () => {
    const loaded = draftOf(complete);
    expect(decodeDashboardDraft(loaded)).toEqual(loaded);
    for (const key of ["api_version", "id", "owner"]) refused(complete[key] === undefined ? complete : changed(complete, key, undefined));
    for (const [key, value] of [["api_version", API_VERSION], ["id", ID], ["owner", { issuer: "a", subject: "b" }]] as const) {
      expect(() => decodeDashboardDraft({ ...loaded, [key]: value })).toThrow(ContractError);
    }
    expect(() => decodeDashboardDraft({ ...loaded, name: undefined })).toThrow(ContractError);
    expect(() => decodeDashboardDraft(null)).toThrow(ContractError);
    expect(() => decodeDashboardDraft(loaded, "corps")).not.toThrow();
    expect(() => decodeDashboardDraft({ ...loaded, name: "" }, "corps")).toThrow("corps.name");
  });

  it("rend les composants exécutables dans l'ordre du document, conteneurs compris", () => {
    const decoded = decodeDashboard(complete);
    const found = executables(decoded);
    expect(found.map((one) => one.type)).toEqual(["kpi", "analysis", "analysis"]);
    expect(found.slice(0, 2).map((one) => one.id)).toEqual(["479436b2-bd0c-5a70-bfe6-b53ef16a48cd", "4e88603b-fa91-58af-94ec-79c910f51716"]);
    expect(executables(decodeDashboard(minimal))).toEqual([]);
    const [first, second, third] = [analysis(), kpi(), analysis()];
    const ordered = decodeDashboard(document(sections(part(line(cell([container(line(cell([first], 12)))], 6), cell([second], 6)), line(cell([separator(), third], 12))))));
    expect(executables(ordered).map((one) => one.id)).toEqual([first.id, second.id, third.id]);
  });

  it("a une liste fermée de règles que le web ne juge pas, avec sa raison", () => {
    // Le serveur seul connaît les analyses épinglées, le catalogue et les flottants écrits en YAML : le web ne les juge
    // pas, il affiche ce que le serveur répond (`invalid_dashboard` et ses violations).
    const SERVER_ONLY: Readonly<Record<string, string>> = {
      analysis_unavailable: "l'analyse épinglée doit exister, être lisible et à cette révision : le web ne lit pas le dépôt",
      kpi_requires_value: "un KPI porte une valeur unique : cela dépend de la requête de l'analyse, que le document ne contient pas",
      chart_incompatible: "le graphique doit convenir à la requête de l'analyse",
      dimension_not_exposed: "la dimension d'un filtre doit être exposée par le modèle de l'analyse ciblée : cela demande le catalogue",
      operator_not_allowed: "l'opérateur d'un filtre dépend du type de la dimension : cela demande le catalogue",
      filter_type_mismatch: "le type des valeurs d'un filtre est celui de la dimension : cela demande le catalogue",
      filter_value_incompatible: "la valeur d'un filtre doit convenir à la dimension de chaque tuile ciblée",
      too_many_filters: "la borne de filtres par tuile compte aussi les filtres de l'analyse épinglée",
    };
    for (const [rule, reason] of Object.entries(SERVER_ONLY)) {
      expect(DASHBOARD_RULES, rule).toContain(rule);
      expect(reason.length, rule).toBeGreaterThan(20);
    }
    // Ce que le web juge sans catalogue est refusé par le décodeur : aucune de ces règles n'est « serveur seul ».
    for (const rule of ["duplicate_id", "row_overflow", "too_deep", "container_not_alone", "filter_without_target", "unknown_target", "target_not_executable", "default_not_allowed"]) expect(SERVER_ONLY[rule], rule).toBeUndefined();
    expect(Object.keys(UNJUDGEABLE)).toEqual(["span-float", "revision-float", "heading-level-float", "filter-default-type-not-allowed"]);
  });
});

describe("priorité de la forme des valeurs de filtre", () => {
  it("refuse un default en liste pour eq avant de juger les cibles vides", () => {
    const value = document(sections(), [filterOf([], { default: ["FR"] })]);
    expect(() => decodeDashboard(value)).toThrow("dashboard.filters[0].default : texte, nombre ou booléen attendu");
  });
  it("refuse allowed vide avant de juger les cibles vides", () => {
    const value = document(sections(), [filterOf([], { allowed: [] })]);
    expect(() => decodeDashboard(value)).toThrow("dashboard.filters[0].allowed : liste de 1 à 100 éléments attendu");
  });
});
