import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { KpiTile } from "./KpiTile";

describe("KpiTile", () => {
  it("affiche valeur, écart signé et tendance", () => {
    const { container } = render(<KpiTile state="value" label="CA net" value="7,2 M€" delta={{ text: "+3,1 %", tone: "positive", comparison: "contre T2" }} trend="M0 0L1 1" />);
    const tile = screen.getByRole("group", { name: "CA net" });
    expect(tile).toHaveTextContent("7,2 M€");
    expect(screen.getByText("+3,1 % contre T2")).toHaveClass("sb-kpi__delta--positive");
    expect(container.querySelector("path")).toHaveAttribute("d", "M0 0L1 1");
  });

  it("s'affiche sans écart ni tendance", () => {
    const { container } = render(<KpiTile state="value" label="Clients" value="3 920" />);
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector(".sb-kpi__delta")).toBeNull();
  });

  it("dit un refus et la conduite à tenir", () => {
    render(<KpiTile state="denied" label="Marge brute" guidance="Demandez l'accès." />);
    const tile = screen.getByRole("group", { name: "Marge brute" });
    expect(tile).toHaveTextContent("Accès refusé");
    expect(tile).toHaveTextContent("Demandez l'accès.");
    expect(tile).not.toHaveTextContent("%");
  });
});
