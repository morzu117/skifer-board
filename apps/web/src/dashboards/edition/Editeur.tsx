import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent } from "react";

import type { ChartTheme } from "../../charts/theme";
import { fetchFields } from "../../explorer/client";
import { ThemeSwitch } from "../../prototype/ThemeSwitch";
import { routeHash } from "../../shell/route";
import { useExitGuard } from "../../shell/useExitGuard";
import type { Environment } from "../../shell/sections";
import type { Fetch } from "../../spaces/api";
import { Badge } from "../../ui/Badge";
import { Banner } from "../../ui/Banner";
import { Dialog } from "../../ui/Dialog";
import { useOutcome } from "../../ui/useOutcome";
import { reviseDashboard } from "../client";
import { executables } from "../document";
import { dashboardRefusalText } from "../Failure";
import { EDIT_REFUSAL_LABELS, READ_STATE_LABELS, VISIBILITY_LABELS } from "../labels";
import type { DashboardRevision } from "../model";
import { AjouterAnalyse } from "./AjouterAnalyse";
import { Apercu } from "./Apercu";
import { ConflitDashboard } from "./ConflitDashboard";
import { Canevas } from "./Canevas";
import { createHistory, dispatch, isDirty, redo, undo, type Command, type History } from "./commands";
import { PendingInputs } from "./Champs";
import { draftOf } from "./draft";
import { EditorContext, filterDomId, nodeDomId, type Editor } from "./EditorContext";
import { PanneauBas, type BottomTab } from "./PanneauBas";
import { Palette } from "./Palette";
import { dashboardProblems } from "./problems";
import { PROPS_TITLE_ID, Proprietes } from "./Proprietes";
import { buildTree } from "./tree";
import { useTiles } from "./useTiles";
import { effective, titleOf } from "./presentation";
import type { DashboardDraft } from "../document";

interface Props {
  space: string;
  historical?: boolean;
  identity: string;
  revision: DashboardRevision;
  environment: Environment;
  fetcher: Fetch;
  theme: ChartTheme;
  onTheme: (theme: ChartTheme) => void;
  /** Attente, en millisecondes, entre deux lectures d'une exécution en cours. */
  poll: number;
}

type Notice = { tone: "neutral" | "danger"; text: string };

/** Ce que le serveur dit de la révision enregistrée : son numéro, ses tuiles, son état et les droits de la personne. */
interface Stored {
  revision: number;
  tiles: DashboardRevision["tiles"];
  state: DashboardRevision["state"];
  permissions: DashboardRevision["permissions"];
}

const stored = (found: DashboardRevision): Stored => ({ revision: found.revision, tiles: found.tiles, state: found.state, permissions: found.permissions });

/**
 * L'éditeur d'un dashboard (plan 19, 19.5a) : barre d'outils, palette, mise en page, propriétés et panneau du bas. Le brouillon est
 * un historique du modèle d'édition : tout changement est une commande validée en entier, annulable, et ne part au serveur
 * qu'à l'enregistrement, avec la révision attendue. Un refus du serveur (dont le conflit de révision) se lit tel quel : rien n'est
 * écrasé et le brouillon reste ouvert.
 */
