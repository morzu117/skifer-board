import { describe, it } from "vitest";
import { THEMES } from "../charts/theme";
import { expectAccessible, renderThemed } from "../test/a11y";
import { Card } from "./Card";

describe.each(THEMES)("Accessibilité de Card · $label", (theme) => {
  it("aucune violation : avec action", async () => {
    const { container } = renderThemed(<Card title="Résultat chargé" actions={<button type="button">Exporter</button>}><p>Données de démonstration</p></Card>, theme);
    await expectAccessible(container);
  });
});
