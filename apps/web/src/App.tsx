import { useState } from "react";

import { AppShell } from "./shell/AppShell";
import type { Environment, SectionId } from "./shell/sections";

/** Aucune section n'est livrée avant les lots 05 et suivants : la navigation les montre à venir. */
const AVAILABLE = new Set<SectionId>();

export function App() {
  const [environment, setEnvironment] = useState<Environment>("DEV");
  const [section, setSection] = useState<SectionId>();
  return (
    <AppShell
      workspace={null}
      available={AVAILABLE}
      active={section}
      onNavigate={setSection}
      breadcrumb={["Prototype graphique"]}
      environment={environment}
      onEnvironmentChange={setEnvironment}
      identity={null}
    >
      <h1>Prototype graphique</h1>
    </AppShell>
  );
}