export function Editeur({ space, identity, revision, environment, fetcher, theme, onTheme, poll, historical = false }: Props) {
  const id = revision.id;
  const [history, setHistory] = useState<History<DashboardDraft>>(() => createHistory(draftOf(revision.dashboard)));
  const latest = useRef(history);
  const [server, setServer] = useState<Stored>(() => stored(revision));
  const [selected, setSelected] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [tab, setTab] = useState<BottomTab>("problems");
  const [addingAnalysis, setAddingAnalysis] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const focusLater = useRef<string | null>(null);
  const [, nudge] = useReducer((count: number) => count + 1, 0);
  const document_ = history.present;
  const dirty = isDirty(history);
  // Un champ dont la saisie n'est pas encore validée vers le document est un changement non enregistré : il compte pour la garde.
  const [typing, setTyping] = useState<ReadonlySet<string>>(() => new Set());
  const report = useCallback((key: string, pending: boolean): void => {
    setTyping((previous) => {
      if (previous.has(key) === pending) return previous;
      const next = new Set(previous);
      if (pending) next.add(key); else next.delete(key);
      return next;
    });
  }, []);
  const unsaved = dirty || typing.size > 0;
  const guard = useExitGuard(unsaved && (copied !== JSON.stringify(document_) || typing.size > 0));
  const readOnly = historical || !server.permissions.revise;

  const workContext = JSON.stringify([space, identity, environment, id]);
  const [work, setWork] = useState<{ context: string; values: Readonly<Record<string, unknown>> }>({ context: workContext, values: {} });
  if (work.context !== workContext) setWork({ context: workContext, values: {} });
  const values = work.context === workContext ? work.values : {};
  const fields = useOutcome(`${space}:${identity}:${environment}:champs`, (signal) => fetchFields(space, signal, fetcher));
  const tiles = useTiles({ space, dashboard: id, identity, environment, document: document_, tiles: server.tiles, catalog: fields, fetcher, poll, values });
  const catalog = fields.status === "ok" ? fields.value.models : null;

  const titles = useMemo(() => Object.fromEntries(executables(document_).map((component) => {
    const known = tiles.analyses[component.id];
    return [component.id, known === undefined ? component.presentation.title : titleOf(effective(component, known.pinned, document_.defaults))];
  })), [document_, tiles.analyses]);
  const tree = useMemo(() => buildTree(document_, titles), [document_, titles]);
  const problems = useMemo(() => dashboardProblems(document_, server.tiles, tiles.analyses, catalog), [document_, server.tiles, tiles.analyses, catalog]);
  const blocking = problems.filter((problem) => problem.severity === "blocking");

  // Le focus demandé par une commande est posé après le rendu : un nœud déplacé ou remonté a été remplacé dans le DOM.
  useEffect(() => {
    if (focusLater.current === null) return;
    globalThis.document.getElementById(focusLater.current)?.focus();
    focusLater.current = null;
  });
  const focusOn = (domId: string): void => { focusLater.current = domId; nudge(); };

  const commit = (next: History<DashboardDraft>): void => { latest.current = next; setHistory(next); };
  // Une annonce identique à la précédente n'est pas relue par les lecteurs d'écran : un espace insécable la distingue.
  const say = (text: string, refused = false): void => {
    if (refused) { setRefusal(text); return; }
    setRefusal(null);
    setAnnouncement((previous) => (previous === text ? `${text}\u00a0` : text));
  };

  const run: Editor["run"] = (command: Command, done, after) => {
    if (readOnly) { say("Le serveur n'accorde pas la modification de ce dashboard à votre compte.", true); return false; }
    const ids = after?.ids === undefined ? (after?.id === undefined ? undefined : [after.id]) : after.ids;
    let at = 0;
    const out = dispatch(latest.current, command, ids === undefined ? undefined : () => ids[at++] as string);
    if (!out.result.ok) {
      const { reason, detail } = out.result;
      say(`Refusé : ${[EDIT_REFUSAL_LABELS[reason], detail].filter((part) => part !== undefined).join(" ")}`, true);
      return false;
    }
    if (out.history === latest.current) { say("Aucun changement."); return true; }
    commit(out.history);
    if (after?.select !== undefined) setSelected(after.select);
    if (after?.focus !== undefined) focusOn(after.focus);
    say(typeof done === "string" ? done : done(buildTree(out.result.document, titles)));
    return true;
  };

  const reveal = (target: string): void => {
    if (target === "dashboard") {
      setSelected(null);
      focusOn(PROPS_TITLE_ID);
    } else if (document_.filters.some((filter) => filter.id === target)) {
      setTab("filters");
      focusOn(filterDomId(target));
    } else {
      setSelected(target);
      focusOn(nodeDomId(target));
    }
  };

  const save = (): void => {
    if (saveLock.current || readOnly || conflict || blocking.length > 0) return;
    if (!dirty) { setNotice({ tone: "neutral", text: "Rien à enregistrer : le dashboard est identique à la révision enregistrée." }); return; }
    saveLock.current = true;
    setSaving(true);
    setNotice(null);
    const sent = latest.current.present;
    void reviseDashboard(space, id, sent, server.revision, fetcher).then((outcome) => {
      saveLock.current = false;
      setSaving(false);
      if (outcome.status === "refused" && outcome.code === "revision_conflict") { setConflict(true); return; }
      if (outcome.status === "refused") { setNotice({ tone: "danger", text: dashboardRefusalText(outcome) }); return; }
      if (outcome.status === "error") { setNotice({ tone: "danger", text: `Enregistrement non confirmé : ${outcome.message} Rien ne dit que la révision existe : rouvrez le dashboard avant de recommencer.` }); return; }
      const found = outcome.value.revision;
      // Ce que le serveur garde est la référence du brouillon : des modifications faites pendant l'enregistrement restent non enregistrées.
      const kept = draftOf(found.dashboard);
      commit({ ...latest.current, saved: kept });
      setServer(stored(found));
      setNotice(JSON.stringify(kept) === JSON.stringify(sent)
        ? { tone: "neutral", text: outcome.value.unchanged ? "Contenu identique à la révision courante : aucune révision créée." : `Révision ${String(found.revision)} enregistrée.` }
        : { tone: "danger", text: `Le serveur a enregistré la révision ${String(found.revision)} avec un contenu différent de celui envoyé : vos modifications restent non enregistrées.` });
    });
  };

  const keys = (event: KeyboardEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement;
    if (!(event.ctrlKey || event.metaKey) || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    const key = event.key.toLowerCase();
    if (key === "a" && event.shiftKey && !readOnly && !addingAnalysis) { event.preventDefault(); setAddingAnalysis(true); }
    else if (key === "z" && !event.shiftKey) { event.preventDefault(); history_undo(); }
    else if ((key === "z" && event.shiftKey) || key === "y") { event.preventDefault(); history_redo(); }
  };
  const history_undo = (): void => {
    if (latest.current.past.length === 0) { say("Rien à annuler."); return; }
    commit(undo(latest.current));
    say("Dernière modification annulée.");
  };
  const history_redo = (): void => {
    if (latest.current.future.length === 0) { say("Rien à rétablir."); return; }
    commit(redo(latest.current));
    say("Modification rétablie.");
  };

  const editor: Editor = { document: document_, space, tree, selected, select: setSelected, run, say, readOnly, states: tiles.states, cancelTile: tiles.cancel, retryTile: tiles.retry, restartTile: tiles.restart, values, setValue: (filterId, value) => { setWork((previous) => ({ context: workContext, values: { ...previous.values, [filterId]: value } })); }, overlaps: tiles.overlaps, analyses: tiles.analyses, catalog, problems, settled: tiles.settled, theme, reveal };
  const read = READ_STATE_LABELS[server.state];
  const reason = blocking.length > 0 ? `${String(blocking.length)} problème${blocking.length > 1 ? "s" : ""} bloquant${blocking.length > 1 ? "s" : ""}` : null;
  return <EditorContext value={editor}><PendingInputs value={report}>
    {previewing ? <Apercu onClose={() => { setPreviewing(false); }} /> : null}
    <div className="sb-editor" onKeyDown={keys} hidden={previewing}>
      <div className="sb-page-head">
        <div>
          <h1 className="sb-page-head__title">{document_.name}</h1>
          <p className="sb-page-head__lead">
            {historical ? "Révision en lecture seule" : "Éditeur de dashboard"} · {VISIBILITY_LABELS[document_.visibility]} · révision {String(server.revision)}{" "}
            <Badge tone={read.tone}>{read.label}</Badge>
          </p>
        </div>
        <ThemeSwitch value={theme} onChange={onTheme} />
      </div>
      <p className="sb-editor__note">{read.reason}</p>
      {readOnly && !historical ? <Banner tone="warning">Le serveur n'accorde pas la modification de ce dashboard à votre compte : il s'ouvre en lecture seule, rien ne peut y être changé ni enregistré.</Banner> : null}
      {historical ? <p>Révision historique en lecture seule.</p> : <div role="toolbar" aria-label="Actions de l'éditeur" className="sb-toolbar">
        <button type="button" className="sb-button" disabled={history.past.length === 0} onClick={history_undo}>Annuler</button>
        <button type="button" className="sb-button" disabled={history.future.length === 0} onClick={history_redo}>Rétablir</button>
        <button type="button" className="sb-button" onClick={() => { setPreviewing(true); }}>Aperçu lecteur</button>
        <button type="button" className="sb-button sb-button--primary" disabled={saving || readOnly || conflict || reason !== null} aria-describedby="sb-save-state" onClick={save}>{saving ? "Enregistrement…" : "Enregistrer"}</button>
        <span id="sb-save-state" className="sb-toolbar__state">
          <span className={`sb-toolbar__dirty${unsaved ? " sb-toolbar__dirty--on" : ""}`} aria-hidden="true" />
          {unsaved ? "Modifications non enregistrées" : "Tout est enregistré"}
          {reason === null ? null : <> · Enregistrement impossible : {reason}. <button type="button" className="sb-problems__link" onClick={() => { setTab("problems"); focusOn("sb-bottom-tab-problems"); }}>Voir les problèmes</button></>}
        </span>
      </div>}
      <p><a href={routeHash({ page: "dashboard", space, id, view: "history" })}>Historique des révisions</a></p>
      {notice === null ? null : <Banner tone={notice.tone}>{notice.text}</Banner>}
      {conflict ? <ConflitDashboard space={space} id={id} opened={server.revision} draft={document_} fetcher={fetcher} onSaved={() => { setCopied(JSON.stringify(document_)); }} onReopen={(found) => { commit(createHistory(draftOf(found.dashboard))); setServer(stored(found)); setSelected(null); setConflict(false); setCopied(null); }} /> : null}
      {document_.visibility === "shared" && Object.values(tiles.analyses).some((known) => known?.pinned.analysis.visibility === "personal") ? <Banner tone="warning">Ce dashboard partagé référence une analyse personnelle : le serveur refusera son enregistrement.</Banner> : null}
      {refusal === null ? null : <Banner tone="danger">{refusal}</Banner>}
      <p className="sb-editor__announce" aria-live="polite" aria-atomic="true">{announcement}</p>
      <div className="sb-editor__grid">
        <div className="sb-editor__main">{historical ? null : <Palette onAddAnalysis={() => { setAddingAnalysis(true); }} />}<Canevas /></div>
        {historical ? null : <Proprietes />}
      </div>
      <PanneauBas tab={tab} onTab={setTab} />
      {addingAnalysis ? <AjouterAnalyse space={space} fetcher={fetcher} onClose={() => { setAddingAnalysis(false); }} /> : null}
    </div>
      {guard.pending === null ? null : <Dialog title="Quitter sans enregistrer ?" onClose={guard.stay}>
        <p>Ce dashboard a des modifications non enregistrées. Les quitter les perd : rien n'a été envoyé au serveur.</p>
        <div className="sb-dashboards__buttons">
          <button type="button" data-autofocus className="sb-button" onClick={guard.stay}>Rester</button>
          <button type="button" className="sb-button" onClick={guard.leave}>Quitter sans enregistrer</button>
        </div>
      </Dialog>}
  </PendingInputs></EditorContext>;
}

