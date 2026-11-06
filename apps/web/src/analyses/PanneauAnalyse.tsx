import { useEffect, useRef, useState, type ReactNode } from "react";
import { navigate, routeHash } from "../shell/route";
import { Reading } from "../spaces/AdminParts";
import type { Fetch } from "../spaces/api";
import { Banner } from "../ui/Banner";
import { useOutcome } from "../ui/useOutcome";
import { ApercuAnalyse } from "./ApercuAnalyse";
import { createAnalysis, fetchAnalysis, reviseAnalysis } from "./client";
import { VISIBILITIES, type Visibility } from "./document";
import { analysisRefusalText, Unavailable, type Failed } from "./Failure";
import type { Built, Meta, Opened } from "./explorer";
import { VIOLATION_LABELS, VISIBILITY_LABELS } from "./labels";
import type { AnalysisRevision } from "./model";

/** Ce que le panneau fait : sauvegarder une analyse neuve, la copier depuis une analyse ouverte, ou lui ajouter une révision. */
export type Mode = "create" | "copy" | "revise";

interface Props {
  mode: Mode;
  space: string;
  opened: Opened | null;
  /** Brouillon de l'état courant de l'Explorateur avec ces nom, description et visibilité (décodeur strict). */
  build: (meta: Meta) => Built;
  fetcher: Fetch;
  onClose: () => void;
  /** Une révision a été créée : l'Explorateur reconstruit sa référence ouverte à partir de ce que le serveur a renvoyé. */
  onRevised: (found: AnalysisRevision) => void;
  /** Le serveur a rendu `revision_conflict` pour la révision ouverte : l'Explorateur s'en souvient jusqu'à une réouverture ou une publication. */
  conflicted: boolean;
  onConflict: () => void;
}

const TITLES: Record<Mode, string> = { create: "Sauvegarder comme analyse", copy: "Dupliquer l'analyse", revise: "Nouvelle révision" };

/**
 * Formulaire de sauvegarde, de copie ou de révision depuis l'Explorateur (plan 18, 18.5b). Rien ne part sans l'aperçu ni, pour une
 * révision, sans l'écran d'impact. Le serveur reste juge des droits, de la révision attendue et du catalogue : ses refus se lisent tels quels.
 */
export function PanneauAnalyse(props: Props) {
  if (props.mode !== "revise" || props.opened === null) return <Formulaire {...props} gate={{ canRevise: false, blocked: null, current: null }} />;
  return <Relecture {...props} opened={props.opened}>{(gate) => <Formulaire {...props} gate={gate} />}</Relecture>;
}

interface Gate {
  canRevise: boolean;
  /** Pourquoi la révision n'est pas possible, ou `null`. */
  blocked: string | null;
  /** Numéro de la révision courante que le serveur a dite, ou `null` tant qu'on ne l'a pas lue. */
  current: number | null;
  /** Relit la révision courante pour en connaître le numéro (jamais pour l'adopter) ; rend l'échec de la lecture, ou `null`. */
  lookup?: () => Promise<Failed | null>;
}

/** Relit la révision courante et ses droits avant toute révision : les droits viennent du serveur, jamais du rôle. */
function Relecture({ space, opened, fetcher, onClose, children }: Props & { opened: Opened; children: (gate: Gate) => ReactNode }) {
  const current = useOutcome(`${space}:${opened.id}:relecture`, (signal) => fetchAnalysis(space, opened.id, signal, fetcher));
  // Après un conflit, la révision relue n'est jamais adoptée : elle ne sert qu'à dire laquelle est courante. La révision ouverte reste celle de l'Explorateur.
  const [latest, setLatest] = useState<AnalysisRevision | null>(null);
  const lookup = () => fetchAnalysis(space, opened.id, new AbortController().signal, fetcher).then((outcome) => {
    if (outcome.status !== "ok") return outcome;
    setLatest(outcome.value);
    return null;
  });
  if (current.status === "loading") return <Reading>Relecture de la révision courante et des droits…</Reading>;
  if (current.status !== "ok") return <>
    <Unavailable outcome={current} title="Révision courante indisponible" local="Les analyses ne sont pas disponibles en mode local." />
    <button type="button" className="sb-button" onClick={onClose}>Fermer</button>
  </>;
  const found = latest ?? current.value;
  const blocked = !found.permissions.revise ? "Le serveur n'accorde pas la révision de cette analyse à votre compte."
    : found.revision !== opened.revision ? `Une autre révision a été enregistrée entre-temps : la révision courante est la ${String(found.revision)}, vous explorez la ${String(opened.revision)}.`
    : null;
  return <>{children({ canRevise: blocked === null, blocked, current: found.revision, lookup })}</>;
}

