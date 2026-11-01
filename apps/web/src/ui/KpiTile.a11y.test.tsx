import { describe, it } from "vitest";
import { THEMES } from "../charts/theme";
import { expectAccessible, renderThemed } from "../test/a11y";
import { KpiTile } from "./KpiTile";

describe.each(THEMES)("Accessibilité de KpiTile · $label", (theme) => {
  it("aucune violation : valeur et tendance", async () => {
    const { container } = renderThemed(<KpiTile state="value" label="CA net" value="3,4 M€" delta={{ text: "+3,1 %", tone: "positive", comparison: "contre août" }} trend="M2 30L118 2" />, theme);
    await expectAccessible(container);
  });
  it("aucune violation : refus", async () => {
    const { container } = renderThemed(<KpiTile state="denied" label="Marge brute" guidance="Contactez votre administrateur." />, theme);
    await expectAccessible(container);
  });
});
