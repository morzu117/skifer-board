import type { ReactNode } from "react";

import { InfoIcon, WarningIcon } from "./icons";
import "./ui.css";

export type BannerTone = "warning" | "danger" | "neutral";

interface BannerProps {
  tone: BannerTone;
  children: ReactNode;
  action?: ReactNode;
}

/** Bandeau d'alerte : résultat tronqué, calcul indisponible, dépendance manquante. */
export function Banner({ tone, children, action }: BannerProps) {
  return (
    <div className={`sb-banner sb-banner--${tone}`} role={tone === "danger" ? "alert" : "status"}>
      {tone === "neutral" ? <InfoIcon /> : <WarningIcon />}
      <div className="sb-banner__text">{children}</div>
      {action}
    </div>
  );
}
