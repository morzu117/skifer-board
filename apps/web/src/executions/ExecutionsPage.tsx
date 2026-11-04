import { useState, type SyntheticEvent } from "react";
import type { Table } from "apache-arrow";
import { formatInstant } from "../format/date";
import { formatNumber } from "../format/number";
import { routeHash } from "../shell/route";
import type { Environment } from "../shell/sections";
import { ReadFailure, Reading } from "../spaces/AdminParts";
import type { AdminOutcome } from "../spaces/admin";
import type { Fetch } from "../spaces/api";
import { CONNECTION_NAME } from "../spaces/connections";
import { manages, type Space } from "../spaces/model";
import { Badge, type BadgeTone } from "../ui/Badge";
import { Banner } from "../ui/Banner";
import { Card } from "../ui/Card";
import { useOutcome } from "../ui/useOutcome";
import { cancelExecution, fetchExecution, fetchExecutions, fetchResult, submitExecution, type ExecutionInput } from "./client";
import type { Execution, ExecutionState } from "./model";
import "./executions.css";

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const LABELS: Record<ExecutionState, string> = {
  queued: "En attente", running: "En cours", succeeded: "Réussie", denied: "Refusée",
  failed: "Échouée", timed_out: "Délai dépassé", cancelled: "Annulée",
};
const TONES: Record<ExecutionState, BadgeTone> = {
  queued: "neutral", running: "warning", succeeded: "success", denied: "danger",
  failed: "danger", timed_out: "danger", cancelled: "neutral",
};

export function durationOf(run: Execution): string {
  if (run.startedAt === null) return "Pas encore démarrée";
  if (run.finishedAt === null) return "En cours";
  return `${formatNumber(Math.max(0, (run.finishedAt.getTime() - run.startedAt.getTime()) / 1000), 1)} s`;
}

function Outcome({ result, title }: { result: Exclude<AdminOutcome<unknown>, { status: "ok" }>; title: string }) {
  if (result.status === "refused" && result.code === "local_mode") return <Banner tone="neutral">Les exécutions suivies ne sont pas disponibles en mode local.</Banner>;
  return <ReadFailure outcome={result} title={title} />;
}

interface Props { space: Space; platformAdmin: boolean; fetcher: Fetch; target: Environment }

export function ExecutionsPage({ space, platformAdmin, fetcher, target }: Props) {
  const manager = manages(space, platformAdmin);
  const [scope, setScope] = useState<"mine" | "space">(space.role === null ? "space" : "mine");
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<AdminOutcome<Execution> | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useOutcome<AdminOutcome<readonly Execution[]>>(`${space.id}:${scope}:${String(revision)}`, (signal) => space.implicit
    ? Promise.resolve({ status: "refused", code: "local_mode", field: null } as const)
    : fetchExecutions(space.id, scope, signal, fetcher));
  const changed = () => { setRevision((value) => value + 1); };
  const submit = async (input: ExecutionInput) => {
    setBusy(true);
    const outcome = await submitExecution(space.id, input, fetcher);
    setBusy(false);
    setFeedback(outcome);
    if (outcome.status === "ok") { setSelected(outcome.value.id); changed(); }
  };
  return (
    <>
      <div className="sb-page-head">
        <div><h1 className="sb-page-head__title">Exécutions</h1><p className="sb-page-head__lead">{space.name} · résultats évalués avec vos droits de ligne.</p></div>
      </div>
      <p><a href={routeHash({ page: "catalogue", space: space.id })}>Retour au catalogue</a></p>
      {space.implicit ? <Banner tone="neutral">Les exécutions suivies ne sont pas disponibles en mode local.</Banner> : (
        <>
          {space.role !== null ? <SubmitForm target={target} busy={busy} onSubmit={(input) => { void submit(input); }} /> : null}
          {feedback === null ? null : feedback.status === "ok" ? <Banner tone="neutral">Exécution soumise. Son état est suivi ci-dessous.</Banner> : <Outcome result={feedback} title="Soumission indisponible" />}
          <Card title="Exécutions récentes" actions={<button type="button" className="sb-button" onClick={changed}>Actualiser</button>}>
            {manager ? <div className="sb-executions__scope" role="group" aria-label="Portée des exécutions">
              <button type="button" className="sb-button" aria-pressed={scope === "mine"} onClick={() => { setScope("mine"); setSelected(null); }} disabled={space.role === null}>Les miennes</button>
              <button type="button" className="sb-button" aria-pressed={scope === "space"} onClick={() => { setScope("space"); setSelected(null); }}>Espace</button>
            </div> : null}
            {list.status === "loading" ? <Reading>Lecture des exécutions…</Reading> : list.status !== "ok" ? <Outcome result={list} title="Exécutions indisponibles" /> : list.value.length === 0 ? <p>Aucune exécution dans cette vue.</p> : (
              <ul className="sb-executions__list" aria-label="Exécutions récentes">{list.value.map((run) => <li key={run.id}>
                <button type="button" className="sb-executions__item" aria-pressed={selected === run.id} onClick={() => { setSelected(run.id); }}>
                  <span><strong>{run.connection}</strong> · {run.environment}<small>{formatInstant(run.createdAt)}</small></span>
                  <Badge tone={TONES[run.state]}>{LABELS[run.state]}</Badge>
                </button>
              </li>)}</ul>
            )}
          </Card>
          {selected === null ? null : <ExecutionDetail key={`${space.id}:${selected}`} space={space.id} id={selected} fetcher={fetcher} onChanged={changed} />}
        </>
      )}
    </>
  );
}

