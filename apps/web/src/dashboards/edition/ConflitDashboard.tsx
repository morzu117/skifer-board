import { useRef, useState } from "react";
import { Unavailable } from "../../analyses/Failure";
import { routeHash } from "../../shell/route";
import { Reading } from "../../spaces/AdminParts";
import type { Fetch } from "../../spaces/api";
import { Banner } from "../../ui/Banner";
import { useOutcome } from "../../ui/useOutcome";
import { duplicateDashboard, fetchDashboard, reviseDashboard } from "../client";
import type { DashboardDraft } from "../document";
import { dashboardRefusalText } from "../Failure";
import type { DashboardRevision } from "../model";
import { DashboardDiffView } from "../Historique";

/** Un conflit bloque la publication originale ; les deux seules issues sont une copie et la réouverture confirmée. */
export function ConflitDashboard({ space, id, opened, draft, fetcher, onReopen, onSaved }: { space: string; id: string; opened: number; draft: DashboardDraft; fetcher: Fetch; onReopen: (revision: DashboardRevision) => void; onSaved?: (() => void) | undefined }) {
  const current = useOutcome(`${space}:${id}:conflit`, (signal) => fetchDashboard(space, id, signal, fetcher));
  const [compare, setCompare] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [copy, setCopy] = useState<DashboardRevision | null>(null);
  const [saved, setSaved] = useState<DashboardRevision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const createCopy = async (): Promise<void> => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    let target = copy;
    if (target === null) {
      const outcome = await duplicateDashboard(space, id, undefined, fetcher);
      if (outcome.status !== "ok") { setError(outcome.status === "refused" ? dashboardRefusalText(outcome) : outcome.message); lock.current = false; setBusy(false); return; }
      target = outcome.value;
      setCopy(target);
    }
    const result = await reviseDashboard(space, target.id, { ...draft, name: target.dashboard.name, visibility: "personal" }, target.revision, fetcher);
    lock.current = false;
    setBusy(false);
    if (result.status !== "ok") { setError(result.status === "refused" ? dashboardRefusalText(result) : result.message); return; }
    setSaved(result.value.revision);
    onSaved?.();
  };
  return <section aria-label="Conflit de révision" className="sb-analyses__impact">
    <h2>Une autre révision est courante</h2>
    <p>Votre brouillon est conservé. Enregistrer par-dessus la révision courante n'est pas proposé.</p>
    {current.status === "loading" ? <Reading>Lecture de la révision courante…</Reading> : current.status !== "ok" ? <Unavailable outcome={current} title="Révision courante indisponible" local="Dashboard indisponible en mode local." /> : <>
      <p>Révision ouverte r{opened} · révision courante r{current.value.revision}.</p>
      <button type="button" className="sb-button" onClick={() => { setCompare(true); }}>Voir l'écart</button>
      <button type="button" className="sb-button" onClick={() => { setAsking(true); }}>Rouvrir la révision courante</button>
      {compare ? <DashboardDiffView space={space} id={id} base={opened} other={current.value.revision} fetcher={fetcher} /> : null}
      {asking ? <div role="group" aria-label="Abandonner les modifications"><p>Rouvrir abandonne vos modifications non enregistrées.</p><button type="button" className="sb-button" onClick={() => { onReopen(current.value); }}>Abandonner et rouvrir</button><button type="button" className="sb-button" onClick={() => { setAsking(false); }}>Annuler</button></div> : null}
    </>}
    {saved === null ? <button type="button" className="sb-button" disabled={busy} onClick={() => { void createCopy(); }}>{busy ? "Copie en cours…" : copy === null ? "Copie indépendante" : "Réessayer la révision de la copie"}</button> : <p>Copie enregistrée. <a href={routeHash({ page: "dashboard", space, id: saved.id })} target="_blank" rel="noopener noreferrer">Ouvrir la copie</a></p>}
    {error === null ? null : <Banner tone="danger">{error}</Banner>}
  </section>;
}

