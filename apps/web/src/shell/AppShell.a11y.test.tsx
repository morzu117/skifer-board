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

it.each(THEMES)("coque avec identité et déconnexion accessible · $label", async (theme) => {
  const { container } = renderThemed(
    <AppShell workspace={null} available={new Set<SectionId>(["catalogue"])} active="catalogue"
      onNavigate={() => undefined} breadcrumb={["Catalogue Atlas"]} environment="DEV"
      onEnvironmentChange={() => undefined} identity={{ name: "Camille Martin", entity: null }} onLogout={() => undefined}>
      <h1>Catalogue Atlas</h1>
    </AppShell>, theme);
  await expectAccessible(container);
});
