import { useEffect, useState } from "react";
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
function resultat(outcome: Paire["total"], champ: string) {
  if (outcome.status !== "ok") return <span>Indisponible : {outcome.status === "refused" ? REFUSAL_LABELS[outcome.code] : outcome.message} Le chiffre doit être demandé au moteur.</span>;
  const value = outcome.value;
  if (value.status === "unavailable") return <span>Indisponible : {RAISONS[value.reason]} Le chiffre doit être demandé au moteur.</span>;
  const brut = value.rows[0]?.[champ];
  const exact = afficher(brut);
  const pourcentage = champ === "share" && brut !== null && brut !== undefined ? pourcentageExact(exact) : null;
  if (champ === "share" && brut !== null && brut !== undefined && pourcentage === null) return <span>Indisponible : la part n'est pas numérique. Le chiffre doit être demandé au moteur. Preuve source : {value.source_evidence_id}.</span>;
  return <span>{champ === "share" && pourcentage !== null ? <>{pourcentage} % <small>(rapport exact : {exact})</small></> : exact} · {String(value.row_count)} lignes · périmètre : {PERIMETRES[value.scope]} · règle : {REGLES[value.rule]}{value.partial ? " · sur le résultat chargé" : null} · preuve source : {value.source_evidence_id}{value.notes.map((note) => <span key={note}> · {NOTES[note]}</span>)}</span>;
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
  return <div className="sb-banner sb-banner--neutral" aria-live="polite"><div><p>Sélection personnelle{run.truncated ? " · sur le résultat chargé" : ""}.</p>{answer.values.map(({ metric, total, part }) => <div key={metric}><p><strong>{metric}</strong> · Total : {resultat(total, metric)}</p><p>Part : {resultat(part, "share")}</p></div>)}</div></div>;
}
