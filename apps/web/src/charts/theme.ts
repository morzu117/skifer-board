/**
 * Thèmes graphiques : des rôles visuels résolus depuis les tokens (plan 02, W8). Un thème ne
 * porte que l'apparence ; les constructeurs d'options lisent ces rôles, jamais une couleur.
 */
import { tokens } from "../design/tokens";

const c = tokens.color;

export interface ChartTheme {
  id: "skifer-clair" | "skifer-ardoise";
  label: string;
  surface: string;
  /** Texte d'étiquette et d'axe. */
  text: string;
  /** Texte fort : valeurs, titres. */
  textStrong: string;
  textMuted: string;
  axis: string;
  grid: string;
  /** Série principale sans sélection. */
  series: string;
  /** Série secondaire (ligne de budget, comparaison). */
  secondary: string;
  selected: string;
  /** Élément non sélectionné quand une sélection existe : remplissage clair et bordure. */
  unselectedFill: string;
  unselectedEdge: string;
  threshold: string;
  thresholdLabel: string;
  positive: string;
  negative: string;
  total: string;
  /** Paliers d'une échelle séquentielle, du plus faible au plus fort ; chacun est un token. */
  sequential: readonly string[];
  fontSans: string;
  fontMono: string;
}

export const SKIFER_CLAIR: ChartTheme = {
  id: "skifer-clair",
  label: "Skifer clair",
  surface: c.surface,
  text: c.ink2,
  textStrong: c.ink,
  textMuted: c.muted,
  axis: c.lineStrong,
  grid: c.lineSoft,
  series: c.blue,
  secondary: c.ink,
  selected: c.copper,
  unselectedFill: c.seriesMutedLight,
  unselectedEdge: c.seriesEdge,
  threshold: c.copper,
  thresholdLabel: c.copperInk,
  positive: c.success.fg,
  negative: c.danger.text,
  total: c.slate700,
  sequential: [c.subtle, c.seriesMutedLight, c.seriesMuted, c.blue, c.slate900],
  fontSans: tokens.font.sans,
  fontMono: tokens.font.mono,
};

export const SKIFER_ARDOISE: ChartTheme = {
  id: "skifer-ardoise",
  label: "Skifer ardoise",
  surface: c.slate900,
  text: c.onSlate,
  textStrong: c.surface,
  textMuted: c.onSlateMuted,
  axis: c.slateLine,
  grid: c.slate700,
  series: c.seriesMutedLight,
  secondary: c.onSlate,
  selected: c.copperOnDark,
  unselectedFill: c.slate700,
  unselectedEdge: c.seriesEdge,
  threshold: c.copperOnDark,
  thresholdLabel: c.copperEdge,
  positive: c.success.bg,
  negative: c.danger.bg,
  total: c.onSlateMuted,
  sequential: [c.slate700, c.seriesEdge, c.seriesMuted, c.seriesMutedLight, c.onSlate],
  fontSans: tokens.font.sans,
  fontMono: tokens.font.mono,
};

export const THEMES = [SKIFER_CLAIR, SKIFER_ARDOISE] as const;

/** Rôles des marques de données : contraste minimal 3:1 sur la surface (WCAG 1.4.11). */
export const MARK_ROLES = ["series", "secondary", "selected", "unselectedEdge", "threshold", "positive", "negative", "total"] as const;

/** Rôles de texte : contraste minimal 4,5:1 sur la surface. */
export const TEXT_ROLES = ["text", "textStrong", "textMuted", "thresholdLabel"] as const;

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
  const [r = 0, g = 0, b = 0] = channels.map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Rapport de contraste WCAG entre deux couleurs `#RRGGBB`. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** Style commun des options : polices, couleurs de texte, infobulle. */
export function baseOption(theme: ChartTheme) {
  return {
    backgroundColor: "transparent",
    animation: false,
    // L'étiquette accessible est rédigée par Board, en français, à partir des données (W10).
    aria: { enabled: false },
    textStyle: { fontFamily: theme.fontSans, color: theme.text, fontSize: 11 },
    tooltip: {
      backgroundColor: theme.surface,
      borderColor: theme.axis,
      textStyle: { color: theme.textStrong, fontFamily: theme.fontSans, fontSize: 12 },
    },
  };
}

/** Au-delà, toutes les étiquettes de catégorie ne tiennent plus : ECharts en espace l'affichage. */
export const MAX_LABELLED_CATEGORIES = 40;

/**
 * Axe de catégories aux couleurs du thème. Jusqu'à 40 catégories, toutes les étiquettes sont
 * affichées, avec retour à la ligne : ECharts en masquerait sinon une sur deux, sans le dire.
 */
export function categoryAxis(theme: ChartTheme, data: readonly string[]) {
  const all = data.length <= MAX_LABELLED_CATEGORIES;
  return {
    type: "category" as const,
    data: [...data],
    axisLine: { lineStyle: { color: theme.axis } },
    axisTick: { show: false },
    axisLabel: { color: theme.text, fontSize: 11, interval: all ? 0 : "auto", ...(all ? { formatter: (value: string) => wrapLabel(value) } : {}) },
  };
}

/** Longueur visée d'une ligne d'étiquette de catégorie, en caractères. */
export const LABEL_LINE_CHARS = 16;

/**
 * Retour à la ligne d'une étiquette aux espaces et après les traits d'union, jamais au milieu
 * d'un mot : « Île-de-France » devient « Île-de-\nFrance », pas « Île-de-Franc\ne ».
 */
export function wrapLabel(text: string, max: number = LABEL_LINE_CHARS): string {
  const lines: string[] = [];
  let line = "";
  for (const chunk of text.split(/(?<=-)|(?=\s)/)) {
    if (line !== "" && (line + chunk).length > max) {
      lines.push(line);
      line = chunk.trimStart();
    } else {
      line += chunk;
    }
  }
  lines.push(line);
  return lines.join("\n");
}

/** Largeur de conteneur, en pixels, sous laquelle un graphique prend sa forme étroite. */
export const NARROW_CHART_WIDTH = 480;

/**
 * Forme étroite d'un graphique, par les media queries d'ECharts évaluées sur la largeur du
 * conteneur et non de la fenêtre. `wide` rétablit la forme large quand le conteneur
 * s'élargit de nouveau : sans option par défaut, ECharts garderait la forme étroite.
 */
export function narrowMedia(wide: Record<string, unknown>, narrow: Record<string, unknown>) {
  return [{ option: wide }, { query: { maxWidth: NARROW_CHART_WIDTH }, option: narrow }];
}

/** Axe de valeurs aux couleurs du thème, étiquettes formatées. */
export function valueAxis(theme: ChartTheme, format: (value: number) => string) {
  return {
    type: "value" as const,
    axisLine: { show: false },
    splitLine: { lineStyle: { color: theme.grid } },
    // Une graduation qui en chevauche une autre est masquée : la valeur reste lisible sur la grille.
    axisLabel: { color: theme.text, fontSize: 11, fontFamily: theme.fontMono, formatter: format, hideOverlap: true },
  };
}
