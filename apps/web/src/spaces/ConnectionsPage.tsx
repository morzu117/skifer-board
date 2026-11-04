import { useState, type SyntheticEvent } from "react";

import { formatInstant } from "../format/date";
import type { Environment } from "../shell/sections";
import { Badge } from "../ui/Badge";
import { Banner } from "../ui/Banner";
import { Card } from "../ui/Card";
import { useRefreshed } from "../ui/useOutcome";
import { AdminTabs, Confirm, FeedbackRegion, Journal, ReadFailure, Reading, useAdminWrite } from "./AdminParts";
import { fetchEvents, type AdminOutcome } from "./admin";
import type { Fetch } from "./api";
import {
  CONNECTION_NAME, ENDPOINT_KEY, DATABRICKS_HOST, CONNECTORS, IDENTITIES,
  createConnection, fetchConnections, removeConnection, removeConnectionBinding,
  removeConnectionCredential, setConnectionBinding, setConnectionCredential, testConnection,
  createEndpoint, fetchEndpoints, removeEndpoint, testEndpoint,
  type ConnectionBinding, type Connector, type IdentityMode, type LogicalConnection, type Probe, type DatabricksEndpoint,
} from "./connections";
import type { Space } from "./model";
import { ProbeOutcome } from "./ProbeOutcome";
import { DatabricksOAuthPanel } from "./DatabricksOAuthPanel";
import { testOAuthConnection } from "./oauth";
import "./connections.css";

export const CONNECTION_REMINDER = "Déclarez le workspace et le warehouse dans cet espace, puis utilisez leur clé dans la liaison. Un essai ne lit aucune donnée métier.";

type Pending =
  | { kind: "connection"; name: string }
  | { kind: "binding" | "credential"; name: string; environment: Environment };

interface ConnectionsPageProps {
  space: Space;
  fetcher: Fetch;
  target: Environment;
  onWritten?: () => void;
}

export function ConnectionsPage({ space, fetcher, target, onWritten }: ConnectionsPageProps) {
  const [pending, setPending] = useState<Pending | null>(null);
  const { version, busy, feedback, setFeedback, announced, write } = useAdminWrite(onWritten, () => { setPending(null); });
  const connections = useRefreshed(`connections:${space.id}`, version, (signal) => fetchConnections(space.id, signal, fetcher));
  const endpoints = useRefreshed(`endpoints:${space.id}`, version, (signal) => fetchEndpoints(space.id, signal, fetcher));
  const events = useRefreshed(`events:${space.id}`, version, (signal) => fetchEvents(space.id, signal, fetcher));
  const selectPending = (next: Pending | null) => { setFeedback(null); setPending(next); };
  const confirm = (change: Pending) => {
    if (change.kind === "connection") {
      void write(() => removeConnection(space.id, change.name, fetcher), `Connexion ${change.name} retirée.`);
    } else if (change.kind === "binding") {
      void write(() => removeConnectionBinding(space.id, change.name, change.environment, fetcher), `Liaison ${change.environment} de ${change.name} retirée.`);
    } else {
      void write(() => removeConnectionCredential(space.id, change.name, change.environment, fetcher), `Identifiant ${change.environment} de ${change.name} retiré.`);
    }
  };

  return (
    <>
      <div className="sb-page-head">
        <div>
          <h1 className="sb-page-head__title">Connexions</h1>
          <p className="sb-page-head__lead">{space.name} · <span className="sb-mono">{space.id}</span></p>
        </div>
      </div>
      <AdminTabs space={space} current="connections" />
      <Banner tone="neutral"><strong>{CONNECTION_REMINDER}</strong> Aucun identifiant ni SQL n'est affiché.</Banner>
      <FeedbackRegion feedback={feedback} announced={announced} />
      <DatabricksOAuthPanel key={space.id} space={space.id} fetcher={fetcher} busy={busy} onWrite={write} />
      <Card title="Points d'accès Databricks">
        <EndpointPanel outcome={endpoints} space={space.id} busy={busy} fetcher={fetcher} onWrite={write} />
      </Card>
      <Card title="Connexions logiques">
        <ConnectionList
          outcome={connections}
          busy={busy}
          pending={pending}
          target={target}
          space={space.id}
          fetcher={fetcher}
          onPending={selectPending}
          onConfirm={confirm}
          onWrite={write}
        />
      </Card>
      {connections.status === "ok" ? <CreateConnection space={space.id} busy={busy} fetcher={fetcher} onWrite={write} /> : null}
      <Card title="Journal de l'espace"><Journal events={events} /></Card>
    </>
  );
}

