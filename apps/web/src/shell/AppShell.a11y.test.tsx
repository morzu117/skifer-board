import { describe, it } from "vitest";
import { THEMES } from "../charts/theme";
import { expectAccessible, renderThemed } from "../test/a11y";
import { AppShell } from "./AppShell";
import { SpaceSwitch } from "./SpaceSwitch";
import { decodeSpaceList } from "../spaces/model";
import liste from "../../../../contracts/espaces/liste.json";

const { spaces } = decodeSpaceList(liste.body);
import type { SectionId } from "./sections";

describe.each(THEMES)("Accessibilité de la coque · $label", (theme) => {
  it.each(["DEV", "TEST", "PROD"] as const)("aucune violation en %s, navigation et identité comprises", async (environment) => {
    const { container } = renderThemed(
      <AppShell workspace="Finance" available={new Set<SectionId>(["explorer"])} active="explorer"
        onNavigate={() => undefined} breadcrumb={["Finance", "Prototype"]} spaceSwitch={<SpaceSwitch spaces={spaces} current={spaces[0] ?? null} onChange={() => undefined} />} environment={environment}
        onEnvironmentChange={() => undefined} identity={null}>
        <h1>Prototype graphique</h1>
      </AppShell>, theme);
    await expectAccessible(container);
  });
});

it.each(THEMES)("coque avec identité et déconnexion accessible · $label", async (theme) => {
  const { container } = renderThemed(
    <AppShell workspace={null} available={new Set<SectionId>(["catalogue"])} active="catalogue"
      onNavigate={() => undefined} breadcrumb={["Catalogue Atlas"]} spaceSwitch={<SpaceSwitch spaces={null} current={null} onChange={() => undefined} />} environment="DEV"
      onEnvironmentChange={() => undefined} identity={{ name: "Camille Martin", entity: null }} onLogout={() => undefined}>
      <h1>Catalogue Atlas</h1>
    </AppShell>, theme);
  await expectAccessible(container);
});

// Plan 09, 9.3 : bascule marquée du droit de déployer et ligne « Déploiement » sous le rôle.
describe.each(THEMES)("Accessibilité de la coque avec droit de déployer · $label", (theme) => {
  it.each([
    ["DEV choisi, DEV marqué", "DEV", ["DEV"]],
    ["TEST choisi, DEV marqué", "TEST", ["DEV"]],
    ["PROD choisi, tout marqué", "PROD", ["DEV", "TEST", "PROD"]],
    ["DEV choisi, aucune marque dans l'espace", "DEV", []],
  ] as [string, "DEV" | "TEST" | "PROD", ("DEV" | "TEST" | "PROD")[]][])("aucune violation axe : %s", async (_cas, environment, droits) => {
    const { container } = renderThemed(
      <AppShell workspace="skifer-atlas" available={new Set<SectionId>(["catalogue"])} active="catalogue"
        onNavigate={() => undefined} breadcrumb={["Finance", "Catalogue Atlas"]} spaceSwitch={<SpaceSwitch spaces={spaces} current={spaces[0] ?? null} onChange={() => undefined} />} environment={environment}
        onEnvironmentChange={() => undefined} deploy={new Set(droits)} identity={{ name: "Camille Martin", entity: null }} onLogout={() => undefined}>
        <h1>Catalogue Atlas</h1>
      </AppShell>, theme);
    await expectAccessible(container);
  });
});
