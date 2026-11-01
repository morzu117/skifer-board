import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { selectionTotalRequest } from "../charts/selection";
import { SelectionBar } from "./SelectionBar";

describe("SelectionBar", () => {
  it("compte la sélection, dit l'indisponibilité du total et montre la demande", async () => {
    const selection = { source: "ca-region", dimension: "region", keys: ["IDF", "OCC"] };
    const onClear = vi.fn();
    render(<SelectionBar selection={selection} noun="régions" request={selectionTotalRequest(selection, "ca_net")} onClear={onClear} />);
    const bar = screen.getByRole("region", { name: "Sélection" });
    expect(bar).toHaveTextContent("2 régions sélectionnées");
    expect(bar).toHaveTextContent("Total de la sélection : non disponible");
    expect(bar).toHaveTextContent('"scope": "selection"');
    await userEvent.click(screen.getByRole("button", { name: "Tout désélectionner" }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("accorde au singulier", () => {
    const selection = { source: "s", dimension: "region", keys: ["IDF"] };
    render(<SelectionBar selection={selection} noun="région" request={selectionTotalRequest(selection, "ca_net")} onClear={vi.fn()} />);
    expect(screen.getByRole("region", { name: "Sélection" })).toHaveTextContent(/1 région sélectionnée(?!s)/);
  });
});