function names(value: string, required: boolean): string[] | null {
  const items = value.split(",").map((item) => item.trim()).filter(Boolean);
  return (required && items.length === 0) || items.length > 32 || new Set(items).size !== items.length || items.some((item) => !IDENTIFIER.test(item)) ? null : items;
}

function SubmitForm({ target, busy, onSubmit }: { target: Environment; busy: boolean; onSubmit: (input: ExecutionInput) => void }) {
  const [connection, setConnection] = useState("");
  const [model, setModel] = useState("");
  const [metrics, setMetrics] = useState("");
  const [dimensions, setDimensions] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const metricNames = names(metrics, true);
    const dimensionNames = names(dimensions, false);
    if (!CONNECTION_NAME.test(connection) || !IDENTIFIER.test(model) || metricNames === null || dimensionNames === null) {
      setProblem("Vérifiez la connexion, le modèle et les noms uniques des métriques et dimensions (séparés par des virgules).");
      return;
    }
    setProblem(null);
    onSubmit({ connection, environment: target, model, metrics: metricNames, dimensions: dimensionNames, filters: [] });
  };
  return <Card title="Lancer une exécution">
    <form className="sb-executions__form" onSubmit={submit} noValidate>
      <label>Connexion<input className="sb-input" value={connection} onChange={(event) => { setConnection(event.target.value); }} autoComplete="off" /></label>
      <label>Modèle sémantique<input className="sb-input" value={model} onChange={(event) => { setModel(event.target.value); }} autoComplete="off" /></label>
      <label>Métriques <span className="sb-executions__hint">(noms séparés par des virgules)</span><input className="sb-input" value={metrics} onChange={(event) => { setMetrics(event.target.value); }} autoComplete="off" /></label>
      <label>Dimensions <span className="sb-executions__hint">(facultatives)</span><input className="sb-input" value={dimensions} onChange={(event) => { setDimensions(event.target.value); }} autoComplete="off" /></label>
      <p className="sb-executions__hint">Environnement choisi : {target}. Aucun SQL ni identifiant de source n'est demandé.</p>
      {problem === null ? null : <p role="alert">{problem}</p>}
      <button className="sb-button sb-button--primary" type="submit" disabled={busy}>{busy ? "Soumission…" : "Lancer"}</button>
    </form>
  </Card>;
}