function EndpointPanel({ outcome, space, busy, fetcher, onWrite }: {
  outcome: { status: "loading" } | AdminOutcome<readonly DatabricksEndpoint[]>;
  space: string; busy: boolean; fetcher: Fetch;
  onWrite: <T>(run: () => Promise<AdminOutcome<T>>, done: string) => Promise<boolean>;
}) {
  const [key, setKey] = useState("");
  const [host, setHost] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  if (outcome.status === "loading") return <Reading>Lecture des points d'accès…</Reading>;
  if (outcome.status !== "ok") return <ReadFailure outcome={outcome} title="Points d'accès indisponibles" />;
  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ENDPOINT_KEY.test(key)) {
      setProblem("Clé du point d'accès : utilisez 1 à 63 caractères, en commençant par une lettre minuscule, puis des lettres minuscules, chiffres, underscores (_) ou tirets (-). Exemple : databricks_test.");
      return;
    }
    if (!DATABRICKS_HOST.test(host)) {
      setProblem("URL du workspace : indiquez l'adresse HTTPS complète du workspace Databricks, sans chemin ni barre oblique finale. Exemple : https://adb-123.2.azuredatabricks.net");
      return;
    }
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(warehouseId)) {
      setProblem("ID du SQL warehouse : indiquez les 1 à 64 lettres, chiffres, tirets ou underscores situés après /warehouses/ dans le HTTP path Databricks.");
      return;
    }
    setProblem(null);
    void onWrite(() => createEndpoint(space, { key, host, warehouseId }, fetcher), `Point d'accès ${key} enregistré.`).then((ok) => {
      if (ok) { setKey(""); setHost(""); setWarehouseId(""); }
    });
  };
  return <>
    {outcome.value.length === 0 ? <p className="sb-connections__empty">Aucun point d'accès Databricks dans cet espace.</p> : (
      <ul className="sb-connections__list">
        {outcome.value.map((endpoint) => <li className="sb-connection" key={endpoint.key}>
          <strong className="sb-mono">{endpoint.key}</strong> · <span className="sb-mono">{endpoint.host}</span> · warehouse <span className="sb-mono">{endpoint.warehouseId}</span>
          <EndpointTest endpoint={endpoint} space={space} fetcher={fetcher} busy={busy} />
          <button type="button" className="sb-button" disabled={busy} onClick={() => { setPending(endpoint.key); }}>Retirer {endpoint.key}</button>
          {pending === endpoint.key ? <Confirm question={`Retirer le point d'accès ${endpoint.key} ?`} action="Confirmer le retrait" busy={busy} onConfirm={() => { void onWrite(() => removeEndpoint(space, endpoint.key, fetcher), `Point d'accès ${endpoint.key} retiré.`).then((ok) => { if (ok) setPending(null); }); }} onCancel={() => { setPending(null); }} /> : null}
        </li>)}
      </ul>
    )}
    <form className="sb-connection__form" aria-label="Ajouter un point d'accès Databricks" noValidate onSubmit={submit}>
      <label className="sb-field">Clé du point d'accès <input className="sb-input" value={key} onChange={(event) => { setKey(event.target.value); setProblem(null); }} required maxLength={63} autoComplete="off" /></label>
      <label className="sb-field">URL du workspace <input className="sb-input" type="url" value={host} onChange={(event) => { setHost(event.target.value); setProblem(null); }} required autoComplete="url" placeholder="https://adb-….azuredatabricks.net" /></label>
      <label className="sb-field">ID du SQL warehouse <input className="sb-input" value={warehouseId} onChange={(event) => { setWarehouseId(event.target.value); setProblem(null); }} required maxLength={64} autoComplete="off" /></label>
      <button className="sb-button sb-button--primary" type="submit" disabled={busy}>Enregistrer le point d'accès</button>
      {problem === null ? null : <p role="alert" className="sb-connection__problem">{problem}</p>}
    </form>
  </>;
}

