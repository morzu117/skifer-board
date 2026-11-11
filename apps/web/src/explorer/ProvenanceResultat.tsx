import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { Execution, Proof } from "../executions/model";
import { formatInstant } from "../format/date";
import { Card } from "../ui/Card";
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
export function ProvenanceResultat({ run, label = "Provenance" }: { run: Execution & { proof: NonNullable<Execution["proof"]> }; label?: string }) {
  const [copie, setCopie] = useState<string | null>(null);
  const [ouvert, setOuvert] = useState(false);
  const panneauId = useId();
  const bouton = useRef<HTMLButtonElement>(null);
  const panneau = useRef<HTMLElement>(null);
  useEffect(() => { if (ouvert) panneau.current?.focus(); }, [ouvert]);
  const fermer = () => { setOuvert(false); bouton.current?.focus(); };
  const clavier = (event: KeyboardEvent<HTMLElement>) => { if (event.key === "Escape") { event.preventDefault(); fermer(); } };
  const copier = () => { void navigator.clipboard.writeText(run.proof.sqlHash).then(() => { setCopie("Empreinte copiée."); }, () => { setCopie("Copie indisponible."); }); };
  const duree = run.proof.duration === null ? "inconnue" : `${formatNumber(run.proof.duration)} s`;
  return <Card title={label} className="sb-explorer__provenance">
    <dl className="sb-executions__facts"><dt>Preuve</dt><dd className="sb-mono">{run.proof.evidenceId}</dd><dt>Empreinte SQL</dt><dd><span className="sb-mono">{run.proof.sqlHash}</span> <button type="button" className="sb-button" onClick={copier}>Copier l'empreinte</button><span aria-live="polite"> {copie}</span></dd><dt>Certification des sources</dt><dd>{certification(run.proof.sources)}</dd><dt>Âge des données</dt><dd>{age(run.proof.sources)}</dd><dt>Durée</dt><dd>{duree}</dd></dl>
    <div><button ref={bouton} type="button" className="sb-button" aria-expanded={ouvert} aria-controls={panneauId} onClick={() => { if (ouvert) fermer(); else setOuvert(true); }}>Preuves</button></div>
    <section id={panneauId} ref={panneau} tabIndex={-1} aria-label="Preuves" hidden={!ouvert} onKeyDown={clavier}>
      <h3>Métriques</h3>{run.proof.metrics.map((metric) => <dl key={`${metric.model_key}:${metric.name}`}><dt>{metric.name} · {metric.model_key}</dt><dd>empreinte {metric.definition_hash} · certification {metric.certification} · colonnes {metric.source_columns.join(", ")} · lignage {metric.lineage_status}</dd></dl>)}
      <dl><dt>Dimensions</dt><dd>{run.proof.dimensions.join(", ")}</dd><dt>Modèles</dt><dd>{run.proof.modelKeys.join(", ")}</dd></dl>
      <h3>Filtres normalisés</h3>{run.proof.filters.map((filter, index) => <dl key={index}><dt>{filter.origin === "policy" ? "Imposé par vos droits (non retirable)" : "Exploration"}</dt><dd>{filter.modelKey} {filter.column} {filter.operator} · {filter.value ?? "sans valeur"}{filter.definitionHash === null ? null : ` · empreinte ${filter.definitionHash}`}</dd></dl>)}
      <h3>Sources</h3>{run.proof.sources.map((source) => <dl key={source.dataset}><dt>{source.dataset}</dt><dd>{source.certification_status} · âge des données {source.data_age_seconds === null ? "inconnu" : `${formatNumber(source.data_age_seconds)} s`} · âge du chargement {source.load_age_seconds === null ? "inconnu" : `${formatNumber(source.load_age_seconds)} s`}</dd></dl>)}
      <dl><dt>Politique évaluée</dt><dd>{run.proof.policy.decision} · {run.proof.policy.reasons.join(", ") || "aucune raison"} · {formatInstant(run.proof.policy.evaluated_at)}</dd><dt>Exécution</dt><dd>{run.id} · réussie · durée {duree} · identifiant de requête {run.proof.statementId ?? "inconnu"} · dialecte {run.proof.sqlDialect} · {run.truncated ? "résultat tronqué" : "résultat complet"}</dd></dl>
    </section>
  </Card>;
}
