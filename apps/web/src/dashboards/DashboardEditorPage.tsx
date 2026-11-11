import { useState } from "react";

import { Unavailable } from "../analyses/Failure";
import { SKIFER_CLAIR, type ChartTheme } from "../charts/theme";
import { routeHash } from "../shell/route";
import type { Environment } from "../shell/sections";
import { Reading } from "../spaces/AdminParts";
import type { Fetch } from "../spaces/api";
import type { Space } from "../spaces/model";
import { useOutcome } from "../ui/useOutcome";
import { fetchDashboard, fetchDashboardRevision } from "./client";
import { Editeur } from "./edition/Editeur";
import "./dashboards.css";

interface Props {
  space: Space;
  id: string;
  fetcher: Fetch;
  revision?: number | undefined;
  /** Environnement choisi dans la coque : les tuiles s'exécutent dans celui-là. */
  environment: Environment;
  /** Clé stable de la session (`identityKey`) : un changement de personne relit le dashboard et recommence tout sous la nouvelle session. */
  identity: string;
  /** Attente, en millisecondes, entre deux lectures d'une exécution en cours. */
  poll?: number;
}

/** Page de l'éditeur : lit la révision courante du dashboard, puis ouvre l'éditeur. Un refus ou une panne se lisent tels quels, sans éditeur. */
export function DashboardEditorPage({ space, id, fetcher, environment, identity, revision, poll = 1000 }: Props) {
  const [theme, setTheme] = useState<ChartTheme>(SKIFER_CLAIR);
  const read = useOutcome(`${space.id}:${id}:${identity}:${String(revision)}:lecture`, (signal) => revision === undefined ? fetchDashboard(space.id, id, signal, fetcher) : fetchDashboardRevision(space.id, id, revision, signal, fetcher));
  const list = routeHash({ page: "dashboards", space: space.id });
  return <div className={`sb-dashboards sb-theme-${theme.id}`}>
    {read.status === "loading" ? <Reading>Lecture du dashboard…</Reading>
      : read.status !== "ok" ? <>
        <Unavailable outcome={read} title="Dashboard indisponible" local="Les dashboards ne sont pas disponibles en mode local." />
        <p><a href={list}>Retour à la liste des dashboards</a></p>
      </>
      : <Editeur historical={revision !== undefined} space={space.id} identity={identity} revision={read.value} environment={environment} fetcher={fetcher} theme={theme} onTheme={setTheme} poll={poll} />}
  </div>;
}