function EndpointTest({ endpoint, space, fetcher, busy }: { endpoint: DatabricksEndpoint; space: string; fetcher: Fetch; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [probe, setProbe] = useState<AdminOutcome<Probe> | { status: "testing" } | null>(null);
  const testing = probe?.status === "testing";
  const runOAuthTest = async () => {
    setOpen(false);
    setProbe({ status: "testing" });
    setProbe(await testOAuthConnection(space, endpoint.host, endpoint.warehouseId, fetcher));
  };
  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const field = form.elements.namedItem("secret") as HTMLInputElement;
    const secret = field.value;
    form.reset();
    setProbe({ status: "testing" });
    setProbe(await testEndpoint(space, endpoint.key, secret, fetcher));
  };
  return <div>
    <button type="button" className="sb-button sb-button--primary" disabled={busy || testing} onClick={() => { void runOAuthTest(); }}>Tester la connexion avec OAuth</button>
    <button type="button" className="sb-button" disabled={busy || testing} aria-expanded={open} onClick={() => { setOpen(!open); setProbe(null); }}>Tester avec un jeton saisi</button>
    {open ? <form className="sb-connection__form" aria-label={`Tester le point d'accès ${endpoint.key}`} onSubmit={(event) => { void submit(event); }}>
      <p className="sb-connection__note">Le test vérifie l'accès au warehouse sans lire de données métier. Le jeton est utilisé pour cet essai uniquement et n'est pas conservé.</p>
      <label className="sb-field">Jeton Databricks pour le test <input className="sb-input" name="secret" type="password" autoComplete="off" required maxLength={16384} disabled={testing} /></label>
      <button type="submit" className="sb-button sb-button--primary" disabled={busy || testing}>{testing ? "Test en cours…" : "Lancer le test"}</button>
    </form> : null}
    <div aria-live="polite" aria-atomic="true">{probe === null ? null : <ProbeOutcome outcome={probe} />}</div>
  </div>;
}

interface ListProps {
  outcome: { status: "loading" } | AdminOutcome<readonly LogicalConnection[]>;
  busy: boolean;
  pending: Pending | null;
  target: Environment;
  space: string;
  fetcher: Fetch;
  onPending: (pending: Pending | null) => void;
  onConfirm: (pending: Pending) => void;
  onWrite: <T>(run: () => Promise<AdminOutcome<T>>, done: string) => Promise<boolean>;
}

