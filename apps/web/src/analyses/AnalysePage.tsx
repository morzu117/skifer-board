import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { SKIFER_CLAIR, type ChartTheme } from "../charts/theme";
import { formatInstant } from "../format/date";
import { ThemeSwitch } from "../prototype/ThemeSwitch";
import { navigate, routeHash } from "../shell/route";
import { Confirm, Reading, refusalText } from "../spaces/AdminParts";
import type { Fetch } from "../spaces/api";
import type { Space } from "../spaces/model";
import { Badge } from "../ui/Badge";
import { Banner } from "../ui/Banner";
import { Card } from "../ui/Card";
import { useOutcome } from "../ui/useOutcome";
import { deleteAnalysis, duplicateAnalysis, fetchAnalysis, fetchAnalysisRevision, openAnalysis } from "./client";
import { analysisRefusalText, Unavailable, type Failed } from "./Failure";
import { openability } from "./explorer";
import { OngletCalculs, OngletPresentation, OngletRequete } from "./FicheOnglets";
import { ListeConsommateurs, OngletConsommateurs } from "./Consommateurs";
import { EpinglerDashboard } from "./EpinglerDashboard";
import { OngletPreuves } from "./Preuves";
import { READ_STATE_LABELS, RULE_LABELS, VISIBILITY_LABELS, valueAt } from "./labels";
import type { AnalysisRevision } from "./model";
import { newEventId } from "./reference";
import { OngletRevisions } from "./Revisions";
import { OngletUsage } from "./Usage";
import "./analyses.css";
import "../executions/executions.css";

interface Props { space: Space; id: string; revision: number | undefined; view?: "history" | undefined; compare?: { base: number; other: number } | undefined; fetcher: Fetch }

const TABS = [
  { id: "requete", label: "Requête" }, { id: "calculs", label: "Calculs contextuels" }, { id: "presentation", label: "Présentation par défaut" },
  { id: "revisions", label: "Révisions" }, { id: "consommateurs", label: "Consommateurs" }, { id: "usage", label: "Usage" }, { id: "preuves", label: "Preuves" },
] as const;
type TabId = (typeof TABS)[number]["id"];

/** Fiche d'une analyse : en-tête et provenance, actions selon les droits du serveur, puis ses onglets (plan 18, A9). */
export function AnalysePage({ space, id, revision, view, compare, fetcher }: Props) {
  const [theme, setTheme] = useState<ChartTheme>(SKIFER_CLAIR);
  const [reload, setReload] = useState(0);
  // Après une suppression réussie (204), la fiche relit toujours la révision supprimée, courante ou numérotée : ce qu'elle montrait n'est plus vrai.
  const [deleted, setDeleted] = useState<number | null>(null);
  const wanted = revision ?? deleted ?? undefined;
  const found = useOutcome(`${space.id}:${id}:${wanted === undefined ? "courante" : String(wanted)}:${String(reload)}`, (signal) => (wanted === undefined ? fetchAnalysis(space.id, id, signal, fetcher) : fetchAnalysisRevision(space.id, id, wanted, signal, fetcher)));
  const back = routeHash({ page: "analyses", space: space.id });
  return <div className={`sb-analyses sb-theme-${theme.id}`}>
    <div className="sb-page-head">
      <div>
        <h1 className="sb-page-head__title">{found.status === "ok" ? found.value.analysis.name : "Analyse"}</h1>
        {found.status === "ok" && found.value.analysis.description !== "" ? <p className="sb-page-head__lead sb-analyses__description">{found.value.analysis.description}</p> : null}
      </div>
      <ThemeSwitch value={theme} onChange={setTheme} />
    </div>
    <p><a href={back}>Retour aux analyses</a></p>
    {found.status === "loading" ? <Reading>Lecture de l'analyse…</Reading>
      : found.status !== "ok" ? <Gone deleted={deleted !== null} outcome={found} back={back} />
      : <Fiche key={`${found.value.id}:${String(found.value.revision)}`} space={space} found={found.value} initialTab={view === "history" ? "revisions" : "requete"} compare={compare} fetcher={fetcher} onReload={() => { setReload((value) => value + 1); }} onDeleted={(deletedRevision) => { setDeleted(deletedRevision); setReload((value) => value + 1); }} />}
  </div>;
}

