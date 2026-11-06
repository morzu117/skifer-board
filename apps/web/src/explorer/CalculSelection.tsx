import { Fragment, useEffect, useState } from "react";
import type { Execution } from "../executions/model";
import type { Fetch } from "../spaces/api";
import { REFUSAL_LABELS } from "../spaces/admin";
import { computeContextual } from "./client";
import type { Cell, ContextualResult, Selection } from "./model";

const RAISONS: Record<Extract<ContextualResult, { status: "unavailable" }>["reason"], string> = {
  contract_unavailable: "Le contrat du résultat est absent.", result_unreadable: "Le résultat ne peut pas être lu.", grain_not_unique: "Plusieurs lignes partagent le même grain.", empty_selection: "La sélection ne couvre aucune ligne.", unknown_aggregation: "La règle d'agrégation est inconnue.", numeric_overflow: "La valeur dépasse la précision disponible.", unsupported_value: "Une valeur ne peut pas être représentée.", count_distinct_not_summable: "Un compte distinct ne peut pas être additionné.", non_additive: "La métrique n'est pas additive.", non_additive_dimension: "La métrique n'est pas additive sur cette dimension.", components_missing: "Les composantes nécessaires manquent.", incomplete_result: "Le résultat est incomplet.", share_undefined: "La part n'est pas définie pour ce dénominateur.",
};
const REGLES: Record<Extract<ContextualResult, { status: "derived" }>["rule"], string> = { identity: "valeur au grain", sum: "somme", min: "minimum", max: "maximum", weighted_average: "moyenne pondérée", share: "part du résultat chargé" };
const PERIMETRES: Record<Extract<ContextualResult, { status: "derived" }>["scope"], string> = { selection: "sélection courante", loaded_result: "résultat chargé", filtered_perimeter: "périmètre filtré" };
function afficher(value: Cell | undefined): string {
  if (value === undefined || value === null) return "—";
  return typeof value === "object" ? value.value : String(value);
}
/** Décale la virgule de deux positions sur la représentation décimale, sans arrondi. */
export function pourcentageExact(rapport: string): string | null {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(rapport);
  if (match === null) return null;
  const signe = match[1] as string;
  const entier = match[2] as string;
  const fraction = match[3] ?? "";
  const exposant = Number.parseInt(match[4] ?? "0", 10);
  if (!Number.isSafeInteger(exposant) || Math.abs(exposant) > 400) return null;
  const chiffres = entier + fraction;
  const position = entier.length + exposant + 2;
  if (position <= 0) return `${signe}0,${"0".repeat(-position)}${chiffres}`;
  const complet = chiffres.padEnd(position, "0");
  const gauche = complet.slice(0, position).replace(/^0+(?=\d)/, "");
  const droite = complet.slice(position);
  return `${signe}${gauche}${droite === "" ? "" : `,${droite}`}`;
}
type Paire = { metric: string; total: Awaited<ReturnType<typeof computeContextual>>; part: Awaited<ReturnType<typeof computeContextual>> };
const NOTES: Record<"zero_or_null_denominator", string> = { zero_or_null_denominator: "Le dénominateur est nul ou absent : la part ne peut pas être calculée." };
/** Arrondit une représentation décimale par chiffres, sans perdre l'exactitude de l'original. */
export function nombreLisible(exact: string, unite = ""): string {
  const match = /^(-?)(\d+)(?:[.,](\d+))?$/.exec(exact);
  if (match === null) return `${exact}${unite}`;
  const fraction = match[3] ?? "";
  const francais = exact.replace(".", ",");
  if (fraction.length <= 2) return `${francais}${unite}`;
  if (/^0+$/.test(fraction.slice(2))) return `${match[1]}${match[2]},${fraction.slice(0, 2)}${unite}`;
  const centiemes = BigInt(`${match[2]}${fraction.slice(0, 2)}`) + (Number(fraction[2]) >= 5 ? 1n : 0n);
  const chiffres = centiemes.toString().padStart(3, "0");
  return `≈ ${match[1]}${chiffres.slice(0, -2)},${chiffres.slice(-2)}${unite} (exact : ${francais}${unite})`;
}
function ligne(outcome: Paire["total"], champ: string, titre: string, metric: string) {
  const indisponible = (raison: string) => <tr role="row"><th role="rowheader" scope="row"><span className="sb-explorer__etiquette" aria-hidden="true">Calcul</span>{titre} : {metric}</th><td role="cell"><span className="sb-explorer__etiquette" aria-hidden="true">Périmètre</span>—</td><td role="cell"><span className="sb-explorer__etiquette" aria-hidden="true">Valeur</span>Indisponible : {raison} Le chiffre doit être demandé au moteur.</td><td role="cell"><span className="sb-explorer__etiquette" aria-hidden="true">Preuve source</span>—</td></tr>;
  if (outcome.status !== "ok") return indisponible(outcome.status === "refused" ? REFUSAL_LABELS[outcome.code] : outcome.message);
  if (outcome.value.status === "unavailable") return indisponible(RAISONS[outcome.value.reason]);
  const value = outcome.value;
  const brut = value.rows[0]?.[champ];
  const exact = afficher(brut);
  const pourcentage = champ === "share" && brut !== null && brut !== undefined ? pourcentageExact(exact) : null;
  const invalide = champ === "share" && brut !== null && brut !== undefined && pourcentage === null;
  const affichage = invalide ? "Indisponible : la part n'est pas numérique. Le chiffre doit être demandé au moteur." : champ === "share" && pourcentage !== null ? `${nombreLisible(pourcentage, " %").split(" (exact : ")[0]} (rapport exact : ${exact.replace(".", ",")})` : nombreLisible(exact);
  return <tr role="row"><th role="rowheader" scope="row"><span className="sb-explorer__etiquette" aria-hidden="true">Calcul</span>{titre} : {metric}</th><td role="cell"><span className="sb-explorer__etiquette" aria-hidden="true">Périmètre</span>{PERIMETRES[value.scope]}{value.partial ? " · sur le résultat chargé" : null}</td><td role="cell"><span className="sb-explorer__etiquette" aria-hidden="true">Valeur</span>{affichage} · {String(value.row_count)} ligne{value.row_count > 1 ? "s" : ""} · règle : {REGLES[value.rule]}{value.notes.map((note) => <span key={note}> · {NOTES[note]}</span>)}</td><td role="cell"><span className="sb-explorer__etiquette" aria-hidden="true">Preuve source</span>preuve source : {value.source_evidence_id}</td></tr>;
}

