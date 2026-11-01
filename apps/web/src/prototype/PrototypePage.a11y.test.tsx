import { describe, it } from "vitest";
import { THEMES } from "../charts/theme";
import { expectAccessible, renderThemed } from "../test/a11y";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PrototypePage } from "./PrototypePage";

describe.each(THEMES)("Accessibilité de PrototypePage · $label", (theme) => {
  it("aucune violation sur les cinq cas et la bascule de thème", async () => {
    const { container } = renderThemed(<PrototypePage />, theme);
    await userEvent.click(screen.getByRole("button", { name: theme.label }));
    await expectAccessible(container);
  });
});