/** Lecture impossible. Après une suppression confirmée, la relecture peut être refusée (404 : une analyse supprimée n'est visible que de son propriétaire) : la suppression reste dite. */
function Gone({ deleted, outcome, back }: { deleted: boolean; outcome: Failed; back: string }) {
  if (!deleted) return <Unavailable outcome={outcome} title="Analyse indisponible" local="Les analyses ne sont pas disponibles en mode local." />;
  const hidden = outcome.status === "refused" && outcome.code === "analysis_not_found";
  return <>
    <Banner tone="neutral">Analyse supprimée.{hidden ? " Elle n'est plus visible que de son propriétaire." : " Sa relecture a échoué, l'ancien contenu n'est plus affiché."} <a href={back}>Retour aux analyses</a></Banner>
    {hidden ? null : <Unavailable outcome={outcome} title="Analyse indisponible" local="Les analyses ne sont pas disponibles en mode local." />}
  </>;
}

function Fiche({ space, found, initialTab, compare, fetcher, onReload, onDeleted }: { space: Space; found: AnalysisRevision; initialTab: TabId; compare: { base: number; other: number } | undefined; fetcher: Fetch; onReload: () => void; onDeleted: (revision: number) => void }) {
  const [tab, setTab] = useState<TabId>(initialTab);
  // Un identifiant neuf par affichage (une instance de la fiche pour une révision lue) ; le drapeau empêche un second envoi du même
  // affichage, au re-rendu comme sous StrictMode qui rejoue les effets sur la même instance.
  const [eventId] = useState(newEventId);
  const sent = useRef(false);
  const { id, revision, currentRevision } = found;
  useEffect(() => {
    // Une analyse supprimée n'est plus ouverte : aucun événement. L'échec de l'événement ne touche jamais l'écran, `openAnalysis` le rend comme un résultat.
    if (sent.current || currentRevision === null) return;
    sent.current = true;
    void openAnalysis(space.id, id, revision, eventId, fetcher);
  }, [space.id, id, revision, currentRevision, eventId, fetcher]);
  const { analysis, permissions } = found;
  const state = READ_STATE_LABELS[found.state];
  const current = found.currentRevision === found.revision;
  const past = found.currentRevision !== null && !current;
  return <>
    <Card title="Fiche">
      <p className="sb-analyses__badges"><Badge tone="neutral">{VISIBILITY_LABELS[analysis.visibility]}</Badge> <Badge tone={state.tone}>{state.label}</Badge></p>
      <p className="sb-members__state">{state.reason}</p>
      {found.state === "unresolved_reference" ? <Banner tone="danger">
        <p>Références que le catalogue ne confirme pas, montrées telles qu'enregistrées, avec la règle de chacune :</p>
        <ul>{found.unresolved.map((item) => <li key={item.path}>{RULE_LABELS[item.rule]} · <span className="sb-mono">{item.path}</span> · <span className="sb-mono">{JSON.stringify(valueAt(analysis, item.path))}</span></li>)}</ul>
      </Banner> : null}
      {found.currentRevision === null ? <Banner tone="neutral">Cette analyse est supprimée : son historique reste lisible, aucune action n'est possible.</Banner> : null}
      {past ? <Banner tone="neutral">Vous lisez la révision {found.revision} ; la révision courante est la {found.currentRevision}. <a href={routeHash({ page: "analysis", space: space.id, id: found.id })}>Lire la révision courante</a></Banner> : null}
      <dl className="sb-analyses__facts">
        <dt>Propriétaire</dt><dd>{permissions.owner ? "Vous" : analysis.owner.subject} <span className="sb-mono">({analysis.owner.issuer})</span></dd>
        <dt>Révision</dt><dd className="sb-mono">r{found.revision}{found.currentRevision === null ? "" : ` sur r${String(found.currentRevision)}`}</dd>
        <dt>Révisée par</dt><dd>{found.revisedBy.subject} <span className="sb-mono">({found.revisedBy.issuer})</span></dd>
        <dt>Provenance</dt><dd>commit <span className="sb-mono">{found.commit}</span> · {formatInstant(found.committedAt)}</dd>
        <dt>Identifiant stable</dt><dd className="sb-mono">{found.id}</dd>
      </dl>
      <Actions space={space} found={found} current={current} fetcher={fetcher} onReload={onReload} onDeleted={onDeleted} />
    </Card>
    <Tabs tab={tab} onChange={setTab} />
    {TABS.map((item) => <div key={item.id} role="tabpanel" id={`fiche-${item.id}`} aria-labelledby={`fiche-tab-${item.id}`} hidden={tab !== item.id} className="sb-analyses__panel">
      {tab !== item.id ? null : <Panel tab={item.id} space={space.id} found={found} compare={compare} fetcher={fetcher} />}
    </div>)}
  </>;
}

function Panel({ tab, space, found, compare, fetcher }: { tab: TabId; space: string; found: AnalysisRevision; compare: { base: number; other: number } | undefined; fetcher: Fetch }) {
  switch (tab) {
    case "requete": return <OngletRequete analysis={found.analysis} unresolved={found.unresolved} />;
    case "calculs": return <OngletCalculs analysis={found.analysis} />;
    case "presentation": return <OngletPresentation analysis={found.analysis} />;
    case "revisions": return <OngletRevisions space={space} id={found.id} compare={compare} fetcher={fetcher} />;
    case "consommateurs": return <OngletConsommateurs space={space} id={found.id} fetcher={fetcher} />;
    case "usage": return <OngletUsage space={space} id={found.id} fetcher={fetcher} />;
    case "preuves": return <OngletPreuves space={space} id={found.id} shown={found.revision} fetcher={fetcher} />;
  }
}

function Tabs({ tab, onChange }: { tab: TabId; onChange: (tab: TabId) => void }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = TABS.findIndex((item) => item.id === tab);
    const next = event.key === "ArrowRight" ? at + 1 : event.key === "ArrowLeft" ? at - 1 : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : null;
    if (next === null) return;
    const target = TABS[(next + TABS.length) % TABS.length] as (typeof TABS)[number];
    onChange(target.id);
    refs.current[target.id]?.focus();
    event.preventDefault();
  };
  return <div role="tablist" aria-label="Onglets de la fiche" className="sb-tabs sb-analyses__tabs" onKeyDown={onKey}>
    {TABS.map((item) => <button key={item.id} ref={(node) => { refs.current[item.id] = node; }} type="button" role="tab" id={`fiche-tab-${item.id}`} aria-controls={`fiche-${item.id}`} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} onClick={() => { onChange(item.id); }}>{item.label}</button>)}
  </div>;
}

