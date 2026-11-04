import { describe, it } from "vitest";
import { THEMES } from "./theme";
import { expectAccessible, renderThemed } from "../test/a11y";
import { tableSpec } from "../test/chart-fixture";
import { DataTable } from "./DataTable";

describe.each(THEMES)("Accessibilité du tableau · $label", (theme) => {
  it("aucune violation avec une ligne sélectionnée", async () => {
    const { container } = renderThemed(<DataTable {...tableSpec} />, theme);
    await expectAccessible(container);
  });
});
