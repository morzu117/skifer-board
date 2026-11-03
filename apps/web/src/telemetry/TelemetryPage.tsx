import { Fragment, useState, type ReactNode } from "react";

import { formatAge, formatInstant } from "../format/date";
import { formatNumber, formatPercent } from "../format/number";
import type { Fetch } from "../spaces/api";
import { REFUSAL_LABELS, type AdminOutcome } from "../spaces/admin";
import { Banner } from "../ui/Banner";
import { Card } from "../ui/Card";
import { useOutcome } from "../ui/useOutcome";
import { fetchTelemetry } from "./api";
import {
  byP95,
  formatCount,
  formatDuration,
  formatSize,
  KIND_LABELS,
  WINDOW_LABELS,
  WINDOW_SPANS,
  WINDOWS,
  type OperationSummary,
  type Summary,
  type Window,
} from "./model";
import "./telemetry.css";

interface TelemetryPageProps {
  fetcher: Fetch;
  /** Instant de l'affichage, pour l'âge de la dernière mesure ; remplaçable en test. */
  now?: () => Date;
}

function currentDate(): Date {
  return new Date();
}

/**
 * Écran « Télémétrie » (plan 11, T8) : les opérations de Board sur une fenêtre, les plus lentes
 * d'abord. On mesure Board, jamais les personnes ; le serveur réserve la lecture à
 * l'administration de la plateforme et l'écran rend ses refus tels quels.
 */
export function TelemetryPage({ fetcher, now = currentDate }: TelemetryPageProps) {
  const [window, setWindow] = useState<Window>("24h");
  const result = useOutcome(`telemetry:${window}`, (signal) => fetchTelemetry(window, signal, fetcher));
  return (
    <>
      <div className="sb-page-head">
        <div>
          <h1 className="sb-page-head__title">Télémétrie</h1>
          <p className="sb-page-head__lead">
            Durées mesurées par le serveur Board, de la réception de chaque requête au dernier octet envoyé, et lectures d'Atlas. Aucune personne ni aucune valeur n'est enregistrée.
          </p>
        </div>
        {/* Le droit et le mode local ne dépendent pas de la fenêtre : la bascule n'y est pas offerte. */}
        {result.status === "refused" && (result.code === "forbidden" || result.code === "local_mode") ? null : (
        <div className="sb-env" role="group" aria-label="Fenêtre">
          {WINDOWS.map((candidate) => (
            <button
              key={candidate}
              type="button"
              className="sb-env__segment"
              aria-pressed={candidate === window}
              onClick={() => {
                setWindow(candidate);
              }}
            >
              {WINDOW_LABELS[candidate]}
            </button>
          ))}
        </div>
        )}
      </div>
      <Outcome result={result} window={window} now={now} />
    </>
  );
}

function Outcome({ result, window, now }: { result: AdminOutcome<Summary> | { status: "loading" }; window: Window; now: () => Date }) {
  if (result.status === "loading") {
    return (
      <p role="status" aria-busy="true">
        Lecture de la télémétrie…
      </p>
    );
  }
  if (result.status === "error") {
    return <Banner tone="danger">Télémétrie indisponible : {result.message} Aucune donnée n'est affichée.</Banner>;
  }
  if (result.status === "refused") {
    if (result.code === "local_mode") {
      return (
        <Banner tone="neutral">
          En mode local, sans fournisseur d'identité, les mesures ne vont que sur la sortie standard du serveur : elles ne se lisent pas ici.
        </Banner>
      );
    }
    if (result.code === "forbidden") {
      return <Banner tone="neutral">La télémétrie est réservée à l'administration de la plateforme.</Banner>;
    }
    return <Banner tone="danger">Télémétrie indisponible : {REFUSAL_LABELS[result.code]}</Banner>;
  }
  const summary = result.value;
  if (summary.period === null) {
    return (
      <Card title="Aucune mesure">
        <p className="sb-telemetry__empty">Aucune mesure sur {WINDOW_SPANS[window]}.</p>
      </Card>
    );
  }
  return (
    <Card title={`Opérations sur ${WINDOW_SPANS[window]}`}>
      <p className="sb-telemetry__period">
        Mesures du {formatInstant(summary.period.oldest)} au {formatInstant(summary.period.newest)} · dernière mesure {formatAge(summary.period.newest, now())}.
      </p>
      <Operations operations={byP95(summary.operations)} />
    </Card>
  );
}

/** Gabarit coupable après chaque `/` plutôt qu'au milieu d'un mot. */
function breakable(operation: string): ReactNode {
  return operation.split("/").map((part, index) => (
    <Fragment key={index}>
      {index === 0 ? null : (
        <>
          /<wbr />
        </>
      )}
      {part}
    </Fragment>
  ));
}

function share(part: number, whole: number): string {
  return part === 0 ? "0" : `${formatNumber(part)} (${formatPercent(part / whole)})`;
}

function Operations({ operations }: { operations: readonly OperationSummary[] }) {
  return (
    <div className="sb-table-wrap" role="group" aria-label="Opérations, les plus lentes d'abord" tabIndex={0}>
      <table className="sb-table sb-telemetry">
        <caption className="sb-visually-hidden">Opérations, les plus lentes d'abord (p95 décroissant)</caption>
        <thead>
          <tr>
            <th scope="col">Opération</th>
            <th scope="col" className="sb-num">
              Mesures
            </th>
            <th scope="col" className="sb-num">
              Médiane (ms)
            </th>
            <th scope="col" className="sb-num">
              p95 (ms)
            </th>
            <th scope="col" className="sb-num">
              Max (ms)
            </th>
            <th scope="col" className="sb-num">
              Erreurs
            </th>
            <th scope="col" className="sb-num">
              Refus
            </th>
            <th scope="col" className="sb-num">
              Taille médiane
            </th>
            <th scope="col" className="sb-num">
              Taille max
            </th>
            <th scope="col" className="sb-num">
              Documents médians
            </th>
            <th scope="col" className="sb-num">
              Documents max
            </th>
          </tr>
        </thead>
        <tbody>
          {operations.map((found) => (
            <tr key={`${found.kind} ${found.method ?? ""} ${found.operation}`}>
              <th scope="row" className="sb-telemetry__operation">
                <code>{breakable(found.method === null ? found.operation : `${found.method} ${found.operation}`)}</code>
                <span className="sb-telemetry__kind">{KIND_LABELS[found.kind]}</span>
              </th>
              <td className="sb-num">{formatNumber(found.count)}</td>
              <td className="sb-num">{formatDuration(found.duration.p50)}</td>
              <td className="sb-num">{formatDuration(found.duration.p95)}</td>
              <td className="sb-num">{formatDuration(found.duration.max)}</td>
              <td className="sb-num">{share(found.errors, found.count)}</td>
              <td className="sb-num">{share(found.refusals, found.count)}</td>
              <td className="sb-num">{formatSize(found.size.p50)}</td>
              <td className="sb-num">{formatSize(found.size.max)}</td>
              <td className="sb-num">{formatCount(found.rows.p50)}</td>
              <td className="sb-num">{formatCount(found.rows.max)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
