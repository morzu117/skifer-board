import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App } from "./App";

describe("App", () => {
  it("affiche la coque et change d'environnement", async () => {
    render(<App />);
    expect(screen.getByRole("heading", { level: 1, name: "Prototype graphique" })).toBeInTheDocument();
    expect(screen.getByText("Identité non établie · données de démonstration")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "PROD" }));
    expect(screen.getByRole("button", { name: "PROD" })).toHaveAttribute("aria-pressed", "true");
  });
});
