import { DataType, DateUnit, TimeUnit, type Date_ as DateArrow, type Timestamp } from "apache-arrow";

/** Division euclidienne : le reste reste positif avant comme après 1970. */
function divise(valeur: bigint, base: bigint): bigint {
  const quotient = valeur / base;
  return valeur % base < 0n ? quotient - 1n : quotient;
}

/** Calendrier grégorien proleptique, sans conversion de l'époque en flottant. */
function jourCivil(jours: bigint): string {
  const z = jours + 719468n;
  const ere = divise(z, 146097n);
  const jourEre = z - ere * 146097n;
  const anEre = (jourEre - jourEre / 1460n + jourEre / 36524n - jourEre / 146096n) / 365n;
  let an = anEre + ere * 400n;
  const jourAn = jourEre - (365n * anEre + anEre / 4n - anEre / 100n);
  const moisMars = (5n * jourAn + 2n) / 153n;
  const jour = jourAn - (153n * moisMars + 2n) / 5n + 1n;
  const mois = moisMars + (moisMars < 10n ? 3n : -9n);
  if (mois <= 2n) an += 1n;
  const annee = an >= 0n && an <= 9999n ? an.toString().padStart(4, "0") : `${an < 0n ? "-" : "+"}${(an < 0n ? -an : an).toString().padStart(6, "0")}`;
  return `${annee}-${mois.toString().padStart(2, "0")}-${jour.toString().padStart(2, "0")}`;
}

/** Formate les valeurs natives ; seul un horodatage avec fuseau est présenté en UTC. */
export function texteTemporel(valeur: bigint, type: DateArrow | Timestamp): string {
  if (DataType.isDate(type)) return jourCivil(type.unit === DateUnit.DAY ? valeur : divise(valeur, 86400000n));
  const precision = { [TimeUnit.SECOND]: 0, [TimeUnit.MILLISECOND]: 3, [TimeUnit.MICROSECOND]: 6, [TimeUnit.NANOSECOND]: 9 }[type.unit];
  const echelle = 10n ** BigInt(precision);
  const secondes = divise(valeur, echelle);
  const fraction = valeur - secondes * echelle;
  const jours = divise(secondes, 86400n);
  const secondeJour = secondes - jours * 86400n;
  const heures = (secondeJour / 3600n).toString().padStart(2, "0");
  const minutes = ((secondeJour % 3600n) / 60n).toString().padStart(2, "0");
  const secondesTexte = (secondeJour % 60n).toString().padStart(2, "0");
  return `${jourCivil(jours)}T${heures}:${minutes}:${secondesTexte}${precision === 0 ? "" : `.${fraction.toString().padStart(precision, "0")}`}${type.timezone ? "Z" : ""}`;
}
