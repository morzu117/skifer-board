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

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Âge d'une donnée : `à l'instant`, `il y a 5 min`, `il y a 3 h`, `il y a 2 j`. */
export function formatAge(since: Date, now: Date): string {
  const elapsed = Math.max(0, now.getTime() - since.getTime());
  if (elapsed < MINUTE) {
    return "à l'instant";
  }
  if (elapsed < HOUR) {
    return `il y a ${String(Math.floor(elapsed / MINUTE))} min`;
  }
  if (elapsed < DAY) {
    return `il y a ${String(Math.floor(elapsed / HOUR))} h`;
  }
  return `il y a ${String(Math.floor(elapsed / DAY))} j`;
}

const INSTANT = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "UTC" });

/** `2026-11-01T19:46:23Z` → `01/11/2026 19:46 UTC`. */
export function formatInstant(value: Date): string {
  return `${INSTANT.format(value)} UTC`;
}
