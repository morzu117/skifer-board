import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { BenchReport } from "./BenchReport";
import { PrototypePage } from "./PrototypePage";

describe("PrototypePage", () => {
  it("compose les cinq cas et change de thème sans changer les valeurs", async () => {
    const { container } = render(<PrototypePage />);
    expect(screen.getByRole("heading", { level: 1, name: "Prototype graphique" })).toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(4);
    expect(screen.getByRole("region", { name: "Indicateurs" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "page de mesure" })).toHaveAttribute("href", "bench.html");
    const descriptions = () => screen.getAllByRole("img").map((image) => image.getAttribute("aria-label"));
    const before = descriptions();
    const group = screen.getByRole("group", { name: "Thème" });
    expect(within(group).getByRole("button", { name: "Skifer clair" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(within(group).getByRole("button", { name: "Skifer ardoise" }));
    expect(within(group).getByRole("button", { name: "Skifer ardoise" })).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector(".sb-theme-skifer-ardoise")).not.toBeNull();
    expect(descriptions()).toEqual(before);
  });
});

describe("BenchReport", () => {
  it("affiche les résultats et le JSON brut", () => {
    render(
      <BenchReport
        environment="Chrome test"
        results={[
          { chart: "barres", points: 100, tiles: 1, renderer: "svg", totalMs: 12.34, perTileMs: 12.34, heapMb: null },
          { chart: "ligne", points: 100, tiles: 12, renderer: "canvas", totalMs: 24, perTileMs: 2, heapMb: 1.5 },
        ]}
      />,
    );
    const table = screen.getByRole("group", { name: "Temps de rendu et mémoire par configuration" });
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(table).toHaveTextContent("non mesurée");
    expect(table).toHaveTextContent("12,3");
    expect(document.getElementById("bench-results")?.textContent).toContain('"environment":"Chrome test"');
  });
});
