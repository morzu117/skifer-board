import { expect, it } from "vitest";
import fixture from "../../../../contracts/themes/fixtures/valid/skifer_clair.json";
import { TOKEN_CATALOG } from "./catalog";
import { decodeTheme } from "./document";
import { defaultThemeDraft } from "./defaultDraft";
import { applyCommand, themeProblems } from "./edition";

it("reproduit le thème clair valide sans les champs réservés au serveur", () => {
  const expected = decodeTheme(fixture);
  const draft = defaultThemeDraft();
  expect({ ...draft, api_version: expected.api_version, id: expected.id, owner: expected.owner }).toEqual(expected);
  expect(themeProblems(draft, TOKEN_CATALOG)).toEqual([]);
});

it("ne partage pas les champs modifiables entre créations et signale le changement de base", () => {
  const first = defaultThemeDraft();
  first.roles.marks.series = "ink";
  expect(defaultThemeDraft().roles.marks.series).toBe("blue");
  const changed = applyCommand(defaultThemeDraft(), { type: "base", value: "skifer-ardoise" }, TOKEN_CATALOG);
  expect(changed.ok).toBe(true);
  expect(changed.document.roles.marks.series).toBe("blue");
  expect(themeProblems(changed.document, TOKEN_CATALOG)).not.toEqual([]);
});