type Pending = "duplicate" | "delete" | null;

/**
 * Actions offertes par `permissions` du serveur, jamais plus. Ouvrir et réviser mènent à l'Explorateur, où la révision se
 * prépare puis se confirme (18.5b) ; l'ouverture est refusée avec ses raisons quand l'Explorateur ne peut pas porter l'analyse.
 */
function Actions({ space, found, current, fetcher, onReload, onDeleted }: { space: Space; found: AnalysisRevision; current: boolean; fetcher: Fetch; onReload: () => void; onDeleted: (revision: number) => void }) {
  const [asking, setAsking] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [busy, setBusy] = useState<Pending>(null);
  const [failure, setFailure] = useState<Failed | null>(null);
  const announced = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (failure !== null) announced.current?.focus();
  }, [failure]);
  const { permissions } = found;
  const duplicate = () => {
    setBusy("duplicate");
    setFailure(null);
    void duplicateAnalysis(space.id, found.id, undefined, fetcher).then((outcome) => {
      setBusy(null);
      if (outcome.status === "ok") navigate({ page: "analysis", space: space.id, id: outcome.value.id });
      else setFailure(outcome);
    });
  };
  const remove = () => {
    setBusy("delete");
    setFailure(null);
    void deleteAnalysis(space.id, found.id, found.revision, fetcher).then((outcome) => {
      setBusy(null);
      setAsking(false);
      // Succès : la fiche relit la révision supprimée, qui dit l'état supprimé et n'offre plus rien.
      if (outcome.status === "ok") onDeleted(found.revision);
      else setFailure(outcome);
    });
  };
  const canDelete = permissions.delete && current;
  const blockers = openability(found);
  const explore = () => { navigate({ page: "explorer", space: space.id, analysis: current ? { id: found.id } : { id: found.id, revision: found.revision } }); };
  return <div className="sb-analyses__actions">
    <div className="sb-analyses__buttons">
      <button type="button" className="sb-button" disabled={blockers.length > 0} aria-describedby={blockers.length > 0 ? "fiche-ouvrir-raisons" : undefined} onClick={explore}>Ouvrir dans l'Explorateur</button>
      {found.currentRevision === null ? null : <button type="button" className="sb-button" onClick={() => { setPinning(true); }}>Épingler à un dashboard</button>}
      {permissions.revise && current ? <button type="button" className="sb-button" disabled={blockers.length > 0} aria-describedby={blockers.length > 0 ? "fiche-ouvrir-raisons" : undefined} onClick={explore}>Nouvelle révision</button> : null}
      {permissions.duplicate && current ? <button type="button" className="sb-button" disabled={busy !== null} onClick={duplicate}>Dupliquer</button> : null}
      {canDelete && !asking ? <button type="button" className="sb-button" disabled={busy !== null} onClick={() => { setAsking(true); }}>Supprimer</button> : null}
    </div>
    {pinning ? <EpinglerDashboard space={space.id} found={found} fetcher={fetcher} onClose={() => { setPinning(false); }} /> : null}
    {asking ? <Confirm question="Supprimer cette analyse ? Son historique reste dans le dépôt." action="Confirmer la suppression" busy={busy !== null} onConfirm={remove} onCancel={() => { setAsking(false); }} /> : null}
    {permissions.duplicate && !current && found.currentRevision !== null ? <p className="sb-members__state">Dupliquer copie la révision courante : ouvrez la révision courante pour dupliquer.</p> : null}
    {blockers.length === 0 ? <p className="sb-members__state">{permissions.revise && current ? "Une nouvelle révision se prépare dans l'Explorateur, puis se confirme avec son impact." : "L'Explorateur ouvre cette révision pour la poursuivre ; rien n'est enregistré sans votre confirmation."}</p>
      : <div id="fiche-ouvrir-raisons" className="sb-members__state"><p>Ouverture dans l'Explorateur indisponible :</p><ul>{blockers.map((reason) => <li key={reason}>{reason}</li>)}</ul></div>}
    {failure === null ? null : <div ref={announced} tabIndex={-1}>
      <Banner tone="danger" action={failure.status === "refused" && failure.code === "revision_conflict" ? <button type="button" className="sb-button" onClick={onReload}>Relire l'analyse</button> : undefined}>
        {failure.status === "refused" ? (failure.code === "analysis_in_use" ? refusalText(failure) : analysisRefusalText(failure)) : `Action non confirmée : ${failure.message}`}
      </Banner>
      {failure.status === "refused" && failure.code === "analysis_in_use" && failure.consumers !== undefined ? <ListeConsommateurs space={space.id} consumers={failure.consumers} others={failure.others as number} /> : null}
    </div>}
  </div>;
}