function ExecutionDetail({ space, id, fetcher, onChanged }: { space: string; id: string; fetcher: Fetch; onChanged: () => void }) {
  const [cancel, setCancel] = useState<AdminOutcome<Execution> | null>(null);
  const [busy, setBusy] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const detail = useOutcome(`${space}:${id}:${String(revision)}`, (signal) => fetchExecution(space, id, signal, fetcher));
  const run = cancel?.status === "ok" ? cancel.value : detail.status === "ok" ? detail.value : null;
  const requestCancel = async () => {
    setBusy(true);
    const answer = await cancelExecution(space, id, fetcher);
    setBusy(false);
    setCancel(answer);
    if (answer.status === "ok") onChanged();
  };
  return <Card title="Détail de l'exécution">
    <button type="button" className="sb-button" onClick={() => { setCancel(null); setRevision((value) => value + 1); }}>Actualiser le détail</button>
    {detail.status === "loading" ? <Reading>Lecture du détail…</Reading> : detail.status !== "ok" ? <Outcome result={detail} title="Détail indisponible" /> : null}
    {run === null ? null : <>
      <dl className="sb-executions__facts">
        <dt>État</dt><dd><Badge tone={TONES[run.state]}>{LABELS[run.state]}</Badge></dd>
        <dt>Identifiant</dt><dd className="sb-mono">{run.id}</dd>
        <dt>Connexion</dt><dd>{run.connection} · {run.environment}</dd>
        <dt>Créée</dt><dd>{formatInstant(run.createdAt)}</dd>
        <dt>Durée</dt><dd>{durationOf(run)}</dd>
        <dt>Résultat</dt><dd>{run.rows === null ? "Aucun résultat" : `${formatNumber(run.rows)} lignes · ${formatNumber(run.size)} octets${run.truncated ? " · tronqué" : ""}`}</dd>
        {run.errorCode === null ? null : <><dt>Raison</dt><dd>{run.errorCode}</dd></>}
        {run.connectorRunId === null ? null : <><dt>Trace connecteur</dt><dd className="sb-mono">{run.connectorRunId}</dd></>}
        {run.proof === null ? null : <><dt>Preuve</dt><dd className="sb-mono">{run.proof.evidenceId} · empreinte SQL {run.proof.sqlHash} · modèles {run.proof.modelKeys.join(", ")}</dd></>}
      </dl>
      {run.cancelRequested ? <p role="status">Annulation demandée, en attente de confirmation de la source.</p> : null}
      {run.canCancel ? <button type="button" className="sb-button" disabled={busy} onClick={() => { void requestCancel(); }}>{busy ? "Annulation…" : "Demander l'annulation"}</button> : null}
      {run.state === "succeeded" && run.proof !== null ? <button type="button" className="sb-button" aria-expanded={resultOpen} onClick={() => { setResultOpen((value) => !value); }}>Aperçu du résultat</button> : null}
      {cancel !== null && cancel.status !== "ok" ? <Outcome result={cancel} title="Annulation indisponible" /> : null}
      {resultOpen ? <ResultPreview space={space} run={run} fetcher={fetcher} /> : null}
    </>}
  </Card>;
}

function ResultPreview({ space, run, fetcher }: { space: string; run: Execution; fetcher: Fetch }) {
  const result = useOutcome(`${space}:${run.id}`, (signal) => fetchResult(space, run, signal, fetcher));
  if (result.status === "loading") return <Reading>Lecture du résultat…</Reading>;
  if (result.status !== "ok") return <Outcome result={result} title="Résultat indisponible" />;
  return <ArrowTable table={result.value} />;
}

function ArrowTable({ table }: { table: Table }) {
  const names = table.schema.fields.map((field) => field.name);
  return <div className="sb-executions__result" role="region" aria-label="Aperçu du résultat" tabIndex={0}>
    <table><thead><tr>{names.map((name) => <th key={name} scope="col">{name}</th>)}</tr></thead>
      <tbody>{Array.from({ length: table.numRows }, (_, row) => {
        const values = (table.get(row) as { toJSON: () => Record<string, unknown> }).toJSON();
        return <tr key={row}>{names.map((name) => <td key={name}>{cellText(values[name])}</td>)}</tr>;
      })}</tbody></table>
    {table.numRows === 0 ? <p>Aucune ligne dans ce résultat.</p> : null}
  </div>;
}

export function cellText(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return "Valeur complexe";
}
