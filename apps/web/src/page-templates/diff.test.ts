import { describe, expect, it } from "vitest";
import real from "./diff-reel.json";
import { decodePageTemplateApproval, decodePageTemplateDiff } from "./diff";

const id = "00000000-0000-4000-8000-000000000001";
const uid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const section = "/layout/sections/0";
const row = `${section}/rows/0`;
const column = `${row}/columns/0`;
const node = `${column}/children/0`;
const filter = "/filters/0";
const slot = { id: uid(10), type: "slot", expected: "visual", label: "Ventes" };
const separator = { id: uid(11), type: "separator" };
const col = { id: uid(12), span: 12, children: [slot] };
const line = { id: uid(13), columns: [col] };
const sec = { id: uid(14), rows: [line] };
const fil = { id: uid(15), label: "Pays", dimension: "country", operator: "eq", default: "FR" };
const seg = { text: "Texte" };
const block = { type: "paragraph", content: [seg] };
const mk = (path: string, after: unknown, kind: "added" | "removed" | "modified" = "added", before: unknown = null) => ({ path, kind, node: null, id: null, before, after });
const diff = (changes: unknown[]) => decodePageTemplateDiff({ id, base: 1, other: 2, changes }, id, 1, 2);

describe("écarts structurels de modèle", () => {
  it("décode un écart réel du serveur entre slot et texte et entre filtres eq et in", () => {
    expect(decodePageTemplateDiff(real, real.id, 1, 2)).toEqual(real);
  });
  it("accepte la distinction numérique Python perdue au parsing JSON", () => {
    const payload: unknown = JSON.parse(`{"id":"${id}","base":1,"other":2,"changes":[{"path":"${column}/span","kind":"modified","node":null,"id":null,"before":1,"after":1.0}]}`);
    expect(decodePageTemplateDiff(payload, id, 1, 2).changes).toHaveLength(1);
  });
  it("lit les feuilles et les fragments à chaque niveau de l'arbre", () => {
    const changes = [
      mk("/name", "Autre", "modified", "Titre"), mk("/description", "B", "modified", "A"), mk("/owner/issuer", "b", "modified", "a"), mk("/defaults/legend", "auto"),
      mk(section, sec), mk(row, line), mk(column, col), mk(node, slot), mk(filter, fil), mk(`${node}/id`, uid(20), "modified", uid(10)),
      mk(`${section}/title`, "Titre"), mk(`${column}/span`, 6, "modified", 12), mk(`${node}/type`, "separator", "modified", "slot"), mk(`${node}/expected`, "kpi", "modified", "visual"), mk(`${node}/label`, "Ventes"),
      mk(`${node}/rows`, [line]), mk(`${node}/blocks`, [block]), mk(`${node}/blocks/0`, block), mk(`${node}/blocks/0/content`, [seg]), mk(`${node}/blocks/0/content/0`, seg),
      mk(`${node}/blocks/0/content/0/text`, "B", "modified", "A"), mk(`${node}/blocks/0/content/0/strong`, true), mk(`${node}/blocks/0/type`, "heading", "modified", "paragraph"), mk(`${node}/blocks/0/level`, 2), mk(`${node}/blocks/0/ordered`, true),
      mk(`${node}/blocks/0/items`, [[seg]]), mk(`${node}/blocks/0/items/0`, [seg]), mk(`${node}/blocks/0/items/0/0`, seg),
      mk(`${filter}/dimension`, "region", "modified", "country"), mk(`${filter}/operator`, "in", "modified", "eq"), mk(`${filter}/allowed`, ["FR", "DE"]), mk(`${filter}/default`, "FR"), mk(`${filter}/default`, ["FR"]), mk(`${filter}/default`, [3, 3]), mk(`${filter}/default/0`, "FR"), mk(`${filter}/default`, 1, "modified", 1), mk(`${filter}/allowed/0`, "FR"),
      mk(`${node}/label`, null, "removed", "Ventes"), mk(node, separator),
      mk(`${node}/rows/0/columns/0/children/0/rows/0/columns/0/children/0`, slot),
    ];
    expect(diff(changes).changes).toEqual(changes);
    expect(decodePageTemplateApproval({ id, state: "approved", approved_revision: 2, index_state: "indexed", diff: changes }, id).diff).toEqual(changes);
  });
  it("refuse champs, chemins, genres, types et bornes hors contrat", () => {
    const bad = [
      mk("name", "x"), mk("/unknown", "x"), mk("/theme", "x"), mk(`${filter}/targets`, [id]), mk(`${node}/sql`, "x"), mk(`${node}/reference`, {}), mk(`${node}/component`, {}), mk(`${node}/rows/0/columns/0/children/0/rows/0/columns/0/children/0/rows/0`, line), mk("/filters/-1", fil), mk("/filters/32", fil), mk("/filters/01", fil),
      mk("/name", "x"), mk(`${filter}/label`, "Pays"), mk(`${section}/rows`, [line]), mk(node, separator, "modified", slot), mk("/defaults", {}, "modified", { legend: "auto" }), mk(node, undefined), mk("/name", "x", "modified", "x"), { ...mk("/name", "x", "modified", "y"), node: "slot" }, { ...mk("/name", "x", "modified", "y"), id },
      { ...mk("/name", "x", "modified", "y"), kind: "moved" }, { ...mk("/name", "x", "modified", "y"), extra: true }, mk(`${node}/label`, "x", "added", "incorrect"), mk(`${node}/label`, "incorrect", "removed", "x"),
      mk(`${node}/rows/0/columns/0/children/0/rows/0/columns/0/children/0`, { id: uid(99), type: "container", rows: [] }), mk(node, { ...slot, sql: "SELECT 1" }), mk(node, { ...slot, type: "analysis" }), mk(filter, { ...fil, targets: [id] }), mk(column, { ...col, span: 13 }), mk(section, { ...sec, extra: true }),
      mk(`${node}/rows`, [line, line]), mk(`${node}/blocks/0/content`, []), mk(`${node}/blocks/0/items`, []), mk(`${node}/blocks/0`, { type: "paragraph", content: [] }), mk(`${node}/blocks/0/content/0`, { text: "" }), mk(`${node}/blocks/0/items/0`, []),
      mk(`${node}/expected`, "other"), mk(`${node}/type`, "analysis"), mk(`${node}/blocks/0/type`, "sql"), mk(`${node}/blocks/0/level`, 3), mk(`${column}/span`, 0), mk(`${node}/blocks/0/ordered`, "yes"), mk(`${node}/blocks/0/content/0/strong`, false),
      mk(`${filter}/allowed`, [null]), mk(`${filter}/default`, ["FR", "FR", "FR"]), mk(`${filter}/default`, null), mk(`${filter}/dimension`, "SELECT *"), mk(`${filter}/operator`, "gt"), mk(`${node}/id`, "bad"), mk(`${node}/label`, ""), mk(`${node}/blocks/0/content/0/text`, ""), mk("/defaults/legend", "bad"),
    ];
    for (const entry of bad) expect(() => diff([entry]), JSON.stringify(entry)).toThrow();
    expect(() => decodePageTemplateDiff({ id, base: 2, other: 2, changes: [] }, id, 1, 2)).toThrow();
    expect(() => decodePageTemplateApproval({ id, state: "draft", approved_revision: 1, index_state: "indexed", diff: null }, id)).toThrow();
    expect(decodePageTemplateApproval({ id, state: "approved", approved_revision: 1, index_state: "index_stale", diff: null }, id).diff).toBeNull();
  });
});

it("borne les types de slot et la profondeur", () => {
  const deep = `${node}/rows/0/columns/0/children/0/rows/0/columns/0/children/0`;
  expect(diff([mk(`${deep}/expected`, "kpi", "modified", "visual")]).changes).toHaveLength(1);
  expect(() => diff([mk(`${deep}/expected`, "analysis", "modified", "visual")])).toThrow();
  expect(() => diff([mk(`${deep}/rows/0/columns/0/children/0/expected`, "kpi", "modified", "visual")])).toThrow();
});
