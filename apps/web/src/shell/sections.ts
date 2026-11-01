/** Les six entrées de la navigation, dans l'ordre des maquettes (DESIGN-SYSTEM §5). */
export const SECTIONS = [
  { id: "explorer", label: "Explorer" },
  { id: "analyses", label: "Analyses" },
  { id: "dashboards", label: "Dashboards" },
  { id: "catalogue", label: "Catalogue Atlas" },
  { id: "deploiements", label: "Déploiements" },
  { id: "espace", label: "Espace & connexions" },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];

/** Ordre imposé : DEV | TEST | PROD (RULES §2). */
export const ENVIRONMENTS = ["DEV", "TEST", "PROD"] as const;

export type Environment = (typeof ENVIRONMENTS)[number];
