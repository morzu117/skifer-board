import { describe, it } from "vitest";
import { THEMES } from "../charts/theme";
import { expectAccessible, renderThemed } from "../test/a11y";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { selectionTotalRequest } from "../charts/selection";
import { SelectionBar } from "./SelectionBar";

describe.each(THEMES)("Accessibilité de SelectionBar · $label", (theme) => {
  it.each([false, true])("aucune violation, demande ouverte : %s", async (open) => {
    const selection = { source: "ca-region", dimension: "region", keys: ["Occitanie", "Bretagne"] };
    const { container } = renderThemed(<SelectionBar selection={selection} noun="régions"
      request={selectionTotalRequest(selection, "ca_net")} onClear={() => undefined} />, theme);
    if (open) await userEvent.click(screen.getByText("Demande transmise au calcul contextuel"));
    await expectAccessible(container);
  });
});
