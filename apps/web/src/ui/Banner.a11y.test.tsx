import { describe, it } from "vitest";
import { THEMES } from "../charts/theme";
import { expectAccessible, renderThemed } from "../test/a11y";
import { Banner } from "./Banner";

describe.each(THEMES)("Accessibilité de Banner · $label", (theme) => {
  it("aucune violation : warning", async () => {
    const { container } = renderThemed(<Banner tone="warning" action={<button type="button">Demander au moteur</button>}>Calcul indisponible</Banner>, theme);
    await expectAccessible(container);
  });
  it("aucune violation : danger", async () => {
    const { container } = renderThemed(<Banner tone="danger" action={<button type="button">Demander au moteur</button>}>Calcul indisponible</Banner>, theme);
    await expectAccessible(container);
  });
  it("aucune violation : neutral", async () => {
    const { container } = renderThemed(<Banner tone="neutral" action={<button type="button">Demander au moteur</button>}>Calcul indisponible</Banner>, theme);
    await expectAccessible(container);
  });
});
