import { describe, it } from "vitest";

import liste from "../../../../contracts/espaces/liste.json";
import locale from "../../../../contracts/espaces/liste-locale.json";
import { THEMES } from "../charts/theme";
import { decodeSpaceList, type Space } from "../spaces/model";
import { expectAccessible, renderThemed } from "../test/a11y";
import { SpaceSwitch } from "./SpaceSwitch";

const { spaces } = decodeSpaceList(liste.body);
const finance = spaces[0] as Space;
const local = decodeSpaceList(locale.body).spaces[0] as Space;

describe.each(THEMES)("Accessibilité du sélecteur d'espace · $label", (theme) => {
  it.each([
    ["non lus", null, null],
    ["aucun", [], null],
    ["hors espace", spaces, null],
    ["espace courant", spaces, finance],
    ["rôle nul", spaces, { ...finance, role: null }],
    ["courant hors liste", spaces, { ...finance, id: "achats", name: "Achats" }],
    // Plan 09, 9.3 : ligne « Déploiement : DEV » (finance) et « DEV, TEST, PROD » (mode local).
    ["mode local, tout déployable", [local], local],
  ] as [string, readonly Space[] | null, Space | null][])("aucune violation axe : %s", async (_etat, listed, current) => {
    const { container } = renderThemed(<SpaceSwitch spaces={listed} current={current} onChange={() => undefined} />, theme);
    await expectAccessible(container);
  });
});
