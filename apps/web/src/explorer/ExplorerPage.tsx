import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Table } from "apache-arrow";
import { EtatResultat } from "./EtatResultat";
import type { ExplorerGenre } from "../analyses/chart";
import { BandeauAnalyse } from "../analyses/BandeauAnalyse";
import { draftFromExplorer, fingerprint, openedFrom, saveRight, type ExplorerState, type Meta, type Opened } from "../analyses/explorer";
import { OuvertureAnalyse, type Opening } from "../analyses/OuvertureAnalyse";
import { PanneauAnalyse, type Mode } from "../analyses/PanneauAnalyse";
import type { ExecutionInput } from "../executions/client";
import type { Execution } from "../executions/model";
import { SKIFER_CLAIR, type ChartTheme } from "../charts/theme";
import { ThemeSwitch } from "../prototype/ThemeSwitch";
import type { Environment } from "../shell/sections";
import { ReadFailure, Reading } from "../spaces/AdminParts";
import { REFUSAL_LABELS, type AdminOutcome } from "../spaces/admin";
import type { Fetch } from "../spaces/api";
import type { Space } from "../spaces/model";
import { Banner } from "../ui/Banner";
import { Card } from "../ui/Card";
import { useOutcome } from "../ui/useOutcome";
import { cancelExecution, fetchExecution, fetchExplorerConnections, fetchFields, fetchResult, submitExecution } from "./client";
import { buildExecution, OPERATORS } from "./filters";
import { genreInitial } from "./Resultat";
import type { ExplorerModel } from "./model";
import "../executions/executions.css";
import "../catalogue/catalogue.css";
import "./explorer.css";

interface Props { space: Space; target: Environment; analysis?: { id: string; revision?: number | undefined } | undefined; fetcher: Fetch }
type Filtre = ExecutionInput["filters"][number];

export function ExplorerPage({ space, target, analysis, fetcher }: Props) {
  const connexions = useOutcome(`${space.id}:connexions`, (signal) => fetchExplorerConnections(space.id, signal, fetcher));
  const champs = useOutcome(`${space.id}:champs`, (signal) => fetchFields(space.id, signal, fetcher));
  const [theme, setTheme] = useState<ChartTheme>(SKIFER_CLAIR);
  return <div className={`sb-executions sb-explorer sb-theme-${theme.id}`}>
    <div className="sb-page-head"><h1 className="sb-page-head__title">Explorer</h1><ThemeSwitch value={theme} onChange={setTheme} /></div>
    {connexions.status === "loading" || champs.status === "loading" ? <Reading>Chargement des champs et connexions…</Reading> :
      connexions.status === "refused" && connexions.code === "local_mode" ? <Banner tone="neutral">L’exploration n’est pas disponible en mode local.</Banner> :
      connexions.status !== "ok" ? <ReadFailure outcome={connexions} title="Connexions indisponibles" /> :
      champs.status === "refused" && champs.code === "local_mode" ? <Banner tone="neutral">L’exploration n’est pas disponible en mode local.</Banner> :
      champs.status === "error" && champs.message.includes("catalogue vide") ? <Banner tone="neutral">Le catalogue ne contient aucun modèle.</Banner> :
      champs.status !== "ok" ? <ReadFailure outcome={champs} title="Catalogue indisponible" /> :
      connexions.value.length === 0 ? <Banner tone="neutral">Aucune connexion dans cet espace.</Banner> :
      analysis === undefined ? <Editeur key={`${space.id}:${target}`} space={space.id} target={target} fetcher={fetcher} theme={theme} connexions={connexions.value} models={champs.value.models} rights={saveRight(space)} opening={null} />
      : <OuvertureAnalyse space={space.id} analysis={analysis} catalog={{ connections: connexions.value, models: champs.value.models }} fetcher={fetcher}>
        {(opening) => <Editeur key={`${space.id}:${target}:${analysis.id}:${analysis.revision === undefined ? "courante" : String(analysis.revision)}`} space={space.id} target={target} fetcher={fetcher} theme={theme} connexions={connexions.value} models={champs.value.models} rights={saveRight(space)} opening={opening} />}
      </OuvertureAnalyse>}
  </div>;
}

