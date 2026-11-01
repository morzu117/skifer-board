import { describe, it } from "vitest";
import { THEMES } from "../charts/theme";
import { expectAccessible, renderThemed } from "../test/a11y";
import { AppShell } from "./AppShell";
import type { SectionId } from "./sections";

describe.each(THEMES)("Accessibilité de la coque · $label", (theme) => {
  it.each(["DEV", "TEST", "PROD"] as const)("aucune violation en %s, navigation et identité comprises", async (environment) => {
    const { container } = renderThemed(
      <AppShell workspace="Finance" available={new Set<SectionId>(["explorer"])} active="explorer"
        onNavigate={() => undefined} breadcrumb={["Finance", "Prototype"]} environment={environment}
        onEnvironmentChange={() => undefined} identity={null}>
        <h1>Prototype graphique</h1>
      </AppShell>, theme);
    await expectAccessible(container);
  });
});
