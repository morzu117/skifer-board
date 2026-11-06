import type { AnalysisDraft } from "./document";
import type { Unsaved } from "./explorer";
import { OngletCalculs, OngletPresentation, OngletRequete } from "./FicheOnglets";
import { VISIBILITY_LABELS } from "./labels";
import "./analyses.css";

/**
 * Aperçu de ce qui serait enregistré, avant toute écriture (plan 18, 18.5b) : le brouillon relu par le décodeur, rendu
 * comme la fiche le rend, puis ce que l'Explorateur porte et que le format ne garde pas, chaque point avec sa raison.
 */
export function ApercuAnalyse({ draft, unsaved }: { draft: AnalysisDraft; unsaved: readonly Unsaved[] }) {
  return <div className="sb-analyses__apercu" role="group" aria-label="Aperçu de l'analyse">
    <dl className="sb-analyses__facts">
      <dt>Nom</dt><dd>{draft.name}</dd>
      <dt>Description</dt><dd>{draft.description === "" ? "Aucune description." : draft.description}</dd>
      <dt>Visibilité</dt><dd>{VISIBILITY_LABELS[draft.visibility]}</dd>
    </dl>
    <h3>Requête</h3>
    <OngletRequete analysis={draft} unresolved={[]} />
    <h3>Calculs contextuels</h3>
    <OngletCalculs analysis={draft} />
    <h3>Présentation par défaut</h3>
    <OngletPresentation analysis={draft} />
    <h3>Non sauvegardé</h3>
    <ul>{unsaved.map((item) => <li key={item.what}>{item.what} : {item.why}.</li>)}</ul>
  </div>;
}
