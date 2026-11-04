import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Execution, Proof } from "../executions/model";
import { formatInstant } from "../format/date";
import { formatNumber } from "../format/number";

export function certification(sources: Proof["sources"]): string {
  const statuts = sources.map((item) => item.certification_status);
  if (statuts.some((statut) => statut !== "CERTIFIED" && statut !== "UNCERTIFIED")) return "inconnue";
  if (statuts.every((statut) => statut === "CERTIFIED")) return "certifié";
  if (statuts.every((statut) => statut === "UNCERTIFIED")) return "non certifié";
  return "mixte";
}
export function age(sources: Proof["sources"]): string {
  if (sources.some((source) => source.data_age_seconds === null)) return "inconnu";
  return `${formatNumber(Math.max(...sources.map((source) => source.data_age_seconds as number)))} s`;
}
export function ProvenanceResultat({ run }: { run: Execution & { proof: NonNullable<Execution["proof"]> } }) {
  const [copie, setCopie] = useState<string | null>(null);
  const [ouvert, setOuvert] = useState(false);
  const bouton = useRef<HTMLButtonElement>(null);
  const panneau = useRef<HTMLElement>(null);
  useEffect(() => { if (ouvert) panneau.current?.focus(); }, [ouvert]);
  const fermer = () => { setOuvert(false); bouton.current?.focus(); };
  const clavier = (event: KeyboardEvent<HTMLElement>) => { if (event.key === "Escape") { event.preventDefault(); fermer(); } };
  const copier = () => { void navigator.clipboard.writeText(run.proof.sqlHash).then(() => { setCopie("Empreinte copiée."); }, () => { setCopie("Copie indisponible."); }); };
  const duree = run.proof.duration === null ? "inconnue" : `${formatNumber(run.proof.duration)} s`;
  return <div>
    <p>Preuve : <span className="sb-mono">{run.proof.evidenceId}</span> · Empreinte SQL : <span className="sb-mono">{run.proof.sqlHash}</span> <button type="button" className="sb-button" onClick={copier}>Copier l'empreinte</button> · Certification des sources : {certification(run.proof.sources)} · Âge des données : {age(run.proof.sources)} · Durée : {duree}</p>
    <p aria-live="polite">{copie}</p>
    <button ref={bouton} type="button" className="sb-button" aria-expanded={ouvert} onClick={() => { if (ouvert) fermer(); else setOuvert(true); }}>Preuves</button>
    {ouvert ? <section ref={panneau} tabIndex={-1} aria-label="Preuves" onKeyDown={clavier}>
      <h2>Preuves</h2><button type="button" className="sb-button" onClick={fermer}>Fermer les preuves</button>
      <h3>Métriques</h3><ul>{run.proof.metrics.map((metric) => <li key={`${metric.model_key}:${metric.name}`}>{metric.name} · {metric.model_key} · empreinte {metric.definition_hash} · certification {metric.certification} · colonnes {metric.source_columns.join(", ")} · lignage {metric.lineage_status}</li>)}</ul>
      <p>Dimensions : {run.proof.dimensions.join(", ")}.</p><p>Modèles : {run.proof.modelKeys.join(", ")}.</p>
      <h3>Filtres normalisés</h3><ul>{run.proof.filters.map((filter, index) => <li key={index}>{filter.origin === "policy" ? "Imposé par vos droits (non retirable)" : "Exploration"} · {filter.modelKey} {filter.column} {filter.operator} · {filter.value ?? "sans valeur"}{filter.definitionHash === null ? null : ` · empreinte ${filter.definitionHash}`}</li>)}</ul>
      <h3>Sources</h3><ul>{run.proof.sources.map((source) => <li key={source.dataset}>{source.dataset} · {source.certification_status} · âge des données {source.data_age_seconds === null ? "inconnu" : `${formatNumber(source.data_age_seconds)} s`} · âge du chargement {source.load_age_seconds === null ? "inconnu" : `${formatNumber(source.load_age_seconds)} s`}</li>)}</ul>
      <p>Politique évaluée : {run.proof.policy.decision} · {run.proof.policy.reasons.join(", ") || "aucune raison"} · {formatInstant(run.proof.policy.evaluated_at)}.</p>
      <p>Exécution : {run.id} · réussie · durée {duree} · identifiant de requête {run.proof.statementId ?? "inconnu"} · dialecte {run.proof.sqlDialect} · {run.truncated ? "résultat tronqué" : "résultat complet"}.</p>
    </section> : null}
  </div>;
}