function Editeur({ space, target, fetcher, theme, connexions, models, rights, opening }: { space: string; target: Environment; fetcher: Fetch; theme: ChartTheme; connexions: readonly string[]; models: readonly ExplorerModel[]; rights: ReturnType<typeof saveRight>; opening: Opening | null }) {
  const [connection, setConnection] = useState(opening === null ? connexions[0] as string : opening.state.connection);
  const [modelName, setModelName] = useState(opening === null ? (models[0] as ExplorerModel).name : opening.state.model);
  const [search, setSearch] = useState("");
  const [metrics, setMetrics] = useState<string[]>(opening === null ? [] : [...opening.state.metrics]);
  const [dimensions, setDimensions] = useState<string[]>(opening === null ? [] : [...opening.state.dimensions]);
  const [filters, setFilters] = useState<Filtre[]>(opening === null ? [] : [...opening.state.filters]);
  const [column, setColumn] = useState("");
  const [operator, setOperator] = useState<Filtre["operator"]>("eq");
  const [value, setValue] = useState("");
  const [second, setSecond] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [run, setRun] = useState<Execution | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Exclude<AdminOutcome<unknown>, { status: "ok" }> | null>(null);
  const [suiviInterrompu, setSuiviInterrompu] = useState<Exclude<AdminOutcome<unknown>, { status: "ok" }> | null>(null);
  const [result, setResult] = useState<Table | null>(null);
  const [soumis, setSoumis] = useState<{ input: ExecutionInput; model: ExplorerModel } | null>(null);
  // Analyse ouverte (plan 18, 18.5b) : la révision d'où part l'exploration, le genre montré, les calculs et le panneau de sauvegarde.
  const [opened, setOpened] = useState<Opened | null>(opening === null ? null : opening.opened);
  // Le détachement est durable : changer de modèle ou détacher à la main ne se défait pas en revenant en arrière. Seules la réouverture par l'API ou une publication réussie rétablissent une référence.
  const [detached, setDetached] = useState<"model" | "explicit" | null>(null);
  const [calculs, setCalculs] = useState(opening === null ? false : opening.state.calculs);
  const [depart, setDepart] = useState<ExplorerGenre | undefined>(opening === null ? undefined : opening.state.genre);
  const [genreMontre, setGenreMontre] = useState<ExplorerGenre | null>(null);
  const [panneau, setPanneau] = useState<Mode | null>(null);
  // Un `revision_conflict` rendu pour la révision ouverte : plus aucune révision ne part de cette ouverture, panneau fermé puis rouvert compris.
  const [conflicted, setConflicted] = useState(false);
  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; }, []);
  const model = models.find((item) => item.name === modelName) as ExplorerModel;
  const dimension = model.dimensions.find((item) => item.name === column);
  const state: ExplorerState = { connection, model: modelName, metrics, dimensions, filters, calculs, genre: genreMontre ?? depart ?? genreInitial({ connection, environment: target, model: modelName, metrics, dimensions, filters }, model) };
  const build = (meta: Meta) => draftFromExplorer(state, meta, models);
  const linked = opened !== null && detached === null && modelName === opened.model;
  const modified = opened !== null && fingerprint(build(opened)) !== opened.baseline;
  useEffect(() => {
    if (suiviInterrompu !== null || run === null || (run.state !== "queued" && run.state !== "running")) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => { void fetchExecution(space, run.id, controller.signal, fetcher).then((answer) => {
      if (!controller.signal.aborted) { if (answer.status === "ok") setRun(answer.value); else setSuiviInterrompu(answer); }
    }, () => undefined); }, 1000);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [run, space, fetcher, suiviInterrompu]);
  useEffect(() => {
    if (run?.state !== "succeeded") return;
    const controller = new AbortController();
    void fetchResult(space, run, controller.signal, fetcher).then((answer) => { if (!controller.signal.aborted) { if (answer.status === "ok") setResult(answer.value); else setFailure(answer); } }, () => undefined);
    return () => { controller.abort(); };
  }, [run, space, fetcher]);
  const reset = () => { generation.current += 1; setBusy(false); setMetrics([]); setDimensions([]); setFilters([]); setColumn(""); setOperator("eq"); setValue(""); setSecond(""); setRun(null); setResult(null); setSoumis(null); setProblem(null); setFailure(null); setSuiviInterrompu(null); setGenreMontre(null); };
  const toggle = (name: string, selected: string[], set: (value: string[]) => void) => { set(selected.includes(name) ? selected.filter((item) => item !== name) : [...selected, name]); };
  const addFilter = (dimension: ExplorerModel["dimensions"][number]) => {
    const scalar = (raw: string): string | number | boolean => dimension.type === "number" ? (raw.trim() === "" ? NaN : Number(raw)) : dimension.type === "boolean" ? raw === "true" : raw;
    if (dimension.type === "boolean" && value === "") { setProblem("Choisissez une valeur booléenne."); return; }
    const parsed = operator === "in" ? value.split(",").map((item) => scalar(item.trim())) : operator === "between" ? [scalar(value), scalar(second)] : scalar(value);
    const next = [...filters, { column, operator, value: parsed }];
    try { buildExecution({ connection, environment: target, model: model.name, metrics: metrics.length ? metrics : [model.metrics[0]?.name ?? ""], dimensions, filters: next }, model); setFilters(next); setProblem(null); }
    catch { setProblem("Vérifiez la valeur et les bornes du filtre."); }
  };
  const submit = () => {
    let input: ExecutionInput;
    try { input = buildExecution({ connection, environment: target, model: model.name, metrics, dimensions, filters }, model); }
    catch { setProblem("Choisissez une connexion et au moins une métrique, puis vérifiez les filtres."); return; }
    // Les exécutions portent la référence tant que le modèle est celui de l'analyse ouverte ; sinon elles partent sans, et le bandeau le dit.
    if (linked) input = { ...input, analysis: { id: opened.id, revision: opened.revision } };
    setProblem(null); setFailure(null); setResult(null); setSoumis({ input, model }); setRun(null); setBusy(true);
    const current = ++generation.current;
    void submitExecution(space, input, fetcher).then((answer) => { if (current !== generation.current) return; setBusy(false); if (answer.status === "ok") setRun(answer.value); else setFailure(answer); });
  };
  const cancel = (execution: Execution) => { setBusy(true); const current = generation.current; void cancelExecution(space, execution.id, fetcher).then((answer) => { if (current !== generation.current) return; setBusy(false); if (answer.status === "ok") setRun(answer.value); else setFailure(answer); }); };
  const toucheRecherche = (event: KeyboardEvent<HTMLInputElement>) => { if (event.key === "Enter") event.preventDefault(); };
  const toucheFiltre = (event: KeyboardEvent<HTMLInputElement>, champ: ExplorerModel["dimensions"][number]) => { if (event.key === "Enter") { event.preventDefault(); addFilter(champ); } };
  const visible = (item: { label: string; description: string; name: string }) => `${item.label} ${item.description} ${item.name}`.toLocaleLowerCase().includes(search.toLocaleLowerCase());
  return <>
    {opened === null ? null : <BandeauAnalyse space={space} opened={opened} modified={modified} linked={linked} detached={detached} onDetach={() => { setDetached("explicit"); }} />}
  <form onSubmit={(event) => { event.preventDefault(); }}>
    <Card title="Champs">
      <div className="sb-executions__form">
        <label className="sb-field">Connexion<select className="sb-input" value={connection} onChange={(e) => { setConnection(e.target.value); }}>{connexions.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="sb-field">Modèle<select className="sb-input" value={modelName} onChange={(e) => { setModelName(e.target.value); setDetached((current) => current ?? "model"); reset(); }}>{models.map((item) => <option key={item.name} value={item.name}>{item.label}</option>)}</select></label>
        <label className="sb-field">Rechercher un champ<input className="sb-input" value={search} onChange={(e) => { setSearch(e.target.value); }} onKeyDown={toucheRecherche} /></label>
      </div>
      <h3>Métriques</h3>{model.metrics.filter(visible).map((item) => <p key={item.name}><label className="sb-explorer__choix"><input type="checkbox" checked={metrics.includes(item.name)} onChange={() => { toggle(item.name, metrics, setMetrics); }} /> {item.label} · {item.aggregation ?? "type inconnu"} — {item.description}</label></p>)}
      <h3>Dimensions</h3>{model.dimensions.filter(visible).map((item) => <p key={item.name}><label className="sb-explorer__choix"><input type="checkbox" checked={dimensions.includes(item.name)} onChange={() => { toggle(item.name, dimensions, setDimensions); }} /> {item.label} · {item.type} — {item.description}</label>{item.type === "date" || item.type === "timestamp" ? " · Filtre temporel indisponible : le moteur ne prend pas encore en charge ces valeurs (SK-12)." : null}</p>)}
    </Card>
    <Card title="Requête">
      <p>Environnement : {target}. Limite : 1 000 lignes et 1 048 576 octets.</p>
      <p>Métriques retenues : {metrics.map((name) => <button type="button" className="sb-button" key={name} onClick={() => { toggle(name, metrics, setMetrics); }}>Retirer {model.metrics.find((item) => item.name === name)?.label || name}</button>)}</p>
      <p>Dimensions retenues : {dimensions.map((name) => <button type="button" className="sb-button" key={name} onClick={() => { toggle(name, dimensions, setDimensions); }}>Retirer {model.dimensions.find((item) => item.name === name)?.label || name}</button>)}</p>
      <fieldset className="sb-explorer__filtre"><legend>Ajouter un filtre</legend>
        <label className="sb-field">Dimension du filtre<select className="sb-input" value={column} onChange={(e) => { setColumn(e.target.value); setOperator("eq"); }}><option value="">Choisir</option>{model.dimensions.filter((item) => OPERATORS[item.type].length > 0).map((item) => <option key={item.name} value={item.name}>{item.label}</option>)}</select></label>
        {dimension === undefined ? null : <><label className="sb-field">Opérateur<select className="sb-input" value={operator} onChange={(e) => { setOperator(e.target.value as Filtre["operator"]); }}>{OPERATORS[dimension.type].map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label className="sb-field">Valeur{operator === "in" ? " (séparées par des virgules)" : ""}{dimension.type === "boolean" ? <select className="sb-input" value={value} onChange={(e) => { setValue(e.target.value); }}><option value="">Choisir</option><option value="true">Vrai</option><option value="false">Faux</option></select> : <input className="sb-input" value={value} onChange={(e) => { setValue(e.target.value); }} onKeyDown={(event) => { toucheFiltre(event, dimension); }} />}</label>
          {operator === "between" ? <label className="sb-field">Borne supérieure<input className="sb-input" value={second} onChange={(e) => { setSecond(e.target.value); }} onKeyDown={(event) => { toucheFiltre(event, dimension); }} /></label> : null}
          <button type="button" className="sb-button" onClick={() => { addFilter(dimension); }}>Ajouter le filtre</button></>}
      </fieldset>
      {filters.map((filter, index) => <p key={`${filter.column}:${String(index)}`}>{filter.column} {filter.operator} {String(filter.value)} <button type="button" className="sb-button" onClick={() => { setFilters(filters.filter((_, i) => i !== index)); }}>Retirer le filtre {filter.column}</button></p>)}
      {problem === null ? null : <p role="alert">{problem}</p>}
      <button type="button" onClick={submit} className="sb-button sb-button--primary" disabled={busy || run?.state === "queued" || run?.state === "running"}>Exécuter</button>{" "}
      {run !== null && (run.state === "queued" || run.state === "running") && run.canCancel && suiviInterrompu === null ? <button type="button" className="sb-button" disabled={busy} onClick={() => { cancel(run); }}>Annuler l'exécution</button> : null}{" "}
      <button type="button" className="sb-button" onClick={reset}>Réinitialiser</button>
      {run !== null && (run.state === "queued" || run.state === "running") && !run.canCancel && !run.cancelRequested ? <p role="status">L’annulation n’est pas disponible pour cette exécution : la capacité du connecteur ou son état courant ne le permet pas.</p> : null}
      {suiviInterrompu === null ? null : <p role="status">L’annulation est indisponible pendant l’interruption du suivi. Reprenez le suivi pour connaître l’état de l’exécution.</p>}
    </Card>
    <Card title="Analyse" className="sb-explorer__analyse">
      <label className="sb-explorer__choix"><input type="checkbox" checked={calculs} onChange={(e) => { setCalculs(e.target.checked); }} /> Enregistrer comme calculs contextuels, pour chaque métrique, le total de la sélection courante et sa part du résultat chargé : les deux calculs du bloc « Sélection personnelle » du résultat</label>
      <div className="sb-analyses__buttons">
        <button type="button" className="sb-button" disabled={!rights.allowed} aria-describedby={rights.allowed ? undefined : "explorer-analyse-droit"} onClick={() => { setPanneau("create"); }}>Sauvegarder comme analyse</button>
        {opened !== null && opened.permissions.duplicate ? <button type="button" className="sb-button" disabled={!rights.allowed} aria-describedby={rights.allowed ? undefined : "explorer-analyse-droit"} onClick={() => { setPanneau("copy"); }}>Dupliquer</button> : null}
        {opened !== null && opened.permissions.revise && opened.revision === opened.currentRevision ? <button type="button" className="sb-button" onClick={() => { setPanneau("revise"); }}>Nouvelle révision</button> : null}
      </div>
      {rights.allowed ? null : <p id="explorer-analyse-droit" className="sb-members__state">{rights.reason}</p>}
      {panneau === null ? null : <PanneauAnalyse key={panneau} mode={panneau} space={space} opened={opened} build={build} fetcher={fetcher}
        onClose={() => { setPanneau(null); }}
        conflicted={conflicted} onConflict={() => { setConflicted(true); }}
        onRevised={(found) => { setOpened(openedFrom({ ...found, currentRevision: found.revision }, state, models)); setDetached(null); setConflicted(false); setDepart(state.genre); }} />}
    </Card>
    {suiviInterrompu === null ? <EtatResultat run={run} result={result} submitted={soumis} busy={busy} failure={failure} theme={theme} fetcher={fetcher} depart={depart} onGenre={setGenreMontre} /> : <div className="sb-banner sb-banner--warning" role="status"><div>Suivi interrompu : {suiviInterrompu.status === "refused" ? REFUSAL_LABELS[suiviInterrompu.code] : suiviInterrompu.message} L’état réel de l’exécution est inconnu. Exécution : {run?.id}. <button type="button" className="sb-button" onClick={() => { setSuiviInterrompu(null); }}>Reprendre le suivi</button></div></div>}
  </form>
  </>;
}
