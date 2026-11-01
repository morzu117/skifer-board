import { useState } from "react";

import { SKIFER_CLAIR, type ChartTheme } from "../charts/theme";
import { Banner } from "../ui/Banner";
import { CombinedCase, HeatmapCase, KpiCase, SelectionCase, WaterfallCase } from "./cases";
import { ThemeSwitch } from "./ThemeSwitch";
import "./prototype.css";

/** Page composée du lot 01 : les cinq cas du §6.3 sous un même thème. */
export function PrototypePage() {
  const [theme, setTheme] = useState<ChartTheme>(SKIFER_CLAIR);
  return (
    <>
      <div className="sb-page-head">
        <h1 className="sb-page-head__title">Prototype graphique</h1>
        <ThemeSwitch value={theme} onChange={setTheme} />
      </div>
      <Banner tone="neutral">
        Lot 01 · données de démonstration générées dans le navigateur, sans connexion ni moteur. Les temps de rendu se mesurent sur la{" "}
        <a href="bench.html">page de mesure</a>.
      </Banner>
      <div className={`sb-prototype sb-theme-${theme.id}`}>
        <KpiCase />
        <SelectionCase theme={theme} />
        <div className="sb-row-group">
          <CombinedCase theme={theme} />
          <WaterfallCase theme={theme} />
        </div>
        <HeatmapCase theme={theme} />
      </div>
    </>
  );
}