interface Done {
  kind: "created" | "revised" | "unchanged";
  id: string;
  revision: number;
}

function Formulaire({ mode, space, opened, build, fetcher, onClose, onRevised, conflicted, onConflict, gate: read }: Props & { gate: Gate }) {
  const [name, setName] = useState(() => (mode === "revise" && opened !== null ? opened.name : mode === "copy" && opened !== null ? `Copie de ${opened.name}`.slice(0, 120) : ""));
  const [description, setDescription] = useState(() => (opened !== null && mode !== "create" ? opened.description : ""));
  const [visibility, setVisibility] = useState<Visibility>(() => (mode === "revise" && opened !== null ? opened.visibility : "personal"));
  const [choice, setChoice] = useState<"revision" | "copy">("revision");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [failure, setFailure] = useState<Failed | null>(null);
  const inflight = useRef(false);
  const announced = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => { if (failure !== null) announced.current?.focus(); }, [failure]);
  const meta: Meta = { name, description, visibility };
  const built = build(meta);
  // Après un conflit, plus aucune écriture de révision tant que l'analyse n'est pas rouverte, que la relecture soit en cours, réussie ou en échec.
  const gate: Gate = conflicted ? { ...read, canRevise: false, blocked: read.blocked ?? "Le serveur a refusé la révision : une autre révision a été enregistrée entre-temps." } : read;
  const revising = mode === "revise" && gate.canRevise && choice === "revision";
  const conflict = conflicted;
  const finished = done !== null;
  const save = () => {
    // Un second clic pendant l'écriture ne la double jamais : le verrou est posé avant tout rendu.
    if (inflight.current || built.status !== "ok" || finished) return;
    inflight.current = true;
    setBusy(true);
    setFailure(null);
    const write = revising && opened !== null
      ? reviseAnalysis(space, opened.id, built.draft, opened.revision, fetcher).then((outcome): Failed | Done => {
        if (outcome.status !== "ok") {
          if (outcome.status === "refused" && outcome.code === "revision_conflict") onConflict();
          return outcome;
        }
        if (!outcome.value.unchanged) onRevised(outcome.value.revision);
        return { kind: outcome.value.unchanged ? "unchanged" : "revised", id: outcome.value.revision.id, revision: outcome.value.revision.revision };
      })
      : createAnalysis(space, built.draft, fetcher).then((outcome): Failed | Done => (outcome.status === "ok" ? { kind: "created", id: outcome.value.id, revision: outcome.value.revision } : outcome));
    void write.then((result) => {
      inflight.current = false;
      setBusy(false);
      if ("kind" in result) setDone(result);
      else setFailure(result);
    });
  };
  // Une autre révision est courante : celle du conflit, ou celle que la relecture des droits a vue.
  const divergent = mode === "revise" && !finished && (conflict || (gate.current !== null && opened !== null && gate.current !== opened.revision));
  return <div role="group" aria-label={TITLES[mode]} className="sb-analyses__panneau">
    <h3 ref={heading} tabIndex={-1}>{TITLES[mode]}</h3>
    {mode === "copy" ? <p className="sb-members__state">Crée une analyse indépendante à partir de ce que vous explorez maintenant, modifications non sauvegardées comprises : ce n'est pas la copie de la révision enregistrée que fait « Dupliquer » sur la fiche.</p> : null}
    {mode === "revise" && !finished ? <Impact opened={opened as Opened} gate={gate} choice={choice} onChoice={setChoice} /> : null}
    <div className="sb-executions__form">
      <label className="sb-field">Nom de l'analyse<input className="sb-input" value={name} disabled={finished} onChange={(event) => { setName(event.target.value); }} /></label>
      <label className="sb-field">Description<textarea className="sb-input" value={description} disabled={finished} rows={3} onChange={(event) => { setDescription(event.target.value); }} /></label>
      <fieldset className="sb-explorer__filtre"><legend>Visibilité</legend>
        {VISIBILITIES.map((item) => <label key={item} className="sb-explorer__choix"><input type="radio" name="visibilite-analyse" value={item} checked={visibility === item} disabled={finished} onChange={() => { setVisibility(item); }} /> {VISIBILITY_LABELS[item]}</label>)}
        <small>{visibility === "shared" ? "Partagée : lisible par les membres de l'espace." : "Personnelle : visible de vous seul."}</small>
      </fieldset>
    </div>
    {built.status === "ok" ? <ApercuAnalyse draft={built.draft} unsaved={built.unsaved} /> : <p className="sb-members__state">Aperçu indisponible : {built.reason}</p>}
    {failure === null ? null : <div ref={announced} tabIndex={-1}>
      <Banner tone="danger">
        {failure.status === "refused" ? analysisRefusalText(failure) : `Action non confirmée : ${failure.message}`}
        {failure.status === "refused" && failure.violations !== undefined ? <ul>{failure.violations.map((violation) => <li key={`${violation.path}:${violation.rule}`}><span className="sb-mono">{violation.path === "" ? "(document)" : violation.path}</span> · {VIOLATION_LABELS[violation.rule]}</li>)}</ul> : null}
      </Banner>
    </div>}
    {!divergent ? null : <Divergence space={space} opened={opened as Opened} current={gate.current} lookup={conflict ? gate.lookup : undefined} onCopy={() => { setChoice("copy"); setFailure(null); }} />}
    {done === null ? null : <Banner tone="neutral">
      {done.kind === "created" ? "Analyse sauvegardée." : done.kind === "revised" ? `Révision ${String(done.revision)} enregistrée.` : "Contenu identique, aucune révision créée."}{" "}
      <a href={routeHash({ page: "analysis", space, id: done.id, ...(done.kind === "revised" ? { view: "history" as const } : {}) })}>{done.kind === "revised" ? "Voir les révisions dans la fiche" : "Ouvrir la fiche"}</a>
    </Banner>}
    <div className="sb-analyses__buttons">
      <button type="button" className="sb-button sb-button--primary" disabled={busy || finished || built.status !== "ok"} onClick={save}>{revising ? "Enregistrer la nouvelle révision" : mode === "create" ? "Sauvegarder l'analyse" : "Enregistrer la copie"}</button>
      <button type="button" className="sb-button" disabled={busy} onClick={onClose}>{finished ? "Fermer" : "Annuler"}</button>
    </div>
  </div>;
}