function ConnectionList({ outcome, busy, pending, target, space, fetcher, onPending, onConfirm, onWrite }: ListProps) {
  if (outcome.status === "loading") return <Reading>Lecture des connexions…</Reading>;
  if (outcome.status !== "ok") return <ReadFailure outcome={outcome} title="Connexions indisponibles" />;
  if (outcome.value.length === 0) return <p className="sb-connections__empty">Aucune connexion dans cet espace.</p>;
  return (
    <div className="sb-connections__list">
      {outcome.value.map((connection) => (
        <section className="sb-connection" aria-label={`Connexion ${connection.name}`} key={connection.name}>
          <div className="sb-connection__head">
            <div>
              <h3 className="sb-connection__name sb-mono">{connection.name}</h3>
              <p className="sb-connection__meta">Créée le {formatInstant(connection.createdAt)}.</p>
            </div>
            <button type="button" className="sb-button" disabled={busy} onClick={() => { onPending({ kind: "connection", name: connection.name }); }}>Retirer la connexion {connection.name}</button>
          </div>
          {pending?.kind === "connection" && pending.name === connection.name ? (
            <Confirm
              question={`Retirer la connexion ${connection.name} ?`}
              action="Confirmer le retrait"
              busy={busy}
              onConfirm={() => { onConfirm(pending); }}
              onCancel={() => { onPending(null); }}
            />
          ) : null}
          <div className="sb-connection__environments">
            {connection.bindings.map((binding) => (
              <BindingPanel
                key={`${connection.name}:${binding.environment}:${binding.state === "configured" ? binding.setAt.toISOString() : "absent"}`}
                binding={binding}
                name={connection.name}
                space={space}
                target={target}
                busy={busy}
                pending={pending}
                fetcher={fetcher}
                onPending={onPending}
                onConfirm={onConfirm}
                onWrite={onWrite}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function CreateConnection({ space, busy, fetcher, onWrite }: Pick<ListProps, "space" | "busy" | "fetcher" | "onWrite">) {
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!CONNECTION_NAME.test(name)) {
      setProblem("Un nom commence par une lettre minuscule et contient au plus 63 lettres, chiffres ou soulignés.");
      return;
    }
    setProblem(null);
    void onWrite(() => createConnection(space, name, fetcher), `Connexion ${name} créée.`).then((ok) => { if (ok) setName(""); });
  };
  return (
    <Card title="Créer une connexion">
      <form className="sb-connection__form" aria-label="Créer une connexion" noValidate onSubmit={submit}>
        <label className="sb-field">Nom logique <input className="sb-input" value={name} onChange={(event) => { setName(event.target.value); setProblem(null); }} autoComplete="off" required maxLength={63} pattern="[a-z][a-z0-9_]*" /></label>
        <button className="sb-button sb-button--primary" type="submit" disabled={busy}>Créer la connexion</button>
      </form>
      {problem === null ? null : <p className="sb-connection__problem" role="alert">{problem}</p>}
    </Card>
  );
}

interface BindingProps extends Pick<ListProps, "space" | "target" | "busy" | "pending" | "fetcher" | "onPending" | "onConfirm" | "onWrite"> {
  name: string;
  binding: ConnectionBinding;
}

function BindingPanel({ binding, name, space, target, busy, pending, fetcher, onPending, onConfirm, onWrite }: BindingProps) {
  const [editing, setEditing] = useState(false);
  const [credentialOpen, setCredentialOpen] = useState(false);
  const [probe, setProbe] = useState<AdminOutcome<Probe> | { status: "testing" } | null>(null);
  const [testing, setTesting] = useState(false);
  const relevant = pending?.kind !== "connection" && pending?.name === name && pending.environment === binding.environment ? pending : null;
  const runTest = async () => {
    setTesting(true);
    setProbe({ status: "testing" });
    const result = await testConnection(space, name, binding.environment, fetcher);
    setTesting(false);
    setProbe(result);
  };
  return (
    <section className={binding.environment === target ? "sb-connection__environment sb-connection__environment--target" : "sb-connection__environment"} aria-label={`${name} · ${binding.environment}`}>
      <h4 className="sb-connection__environment-name">{binding.environment}</h4>
      {binding.state === "unconfigured" ? <p className="sb-connections__empty">Aucune liaison configurée.</p> : (
        <>
          <dl className="sb-connection__facts">
            <dt>Connecteur</dt><dd>{binding.connector === "duckdb" ? "DuckDB" : "Databricks SQL"}</dd>
            <dt>Point d'accès</dt><dd className="sb-mono">{binding.endpointKey}</dd>
            <dt>Identité</dt><dd>{binding.identityMode === "service" ? "Service" : "Personne"}</dd>
            <dt>Identifiant</dt><dd><CredentialBadge state={binding.credentialState} identity={binding.identityMode} connector={binding.connector} /></dd>
          </dl>
          {binding.identityMode === "person" ? <p className="sb-connection__note">La fédération de l'identité personnelle n'est pas encore disponible.</p> : null}
        </>
      )}
      <div className="sb-connection__actions">
        <button type="button" className="sb-button" disabled={busy} aria-expanded={editing} onClick={() => { setEditing((value) => !value); setCredentialOpen(false); setProbe(null); }}>{binding.state === "configured" ? "Modifier la liaison" : "Configurer la liaison"}</button>
        {binding.state === "configured" ? (
          <>
            {binding.identityMode === "service" && binding.connector === "databricks" ? (
              <button type="button" className="sb-button" disabled={busy} aria-expanded={credentialOpen} onClick={() => { setCredentialOpen((value) => !value); setEditing(false); }}> {binding.credentialState === "configured" ? "Remplacer l'identifiant" : "Poser un identifiant"}</button>
            ) : null}
            <button type="button" className="sb-button" disabled={busy || testing} onClick={() => { void runTest(); }}>Tester la connexion</button>
            {binding.credentialState !== "unconfigured" ? <button type="button" className="sb-button" disabled={busy} onClick={() => { onPending({ kind: "credential", name, environment: binding.environment }); }}>Retirer l'identifiant</button> : null}
            <button type="button" className="sb-button" disabled={busy} onClick={() => { onPending({ kind: "binding", name, environment: binding.environment }); }}>Retirer la liaison</button>
          </>
        ) : null}
      </div>
      {editing ? <BindingEditor binding={binding} name={name} space={space} busy={busy} fetcher={fetcher} onWrite={onWrite} onDone={() => { setEditing(false); setProbe(null); }} /> : null}
      {credentialOpen && binding.state === "configured" ? <CredentialEditor binding={binding} name={name} space={space} busy={busy} fetcher={fetcher} onWrite={onWrite} onDone={() => { setCredentialOpen(false); setProbe(null); }} /> : null}
      {probe === null ? null : <ProbeOutcome outcome={probe} />}
      {relevant === null ? null : (
        <Confirm
          question={`Retirer ${relevant.kind === "binding" ? "la liaison" : "l'identifiant"} ${binding.environment} de ${name} ?`}
          action="Confirmer le retrait"
          busy={busy}
          onConfirm={() => { onConfirm(relevant); }}
          onCancel={() => { onPending(null); }}
        />
      )}
    </section>
  );
}

function CredentialBadge({ state, identity, connector }: { state: "unconfigured" | "configured" | "unavailable"; identity: IdentityMode; connector: Connector }) {
  if (identity === "person" || connector === "duckdb") return <Badge tone="neutral">Sans identifiant serveur</Badge>;
  if (state === "configured") return <Badge tone="success">Configuré</Badge>;
  if (state === "unavailable") return <Badge tone="danger">Indisponible</Badge>;
  return <Badge tone="warning">À configurer</Badge>;
}

function BindingEditor({ binding, name, space, busy, fetcher, onWrite, onDone }: Pick<BindingProps, "binding" | "name" | "space" | "busy" | "fetcher" | "onWrite"> & { onDone: () => void }) {
  const [connector, setConnector] = useState<Connector>(binding.state === "configured" ? binding.connector : "duckdb");
  const [endpointKey, setEndpointKey] = useState(binding.state === "configured" ? binding.endpointKey : "");
  const [identityMode, setIdentityMode] = useState<IdentityMode>(binding.state === "configured" ? binding.identityMode : "service");
  const [problem, setProblem] = useState<string | null>(null);
  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ENDPOINT_KEY.test(endpointKey)) {
      setProblem("La clé commence par une lettre minuscule et contient au plus 63 lettres minuscules, chiffres, underscores (_) ou tirets (-).");
      return;
    }
    setProblem(null);
    void onWrite(() => setConnectionBinding(space, name, binding.environment, connector, endpointKey, identityMode, fetcher), `Liaison ${binding.environment} de ${name} enregistrée.`).then((ok) => { if (ok) onDone(); });
  };
  return (
    <form className="sb-connection__form" aria-label={`Configurer ${name} · ${binding.environment}`} noValidate onSubmit={submit}>
      <label className="sb-field">Connecteur <select className="sb-input" value={connector} onChange={(event) => { setConnector(event.target.value as Connector); }}>
        {CONNECTORS.map((item) => <option key={item} value={item}>{item === "duckdb" ? "DuckDB" : "Databricks SQL"}</option>)}
      </select></label>
      <label className="sb-field">Clé du point d'accès <input className="sb-input" value={endpointKey} onChange={(event) => { setEndpointKey(event.target.value); setProblem(null); }} required maxLength={63} pattern="[a-z][a-z0-9_-]*" autoComplete="off" /></label>
      <label className="sb-field">Mode d'identité <select className="sb-input" value={identityMode} onChange={(event) => { setIdentityMode(event.target.value as IdentityMode); }}>
        {IDENTITIES.map((item) => <option key={item} value={item}>{item === "service" ? "Service" : "Personne"}</option>)}
      </select></label>
      {identityMode === "person" ? <p className="sb-connection__note">La connexion personnelle ne pourra pas être testée avant la fédération des identités.</p> : null}
      <button className="sb-button sb-button--primary" disabled={busy} type="submit">Enregistrer la liaison</button>
      {problem === null ? null : <p className="sb-connection__problem" role="alert">{problem}</p>}
    </form>
  );
}

function CredentialEditor({ binding, name, space, busy, fetcher, onWrite, onDone }: Pick<BindingProps, "binding" | "name" | "space" | "busy" | "fetcher" | "onWrite"> & { onDone: () => void }) {
  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const field = form.elements.namedItem("secret") as HTMLInputElement;
    const secret = field.value;
    form.reset();
    void onWrite(() => setConnectionCredential(space, name, binding.environment, secret, fetcher), `Identifiant ${binding.environment} de ${name} enregistré.`).then((ok) => { if (ok) onDone(); });
  };
  return (
    <form className="sb-connection__form" aria-label={`Identifiant ${name} · ${binding.environment}`} onSubmit={submit}>
      <p className="sb-connection__note">La valeur est envoyée une seule fois au coffre ; elle ne pourra pas être relue.</p>
      <label className="sb-field">Nouvel identifiant <input className="sb-input" name="secret" type="password" autoComplete="new-password" required maxLength={16384} /></label>
      <button className="sb-button sb-button--primary" disabled={busy} type="submit">Enregistrer l'identifiant</button>
    </form>
  );
}
