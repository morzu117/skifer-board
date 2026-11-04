import { useState, type SyntheticEvent } from "react";

import { formatInstant } from "../format/date";
import { Banner } from "../ui/Banner";
import { Card } from "../ui/Card";
import { useOutcome } from "../ui/useOutcome";
import { ReadFailure, Reading } from "./AdminParts";
import { REFUSAL_LABELS, type AdminOutcome, type RefusalCode } from "./admin";
import type { Fetch } from "./api";
import { DATABRICKS_HOST, ENDPOINT_KEY, type Probe } from "./connections";
import { discoverWarehouses, disconnectOAuth, fetchOAuthStatus, selectWarehouse, startOAuth, testOAuthConnection, type Discovery, type OAuthStatus } from "./oauth";
import { ProbeOutcome } from "./ProbeOutcome";

export function leaveForDatabricks(url: string): void { window.location.assign(url); }

type Write = <T>(run: () => Promise<AdminOutcome<T>>, done: string) => Promise<boolean>;
interface Props { space: string; fetcher: Fetch; busy: boolean; onWrite: Write; leave?: (url: string) => void; canRegister?: boolean }
const resultCodes: ReadonlySet<string> = new Set<RefusalCode>(["oauth_refused", "oauth_invalid_state", "oauth_unavailable", "oauth_reconnect", "oauth_invalid_response"]);

export function DatabricksOAuthPanel(props: Props) {
  const [open, setOpen] = useState(() => new URLSearchParams(window.location.search).has("databricks_oauth"));
  return <Card title="Connexion personnelle Databricks">
    <p className="sb-connection__note">{props.canRegister === false ? "Connectez votre compte Databricks pour exécuter les liaisons personnelles avec vos droits. Les points d’accès partagés sont configurés par l’administrateur." : "Indiquez l'URL du workspace, connectez-vous avec votre compte Databricks, puis choisissez un warehouse accessible. Board remplit ses paramètres de connexion."}</p>
    <button type="button" className="sb-button sb-button--primary" aria-expanded={open} onClick={() => { setOpen(!open); }}>Se connecter à Databricks</button>
    {open ? <OAuthSetup {...props} /> : null}
  </Card>;
}

function OAuthSetup(props: Props) {
  const [version, setVersion] = useState(0);
  const status = useOutcome(`databricks-oauth:${props.space}:${String(version)}`, (signal) => fetchOAuthStatus(props.space, signal, props.fetcher));
  const reload = () => { setVersion((value) => value + 1); };
  if (status.status === "loading") return <Reading>Lecture de la connexion OAuth…</Reading>;
  return <>
    {status.status !== "ok" ? <ReadFailure outcome={status} title="Connexion OAuth indisponible" /> : !status.value.configured ? <Banner tone="warning">
      Configuration OAuth requise : faites enregistrer l'application Board dans les paramètres du compte Databricks, puis configurer son Client ID dans Board.
      {status.value.redirectUri === null ? null : <p>Adresse de retour à autoriser : <code className="sb-oauth__callback">{status.value.redirectUri}</code></p>}
    </Banner> : <OAuthWorkspace {...props} status={status.value} reload={reload} />}
    <button type="button" className="sb-button" disabled={props.busy} onClick={reload}>Actualiser la connexion OAuth</button>
  </>;
}

