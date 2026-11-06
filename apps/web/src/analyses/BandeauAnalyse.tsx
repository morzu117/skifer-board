import { routeHash } from "../shell/route";
import { Badge } from "../ui/Badge";
import { Banner } from "../ui/Banner";
import type { Opened } from "./explorer";

interface Props {
  space: string;
  opened: Opened;
  /** L'exploration s'est écartée de la révision ouverte (requête, calculs ou type de graphique). */
  modified: boolean;
  /** Les exécutions portent la référence `{id, revision}` de l'analyse. */
  linked: boolean;
  /** Pourquoi les exécutions ne sont plus liées : modèle changé ou détachement demandé, ou `null`. Durable jusqu'à une réouverture ou une publication. */
  detached: "model" | "explicit" | null;
  onDetach: () => void;
}

/** Bandeau de l'Explorateur ouvert sur une analyse : de quelle révision part l'exploration, et si les exécutions s'y rattachent encore. */
export function BandeauAnalyse({ space, opened, modified, linked, detached, onDetach }: Props) {
  const fiche = routeHash({ page: "analysis", space, id: opened.id, ...(opened.revision === opened.currentRevision ? {} : { revision: opened.revision }) });
  return <>
    <Banner tone="neutral" action={linked ? <button type="button" className="sb-button" onClick={onDetach}>Détacher de l'analyse</button> : undefined}>
      <p>Exploration à partir de « {opened.name} », révision {opened.revision}. <a href={fiche}>Ouvrir la fiche</a>{" "}
        {modified ? <Badge tone="warning">Modifiée depuis l'ouverture</Badge> : <Badge tone="neutral">Identique à la révision ouverte</Badge>}</p>
      {opened.revision === opened.currentRevision ? null : <p>La révision courante est la {opened.currentRevision} : une révision enregistrée part toujours de la courante.</p>}
      <p>{linked ? `Les exécutions sont liées à l'analyse (révision ${String(opened.revision)}) : le serveur vérifie que le modèle est le sien.`
        : detached === "model" ? "Le modèle a changé : les exécutions ne sont plus liées à l'analyse, elles partent sans référence. Revenir au modèle d'origine ne rétablit pas le lien : seule la réouverture de l'analyse, ou l'enregistrement d'une révision, le fait."
        : "Détachée : les exécutions partent sans référence à l'analyse. Seule la réouverture de l'analyse, ou l'enregistrement d'une révision, rétablit le lien."}</p>
    </Banner>
  </>;
}