export function CalculSelection({ run, selection, fetcher }: { run: Execution; selection: Selection; fetcher: Fetch }) {
  const [answer, setAnswer] = useState<{ key: string; values: Paire[] } | null>(null);
  const metrics = run.resultContract?.metrics;
  const key = JSON.stringify({ space: run.space, id: run.id, selection, metrics: metrics ?? null });
  useEffect(() => {
    if (metrics === undefined) return;
    let actif = true;
    const values = (JSON.parse(key) as { selection: Selection }).selection;
    const timer = window.setTimeout(() => { void Promise.all(metrics.map(async ({ name }) => {
      const body = { metric: name, group_by: [], selection: values, scope: null } as const;
      const [total, part] = await Promise.all([
        computeContextual(run.space, run.id, { ...body, operation: "aggregate", denominator: null }, fetcher),
        computeContextual(run.space, run.id, { ...body, operation: "share", denominator: "loaded_result" }, fetcher),
      ]);
      return { metric: name, total, part };
    })).then((results) => { if (actif) setAnswer({ key, values: results }); }); }, 250);
    return () => { actif = false; window.clearTimeout(timer); };
  }, [run.space, run.id, metrics, fetcher, key]);
  if (metrics === undefined) return <div className="sb-banner sb-banner--warning" role="status"><div>Total indisponible pour cette sélection : le contrat du résultat est absent. Le chiffre doit être demandé au moteur.</div></div>;
  if (answer?.key !== key) return <p role="status">Calcul de la sélection…</p>;
  const incoherent = answer.values.flatMap(({ total, part }) => [total, part]).find((outcome) => outcome.status === "ok" && outcome.value.status === "derived" && outcome.value.source_evidence_id !== run.proof?.evidenceId);
  if (incoherent?.status === "ok" && incoherent.value.status === "derived") return <div className="sb-banner sb-banner--warning" role="status"><div>Calcul indisponible : {run.proof === null ? `la preuve de l'exécution est absente (preuve source : ${incoherent.value.source_evidence_id})` : `la preuve source ${incoherent.value.source_evidence_id} ne correspond pas à la preuve de l'exécution`}. Les chiffres sont masqués ; le chiffre doit être demandé au moteur.</div></div>;
  return <><p className="sb-explorer__defilement">Faites défiler les calculs horizontalement pour voir toutes les colonnes.</p><div className="sb-explorer__calculs" role="region" aria-label="Calculs contextuels" tabIndex={0} aria-live="polite"><table className="sb-table" role="table"><caption>Calculs contextuels</caption><thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Calcul</th><th role="columnheader" scope="col">Périmètre</th><th role="columnheader" scope="col">Valeur</th><th role="columnheader" scope="col">Preuve source</th></tr></thead><tbody role="rowgroup">{answer.values.map(({ metric, total, part }) => <Fragment key={metric}>{ligne(total, metric, "Total", metric)}{ligne(part, "share", "Part", metric)}</Fragment>)}</tbody></table></div></>;
}
