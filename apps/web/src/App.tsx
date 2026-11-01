import { useState } from "react";

import { CataloguePage } from "./catalogue/CataloguePage";
import { PrototypePage } from "./prototype/PrototypePage";
import { AppShell } from "./shell/AppShell";
import { navigate, useRoute } from "./shell/route";
import type { Environment, SectionId } from "./shell/sections";

/** Seul le catalogue est livré (lot 04) ; les autres sections restent à venir. */
const AVAILABLE = new Set<SectionId>(["catalogue"]);

export function App() {
  const [environment, setEnvironment] = useState<Environment>("DEV");
  const route = useRoute();
  return (
    <AppShell
      workspace={null}
      available={AVAILABLE}
      active={route === "catalogue" ? "catalogue" : undefined}
      onNavigate={() => {
        navigate("catalogue");
      }}
      breadcrumb={[route === "catalogue" ? "Catalogue Atlas" : "Prototype graphique"]}
      environment={environment}
      onEnvironmentChange={setEnvironment}
      identity={null}
    >
      {route === "catalogue" ? <CataloguePage /> : <PrototypePage />}
    </AppShell>
  );
}
