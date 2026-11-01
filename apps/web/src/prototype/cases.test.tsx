import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { clickItem } from "../charts/testing";
import { SKIFER_ARDOISE, SKIFER_CLAIR } from "../charts/theme";
import { CombinedCase, HeatmapCase, KpiCase, SelectionCase, WaterfallCase } from "./cases";

describe("cas du prototype", () => {
  it.each([SKIFER_CLAIR, SKIFER_ARDOISE])("rend les graphiques avec le thème $label", (theme) => {
    render(
      <>
        <CombinedCase theme={theme} />
        <WaterfallCase theme={theme} />
        <HeatmapCase theme={theme} />
      </>,
    );
    expect(screen.getByRole("img", { name: /^Graphique combiné, Réalisé en barres/ })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /^Waterfall de CA net, de CA T2/ })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /^Carte de chaleur de CA net, 8 lignes sur 9 colonnes/ })).toBeInTheDocument();
    expect(screen.getAllByText(/Provenance : données de démonstration/)).toHaveLength(3);
    expect(within(screen.getByRole("list", { name: "Légende de l'échelle" })).getAllByRole("listitem")).toHaveLength(5);
  });

  it("donne les tableaux d'alternative", async () => {
    render(
      <>
        <CombinedCase theme={SKIFER_CLAIR} />
        <WaterfallCase theme={SKIFER_CLAIR} />
        <HeatmapCase theme={SKIFER_CLAIR} />
      </>,
    );
    for (const tab of screen.getAllByRole("tab", { name: "Tableau" })) {
      await userEvent.click(tab);
    }
    expect(within(screen.getByRole("region", { name: "Réalisé et budget par mois" })).getAllByRole("row")).toHaveLength(10);
    expect(within(screen.getByRole("region", { name: "Étapes du passage du CA T2 au CA T3" })).getAllByRole("row")).toHaveLength(8);
    expect(within(screen.getByRole("region", { name: "Valeurs de la carte de chaleur" })).getAllByRole("row")).toHaveLength(73);
  });

  it("affiche les KPI et la tuile refusée", () => {
    render(<KpiCase />);
    const kpis = screen.getByRole("region", { name: "Indicateurs" });
    expect(within(kpis).getAllByRole("group")).toHaveLength(3);
    expect(within(kpis).getByRole("group", { name: "Marge brute" })).toHaveTextContent("Accès refusé");
    expect(within(kpis).getByRole("group", { name: "CA net" })).toHaveTextContent(/€/);
    expect(within(kpis).getByRole("group", { name: "Clients actifs" })).toHaveTextContent(/contre août/);
  });

  it("filtre le détail par la sélection du graphique", async () => {
    render(<SelectionCase theme={SKIFER_CLAIR} />);
    const detail = screen.getByRole("region", { name: "Détail des régions" });
    const rows = () => within(within(detail).getByRole("region", { name: "Régions, CA net et commandes" })).getAllByRole("row");
    expect(rows()).toHaveLength(14);
    expect(detail).toHaveTextContent("Toutes les régions");
    const chart = screen.getByRole("img", { name: /^Histogramme de CA net par région/ });
    clickItem(chart, { name: "Occitanie", dataIndex: 2 });
    expect(await screen.findByRole("region", { name: "Sélection" })).toHaveTextContent("1 région sélectionnée");
    clickItem(chart, { name: "Bretagne", dataIndex: 7 });
    expect(rows()).toHaveLength(3);
    expect(detail).toHaveTextContent("Filtré par la sélection du graphique");
    expect(screen.getByRole("region", { name: "Sélection" })).toHaveTextContent("2 régions sélectionnées");
    expect(screen.getByRole("img", { name: /Sélection : Occitanie, Bretagne\.$/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tout désélectionner" }));
    expect(screen.queryByRole("region", { name: "Sélection" })).toBeNull();
    expect(rows()).toHaveLength(14);
  });
});
