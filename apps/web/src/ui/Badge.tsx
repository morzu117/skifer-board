import type { ReactNode } from "react";

import "./ui.css";

export type BadgeTone = "success" | "warning" | "danger" | "neutral";

interface BadgeProps {
  tone: BadgeTone;
  /** Le mot qui porte l'état : une couleur n'est jamais seule (RULES §2). */
  children: ReactNode;
}

export function Badge({ tone, children }: BadgeProps) {
  return <span className={`sb-badge sb-badge--${tone}`}>{children}</span>;
}
