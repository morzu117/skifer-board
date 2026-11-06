import type { ReactNode } from "react";
import { routeHash } from "../shell/route";
import { Reading } from "../spaces/AdminParts";
import type { Fetch } from "../spaces/api";
import { Banner } from "../ui/Banner";
import { useOutcome } from "../ui/useOutcome";
import { fetchAnalysis, fetchAnalysisRevision } from "./client";
import { explorerFromAnalysis, openedFrom, statusBlockers, type Catalog, type ExplorerState, type Opened } from "./explorer";
import { Unavailable } from "./Failure";
import type { AnalysisRevision } from "./model";

export interface Opening {
  state: ExplorerState;
  opened: Opened;
}

interface Props {
  space: string;
  analysis: { id: string; revision?: number | undefined };
  catalog: Catalog;
  fetcher: Fetch;
  children: (opening: Opening) => ReactNode;
}

/**
 * Lit la révision à ouvrir par l'API et dit si l'Explorateur peut la porter. Rien n'est ouvert à moitié : une analyse
 * supprimée, aux références non confirmées, ou que l'Explorateur ne sait pas représenter reste fermée, avec ses raisons.
 * L'Explorateur n'envoie aucun événement `opened` : l'ouverture se compte à l'affichage de la fiche.
 */
export function OuvertureAnalyse({ space, analysis, catalog, fetcher, children }: Props) {
  const found = useOutcome(`${space}:${analysis.id}:${analysis.revision === undefined ? "courante" : String(analysis.revision)}`, (signal) => (analysis.revision === undefined ? fetchAnalysis(space, analysis.id, signal, fetcher) : fetchAnalysisRevision(space, analysis.id, analysis.revision, signal, fetcher)));
  const sheet = routeHash({ page: "analysis", space, id: analysis.id });
  const empty = routeHash({ page: "explorer", space });
  if (found.status === "loading") return <Reading>Lecture de l'analyse…</Reading>;
  if (found.status !== "ok") return <>
    <Unavailable outcome={found} title="Analyse indisponible" local="L'exploration n'est pas disponible en mode local." />
    <p><a href={sheet}>Retour à la fiche</a> · <a href={empty}>Explorer sans analyse</a></p>
  </>;
  const reopened = explorerFromAnalysis(found.value.analysis, catalog);
  const status = statusBlockers(found.value);
  if (reopened.status === "ok" && status.length === 0) {
    // Une analyse supprimée est écartée ci-dessus : sa révision courante existe.
    return <>{children({ state: reopened.state, opened: openedFrom(found.value as AnalysisRevision & { currentRevision: number }, reopened.state, catalog.models) })}</>;
  }
  const reasons = [...status, ...(reopened.status === "unavailable" ? reopened.reasons : [])];
  return <>
    <Banner tone="danger">
      <p>Cette analyse ne s'ouvre pas dans l'Explorateur : rien n'est ouvert à moitié.</p>
      <ul>{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
    </Banner>
    <p><a href={analysis.revision === undefined ? sheet : routeHash({ page: "analysis", space, id: analysis.id, revision: analysis.revision })}>Retour à la fiche</a> · <a href={empty}>Explorer sans analyse</a></p>
  </>;
}