function Impact({ opened, gate, choice, onChoice }: { opened: Opened; gate: Gate; choice: "revision" | "copy"; onChoice: (choice: "revision" | "copy") => void }) {
  return <section aria-label="Impact de la révision" className="sb-analyses__impact">
    <h4>Impact</h4>
    <dl className="sb-analyses__facts">
      <dt>Révision courante remplacée</dt><dd>r{opened.currentRevision} de « {opened.name} » ; elle reste lisible dans l'historique.</dd>
      <dt>Consommateurs</dt><dd>Indisponible : aucune route ne lit les consommateurs avant le lot 07.</dd>
    </dl>
    {gate.blocked === null ? null : <Banner tone="warning">{gate.blocked} Une nouvelle révision n'est pas possible depuis cette exploration.</Banner>}
    <fieldset className="sb-explorer__filtre"><legend>Que faire de l'exploration</legend>
      <label className="sb-explorer__choix"><input type="radio" name="impact-analyse" checked={choice === "revision" && gate.canRevise} disabled={!gate.canRevise} onChange={() => { onChoice("revision"); }} /> Nouvelle révision de l'analyse</label>
      <label className="sb-explorer__choix"><input type="radio" name="impact-analyse" checked={choice === "copy" || !gate.canRevise} onChange={() => { onChoice("copy"); }} /> Copie indépendante : une nouvelle analyse, l'originale reste telle quelle</label>
    </fieldset>
  </section>;
}

/**
 * Une autre révision est courante. Enregistrer par-dessus effacerait ses changements sans les avoir montrés (A3) : cela n'est jamais
 * offert. Deux issues seulement : une copie indépendante avec le brouillon, ou rouvrir la révision courante en abandonnant le brouillon.
 * Le diff entre les deux est celui du serveur, dans l'onglet Révisions de la fiche ; le web n'en calcule aucun.
 */
function Divergence({ space, opened, current, lookup, onCopy }: { space: string; opened: Opened; current: number | null; lookup: (() => Promise<Failed | null>) | undefined; onCopy: () => void }) {
  const [asking, setAsking] = useState(false);
  const [lookupFailure, setLookupFailure] = useState<Failed | null>(null);
  const [looking, setLooking] = useState(lookup !== undefined);
  useEffect(() => {
    // Après un conflit, le numéro de la révision courante vient d'une relecture ; elle n'est pas adoptée.
    if (lookup === undefined) return;
    void lookup().then((failed) => { setLooking(false); setLookupFailure(failed); });
    // Une seule relecture par conflit : `lookup` change à chaque rendu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Tant que la relecture n'a pas dit quelle révision est courante, on ne la nomme pas et on n'offre pas de l'ouvrir.
  const known = current !== null && current !== opened.revision ? current : null;
  const label = known === null ? "la révision courante" : `la révision courante (r${String(known)})`;
  const reopen = () => { navigate({ page: "explorer", space, analysis: { id: opened.id, revision: known as number } }); };
  return <section aria-label="Révision courante différente" className="sb-analyses__impact">
    <h4>Une autre révision est courante</h4>
    {looking ? <Reading>Lecture de la révision courante…</Reading> : null}
    {lookupFailure === null ? null : <Unavailable outcome={lookupFailure} title="Révision courante indisponible" local="Les analyses ne sont pas disponibles en mode local." />}
    <p className="sb-members__state">Vous explorez la révision {opened.revision}. Enregistrer par-dessus {label} effacerait ses changements sans que vous les ayez vus : ce n'est pas offert. Deux issues seulement.</p>
    <div className="sb-analyses__buttons">
      <button type="button" className="sb-button" onClick={onCopy}>Copie indépendante</button>
      {known === null ? null : <button type="button" className="sb-button" onClick={() => { setAsking(true); }}>{`Ouvrir ${label}`}</button>}
    </div>
    {!asking ? null : <div role="group" aria-label="Abandonner le brouillon" className="sb-confirm">
      <span className="sb-confirm__question">Ouvrir {label} abandonne votre brouillon : vous réappliquerez vos changements à la main. Faites d'abord une copie indépendante si vous voulez le garder.</span>
      <button type="button" className="sb-button" onClick={() => { setAsking(false); onCopy(); }}>Faire d'abord une copie indépendante</button>
      <button type="button" className="sb-button sb-button--primary" onClick={reopen}>Abandonner le brouillon et ouvrir</button>
      <button type="button" className="sb-button" onClick={() => { setAsking(false); }}>Annuler</button>
    </div>}
    <p><a href={routeHash({ page: "analysis", space, id: opened.id, view: "history", ...(known === null ? {} : { compare: { base: opened.revision, other: known } }) })} target="_blank" rel="noopener noreferrer">Voir ce qui a changé (onglet Révisions de la fiche, dans un nouvel onglet, le brouillon reste ici)</a></p>
  </section>;
}
