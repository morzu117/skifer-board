import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DataTable } from "./DataTable";

describe("DataTable", () => {
  it("formate, aligne les nombres et signale la sélection autrement que par la couleur", () => {
    render(
      <DataTable
        caption="Détail des régions"
        rowKey="region"
        selectedKeys={["IDF"]}
        columns={[
          { key: "region", label: "Région" },
          { key: "orders", label: "Commandes", numeric: true },
          { key: "share", label: "Part", numeric: true, format: (value) => `${String(value)} %` },
        ]}
        rows={[
          { region: "IDF", orders: 3920, share: 12 },
          { region: "OCC", orders: null, share: 3 },
        ]}
      />,
    );
    const region = screen.getByRole("group", { name: "Détail des régions" });
    expect(region).toHaveAttribute("tabindex", "0");
    const [, first, second] = within(region).getAllByRole("row");
    expect(first).toHaveClass("sb-row--selected");
    expect(first).toHaveTextContent("IDF (sélectionnée)");
    expect(within(first as HTMLElement).getAllByRole("cell")[1]).toHaveClass("sb-num");
    expect(second).not.toHaveClass("sb-row--selected");
    expect(second).toHaveTextContent("OCC—3 %");
    expect(within(region).getByRole("columnheader", { name: "Commandes" })).toHaveClass("sb-num");
  });

  it("affiche une cellule absente de la ligne comme une valeur absente", () => {
    render(<DataTable caption="t" rowKey="k" columns={[{ key: "k", label: "K" }, { key: "v", label: "V" }]} rows={[{ k: "a" }]} />);
    expect(screen.getByRole("row", { name: "a —" })).toBeInTheDocument();
  });
});

it("nomme les cases avec les dimensions formatées et conserve le repli", () => {
  const { rerender } = render(<DataTable caption="t" rowKey="id" columns={[{ key: "jour", label: "Jour", format: (value) => `date ${String(value)}` }, { key: "region", label: "Région" }]} rows={[{ id: "1", jour: "2024-01-01", region: "Nord" }]} selectionDimensions={["jour", "region", "absente"]} onToggleRow={() => undefined} />);
  expect(screen.getByRole("checkbox", { name: "Sélectionner la ligne 1 : Jour : date 2024-01-01, Région : Nord" })).toBeInTheDocument();
  rerender(<DataTable caption="t" rowKey="id" columns={[{ key: "region", label: "Région" }]} rows={[{ id: "1" }]} selectionDimensions={["region"]} onToggleRow={() => undefined} />);
  expect(screen.getByRole("checkbox", { name: "Sélectionner la ligne 1 : Région : —" })).toBeInTheDocument();
  rerender(<DataTable caption="t" rowKey="id" columns={[]} rows={[{ id: "1" }]} onToggleRow={() => undefined} />);
  expect(screen.getByRole("checkbox", { name: "Sélectionner la ligne 1" })).toBeInTheDocument();
});
