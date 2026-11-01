/** Mois au format `AAAA-MM`, comme les clés de dimension temporelle des jeux de résultats. */
const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;

const SHORT = new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "UTC" });
const LONG = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });

function parse(key: string): Date {
  const match = MONTH_KEY.exec(key);
  if (match === null) {
    throw new RangeError(`Clé de mois invalide : ${key}`);
  }
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
}

/** `2026-03` → `mars`. */
export function formatMonthShort(key: string): string {
  return SHORT.format(parse(key));
}

/** `2026-03` → `mars 2026`. */
export function formatMonthLong(key: string): string {
  return LONG.format(parse(key));
}
