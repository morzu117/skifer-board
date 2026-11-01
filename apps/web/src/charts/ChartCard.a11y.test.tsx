import { describe, it } from "vitest";
import { THEMES } from "./theme";
import { expectAccessible, renderThemed } from "../test/a11y";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { formatAmount } from "../format/number";
import { categories, selectedKeys, tableSpec } from "../test/chart-fixture";
import { ChartCard } from "./ChartCard";
import { barsDescription, barsOption, categoryItems } from "./specs/bars";

const amount = (value: number) => formatAmount(value);
describe.each(THEMES)("Accessibilité de ChartCard · $label", (theme) => {
  it.each(["Graphique", "Tableau"])("aucune violation dans l'onglet %s", async (tab) => {
    const { container } = renderThemed(<ChartCard title="CA net par région"
      description={barsDescription("CA net", categories, selectedKeys, amount)}
      option={barsOption({ data: categories, selected: selectedKeys, format: amount }, theme)}
      table={{ ...tableSpec, caption: "Valeurs de l’histogramme" }} items={categoryItems(categories, amount)} source="ca-region" dimension="region"
      onSelect={() => undefined} exportBackground={theme.surface} />, theme);
    await userEvent.click(screen.getByRole("tab", { name: tab }));
    await expectAccessible(container);
  });

  // Défaut trouvé par ce test et corrigé : le conteneur du tableau était une région homonyme
  // de la carte quand titre et légende coïncidaient (axe landmark-unique).
  it("distingue les régions lorsque le titre et la légende du tableau coïncident", async () => {
    const { container } = renderThemed(<ChartCard title={tableSpec.caption}
      description={barsDescription("CA net", categories, selectedKeys, amount)}
      option={barsOption({ data: categories, selected: selectedKeys, format: amount }, theme)}
      table={tableSpec} items={categoryItems(categories, amount)} source="ca-region"
      exportBackground={theme.surface} />, theme);
    await userEvent.click(screen.getByRole("tab", { name: "Tableau" }));
    await expectAccessible(container);
  });
});