function OAuthWorkspace({ space, fetcher, busy, onWrite, leave = leaveForDatabricks, status, reload, canRegister = true }: Props & { status: OAuthStatus; reload: () => void }) {
  const params = new URLSearchParams(window.location.search);
  const preferred = params.get("databricks_workspace") ?? "";
  const initialHost = DATABRICKS_HOST.test(preferred) ? preferred : status.connections.length === 1 ? status.connections.map((item) => item.host).join("") : "";
  const [host, setHost] = useState(initialHost);
  const [request, setRequest] = useState({ host: status.connections.some((item) => item.host === initialHost) ? initialHost : "", version: 0 });
  const loaded = useOutcome(`warehouses:${space}:${request.host}:${String(request.version)}`, () => request.host === "" ? Promise.resolve(null) : discoverWarehouses(space, request.host, fetcher));
  const discovery = request.host === "" ? null : loaded;
  const [failure, setFailure] = useState<Exclude<AdminOutcome<unknown>, { status: "ok" }> | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [operation, setOperation] = useState<"authorizing" | "testing" | null>(null);
  const [probe, setProbe] = useState<AdminOutcome<Probe> | { status: "testing" } | null>(null);
  const locked = busy || operation !== null || discovery?.status === "loading";
  const connectedHost = status.connections.some((item) => item.host === host);
  const result = params.get("databricks_oauth");
  const discover = (workspace: string) => {
    setHost(workspace); setRequest((previous) => ({ host: workspace, version: previous.version + 1 })); setProbe(null); setFailure(null); setProblem(null);
  };
  const connect = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = host.trim().replace(/\/$/, "");
    if (!DATABRICKS_HOST.test(normalized)) { setProblem("Indiquez l'URL HTTPS complète du workspace Databricks."); return; }
    setHost(normalized); setProblem(null); setFailure(null); setOperation("authorizing");
    const found = await startOAuth(space, normalized, fetcher, canRegister ? "connections" : "executions");
    setOperation(null);
    if (found.status === "ok") leave(found.value); else setFailure(found);
  };
  const runTest = async (id: string) => {
    setOperation("testing"); setProbe({ status: "testing" });
    setProbe(await testOAuthConnection(space, host, id, fetcher)); setOperation(null);
  };
  return <div className="sb-connections__list">
    {result === "connected" && connectedHost ? <Banner tone="neutral">Connexion personnelle Databricks établie. Les warehouses sont lus avec vos droits.</Banner> : result !== null && resultCodes.has(result) ? <Banner tone="danger">{REFUSAL_LABELS[result as RefusalCode]}</Banner> : null}
    <form className="sb-connection__form" aria-label="Connexion OAuth Databricks" noValidate onSubmit={(event) => { void connect(event); }}>
      <label className="sb-field">URL du workspace Databricks <input className="sb-input" type="url" required value={host} disabled={locked} onChange={(event) => { setHost(event.target.value); setRequest((previous) => ({ host: "", version: previous.version + 1 })); setProbe(null); setProblem(null); }} placeholder="https://adb-….azuredatabricks.net" /></label>
      <button className="sb-button sb-button--primary" type="submit" disabled={locked}>{operation === "authorizing" ? "Ouverture de Databricks…" : "Continuer vers Databricks"}</button>
      {connectedHost ? <button className="sb-button" type="button" disabled={locked} onClick={() => { discover(host); }}>Charger les warehouses</button> : null}
    </form>
    {status.connections.map((item) => <button key={item.host} className="sb-button sb-oauth__workspace" type="button" disabled={locked} onClick={() => { discover(item.host); }}>Utiliser {item.host}</button>)}
    {failure === null ? null : <ReadFailure outcome={failure} title="Connexion OAuth impossible" />}
    {problem === null ? null : <p className="sb-connection__problem" role="alert">{problem}</p>}
    {discovery === null ? null : discovery.status === "loading" ? <Reading>Découverte des warehouses…</Reading> : discovery.status !== "ok" ? <ReadFailure outcome={discovery} title="Warehouses indisponibles" /> : discovery.value.warehouses.length === 0 ? <Banner tone="neutral">Aucun warehouse accessible avec votre compte dans ce workspace.</Banner> : <WarehouseSelection key={`${request.host}:${String(request.version)}`} space={space} fetcher={fetcher} host={host} discovery={discovery.value} canRegister={canRegister} locked={locked} onWrite={onWrite} onTest={(id) => { void runTest(id); }} onClearTest={() => { setProbe(null); }} />}
    <div aria-live="polite" aria-atomic="true">{probe === null ? null : <ProbeOutcome outcome={probe} />}</div>
    {connectedHost ? <button className="sb-button" type="button" disabled={locked} onClick={() => { void onWrite(() => disconnectOAuth(space, host, fetcher), "Votre connexion personnelle Databricks a été retirée de Board.").then((ok) => { if (ok) reload(); }); }}>Déconnecter mon compte Databricks de ce workspace</button> : null}
  </div>;
}

function WarehouseSelection({ space, fetcher, host, discovery, canRegister, locked, onWrite, onTest, onClearTest }: { space: string; fetcher: Fetch; host: string; discovery: Discovery; canRegister: boolean; locked: boolean; onWrite: Write; onTest: (id: string) => void; onClearTest: () => void }) {
  const initial = discovery.warehouses.length === 1 ? discovery.warehouses.map((item) => item.id).join("") : "";
  const [selected, setSelected] = useState(initial);
  const [key, setKey] = useState(initial === "" ? "" : `databricks_${initial.toLowerCase()}`.slice(0, 63));
  const [problem, setProblem] = useState<string | null>(null);
  const choose = (id: string) => { setSelected(id); setKey(`databricks_${id.toLowerCase()}`.slice(0, 63)); onClearTest(); setProblem(null); };
  const save = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ENDPOINT_KEY.test(key) || selected === "") { setProblem("Choisissez un warehouse et une clé : lettres minuscules, chiffres, _ ou -, en commençant par une lettre."); return; }
    setProblem(null);
    void onWrite(() => selectWarehouse(space, host, selected, key, fetcher), `Point d'accès ${key} enregistré depuis votre connexion OAuth.`);
  };
  const fields = <>
      <label className="sb-field">Warehouse accessible <select className="sb-input" required value={selected} disabled={locked} onChange={(event) => { choose(event.target.value); }}><option value="">Choisir un warehouse</option>{discovery.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name} · {warehouse.id} · {warehouse.state}</option>)}</select></label>
      <label className="sb-field">ID du warehouse détecté <input className="sb-input" readOnly value={selected} /></label>
      {canRegister ? <>
        <label className="sb-field">Clé du point d'accès OAuth <input className="sb-input" required value={key} maxLength={63} disabled={locked} onChange={(event) => { setKey(event.target.value); setProblem(null); }} /></label>
        <button className="sb-button sb-button--primary" type="submit" disabled={locked}>Enregistrer ce warehouse</button>
      </> : null}
      <button className="sb-button" type="button" disabled={locked || selected === ""} onClick={() => { onTest(selected); }}>Tester avec ma connexion OAuth</button>
  </>;
  return <>
    <p className="sb-connection__note">Autorisation personnelle · expiration de l'accès : {formatInstant(discovery.expiresAt)}. Le renouvellement est automatique tant que votre autorisation reste valide.</p>
    {canRegister ? <form className="sb-connection__form" aria-label="Enregistrer le warehouse découvert" noValidate onSubmit={save}>{fields}</form> : <div className="sb-connection__form" role="group" aria-label="Warehouse personnel">{fields}</div>}
    {problem === null ? null : <p className="sb-connection__problem" role="alert">{problem}</p>}
  </>;
}

import "./connections.css";
