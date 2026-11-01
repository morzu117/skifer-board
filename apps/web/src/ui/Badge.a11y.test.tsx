import { describe, it } from "vitest";
import { THEMES } from "../charts/theme";
import { expectAccessible, renderThemed } from "../test/a11y";
import { Badge } from "./Badge";

describe.each(THEMES)("Accessibilité de Badge · $label", (theme) => {
  it("aucune violation : succès", async () => {
    const { container } = renderThemed(<Badge tone="success">Certifié</Badge>, theme);
    await expectAccessible(container);
  });
  it("aucune violation : attention", async () => {
    const { container } = renderThemed(<Badge tone="warning">Tronqué</Badge>, theme);
    await expectAccessible(container);
  });
  it("aucune violation : refus", async () => {
    const { container } = renderThemed(<Badge tone="danger">Accès refusé</Badge>, theme);
    await expectAccessible(container);
  });
  it("aucune violation : neutre", async () => {
    const { container } = renderThemed(<Badge tone="neutral">Démonstration</Badge>, theme);
    await expectAccessible(container);
  });
});
