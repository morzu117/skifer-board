import { Badge } from "../ui/Badge";
import type { AnalysisDocument, AnalysisFilter } from "./document";
import { chartLabel, OPERATOR_LABELS, RULE_LABELS, stepText } from "./labels";

/** Contenus des onglets de la fiche qui se lisent dans le document, sans appel au serveur (plan 18, A9). */

function valueText(filter: AnalysisFilter): string {
  const value = filter.value;
  if (filter.operator === "between" && Array.isArray(value)) return `${String(value[0])} et ${String(value[1])}`;
  return Array.isArray(value) ? value.map(String).join(", ") : String(value);
}

/** Requête en lecture seule ; une référence que le catalogue ne confirme pas est signalée à sa place avec sa règle, telle qu'enregistrée. */
export function OngletRequete({ analysis, unresolved }: { analysis: Pick<AnalysisDocument, "query">; unresolved: readonly { path: string; rule: keyof typeof RULE_LABELS }[] }) {
  const { query } = analysis;
  // Un chemin peut porter plusieurs règles ; chacune est dite avec ses mots, sans conclure à l'absence quand la règle dit autre chose.
  const flag = (path: string) => unresolved.filter((item) => item.path === path).map((item) => <span key={item.rule}> <Badge tone="danger">{RULE_LABELS[item.rule]}</Badge></span>);
  return <dl className="sb-analyses__facts">
    <dt>Connexion</dt><dd className="sb-mono">{query.connection}{flag("/query/connection")}</dd>
    <dt>Modèle</dt><dd className="sb-mono">{query.model}{flag("/query/model")}</dd>
    <dt>Métriques</dt><dd><ul>{query.metrics.map((name, index) => <li key={name} className="sb-mono">{name}{flag(`/query/metrics/${String(index)}`)}</li>)}</ul></dd>
    <dt>Dimensions</dt><dd>{query.dimensions.length === 0 ? "Aucune dimension." : <ul>{query.dimensions.map((name, index) => <li key={name} className="sb-mono">{name}{flag(`/query/dimensions/${String(index)}`)}</li>)}</ul>}</dd>
    <dt>Filtres</dt><dd>{query.filters.length === 0 ? "Aucun filtre d'exploration." : <ul>{query.filters.map((filter, index) => <li key={`${filter.column}:${String(index)}`}><span className="sb-mono">{filter.column}</span> {OPERATOR_LABELS[filter.operator]} {valueText(filter)}{flag(`/query/filters/${String(index)}`)}</li>)}</ul>}</dd>
    <dt>Environnement</dt><dd>Aucun : l'analyse s'exécute dans l'environnement choisi, avec vos droits de ligne. Aucun SQL n'est enregistré.</dd>
  </dl>;
}

export function OngletCalculs({ analysis }: { analysis: Pick<AnalysisDocument, "contextual"> }) {
  if (analysis.contextual.length === 0) return <p className="sb-members__state">Aucun calcul contextuel.</p>;
  return <>
    <p className="sb-members__state">Les calculs s'appliquent dans l'ordre de la liste ; ils se recalculent à chaque exécution, avec leur périmètre et leur règle.</p>
    <ol className="sb-analyses__steps">{analysis.contextual.map((step, index) => <li key={`${step.operation}:${step.metric}:${String(index)}`}>{stepText(step)}</li>)}</ol>
  </>;
}

export function OngletPresentation({ analysis }: { analysis: Pick<AnalysisDocument, "presentation"> }) {
  return <dl className="sb-analyses__facts">
    <dt>Type de graphique</dt><dd>{chartLabel(analysis.presentation.chart)} <span className="sb-mono">({analysis.presentation.chart})</span></dd>
  </dl>;
}

export function OngletConsommateurs() {
  return <p>Aucun consommateur. Les dashboards et les releases n'existent pas encore (lot 07) : la liste est vide jusque-là, et le contrôle à la suppression est déjà en place.</p>;
}
