import { useEffect, useRef, useState } from "react";

import { formatNumber } from "../format/number";
import { Badge } from "../ui/Badge";
import { Banner } from "../ui/Banner";
import { fetchDocument, type Fetch, type Outcome } from "./api";
import { ProvenanceLine } from "./ProvenanceLine";
import { VersionsSection } from "./VersionsSection";
import { availabilityLabel, KIND_LABELS, MODE_LABELS, PROBLEM_LABELS, STATUS_LABELS, versionLabel } from "./labels";
import type { CatalogDocument, DocumentPage } from "./model";

interface DocumentPanelProps {
  id: string;
  fetcher: Fetch;
  now: () => Date;
  onClose: () => void;
}

type Loading = { status: "loading" } | Outcome<DocumentPage>;

/** Fiche d'une définition, à côté de la liste, comme le détail de `02-analyses.html`. */
export function DocumentPanel({ id, fetcher, now, onClose }: DocumentPanelProps) {
  // La réponse est rangée avec son identifiant : celle d'une autre fiche n'est jamais montrée.
  const [answer, setAnswer] = useState<{ id: string; outcome: Outcome<DocumentPage> } | null>(null);
  const result: Loading = answer?.id === id ? answer.outcome : { status: "loading" };
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchDocument(id, controller.signal, fetcher).then(
      (outcome) => {
        if (!controller.signal.aborted) {
          setAnswer({ id, outcome });
        }
      },
      () => undefined,
    );
    return () => {
      controller.abort();
    };
  }, [id, fetcher]);

  useEffect(() => {
    heading.current?.focus();
  }, [result.status]);

  const title = result.status === "ok" ? result.value.document.entry.label : id;
  return (
    <aside
      id="catalogue-fiche"
      className="sb-catalogue__panel"
      aria-labelledby="catalogue-fiche-titre"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onClose();
        }
      }}
    >
      <div className="sb-catalogue__panel-head">
        <h2 id="catalogue-fiche-titre" ref={heading} tabIndex={-1} className="sb-catalogue__panel-title">
          {title}
        </h2>
        <button type="button" className="sb-button" onClick={onClose}>
          Fermer la fiche
        </button>
      </div>
      {result.status === "loading" && <p role="status">Chargement de la fiche…</p>}
      {result.status === "not_found" && (
        <Banner tone="warning">
          La définition <span className="sb-mono">{id}</span> n'est plus dans l'index Atlas.
        </Banner>
      )}
      {result.status === "unavailable" && (
        <Banner tone="danger">
          Atlas est indisponible : {PROBLEM_LABELS[result.problem]}, et aucun index antérieur n'existe.
        </Banner>
      )}
      {result.status === "error" && <Banner tone="danger">La fiche n'a pas pu être lue. {result.message}</Banner>}
      {result.status === "ok" && (
        <>
          <DocumentBody document={result.value.document} />
          <VersionsSection id={id} kind={result.value.document.entry.kind} fetcher={fetcher} />
          <ProvenanceLine provenance={result.value.provenance} now={now()} />
        </>
      )}
    </aside>
  );
}

function DocumentBody({ document }: { document: CatalogDocument }) {
  const { entry } = document;
  const status = STATUS_LABELS[entry.status];
  const availability = entry.availability === null ? null : availabilityLabel(entry.availability);
  return (
    <>
      <p className="sb-catalogue__kicker">
        {KIND_LABELS[entry.kind]}
        {entry.domain !== null && ` · ${entry.domain}`}
      </p>
      {entry.description !== null && <p className="sb-catalogue__description">{entry.description}</p>}
      <dl className="sb-catalogue__facts">
        <dt>Identifiant</dt>
        <dd className="sb-mono">{entry.id}</dd>
        <dt>Version</dt>
        <dd className="sb-mono">{versionLabel(entry.version)}</dd>
        <dt>Propriétaire</dt>
        <dd>{entry.owner ?? "—"}</dd>
        <dt>Statut Atlas</dt>
        <dd>
          <Badge tone={status.tone}>{status.label}</Badge>
        </dd>
        {availability !== null && (
          <>
            <dt>Disponibilité</dt>
            <dd>
              <Badge tone={availability.tone}>{availability.label}</Badge>
              {availability.cause !== null && <span className="sb-catalogue__cause">{availability.cause}</span>}
            </dd>
          </>
        )}
        <dt>Synonymes</dt>
        <dd>{entry.synonyms.length === 0 ? "—" : entry.synonyms.join(", ")}</dd>
        <dt>Empreinte</dt>
        <dd className="sb-mono sb-catalogue__hash">{document.fingerprint ?? (entry.kind === "concept" ? "Sans objet : un concept n'a pas de graphe." : "Non calculée : définition non valide.")}</dd>
        <dt>Fichier</dt>
        <dd className="sb-mono">{document.path}</dd>
      </dl>
      {entry.kind === "kpi" && (
        <section className="sb-catalogue__section" aria-labelledby="fiche-correspondance">
          <h3 id="fiche-correspondance">Correspondance exécutable</h3>
          <p>
            Non disponible : Atlas ne définit pas encore de correspondance entre un KPI et un modèle sémantique skifer (AT-02). Le contrat de
            réagrégation (agrégation, additivité, grain) n'est donc pas connu.
          </p>
        </section>
      )}
      {document.issues.length > 0 && (
        <section className="sb-catalogue__section" aria-labelledby="fiche-diagnostics">
          <h3 id="fiche-diagnostics">Diagnostics Atlas · {formatNumber(document.issues.length)}</h3>
          <ul className="sb-catalogue__items">
            {document.issues.map((issue, index) => (
              <li key={`${issue.code}-${String(index)}`}>
                <Badge tone={issue.severity === "error" ? "danger" : "warning"}>{issue.severity === "error" ? "Erreur" : "Avertissement"}</Badge>{" "}
                <span className="sb-mono">{issue.code}</span> · {issue.message}
                {issue.path !== "" && <span className="sb-mono sb-catalogue__muted"> {issue.path}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {entry.kind === "kpi" && (
        <section className="sb-catalogue__section" aria-labelledby="fiche-declinaisons">
          <h3 id="fiche-declinaisons">Déclinaisons · {formatNumber(document.variants.length)}</h3>
          {document.variants.length === 0 ? (
            <p className="sb-catalogue__muted">Aucune déclinaison : la définition canonique s'applique à toutes les entités.</p>
          ) : (
            <ul className="sb-catalogue__items">
              {document.variants.map((variant) => (
                <li key={variant.id}>
                  <span className="sb-mono">{variant.entity}</span> · {MODE_LABELS[variant.mode] ?? variant.mode} ·{" "}
                  <span className="sb-mono">{versionLabel(variant.version)}</span> sur <span className="sb-mono">{versionLabel(variant.kpi_version)}</span>{" "}
                  <Badge tone={STATUS_LABELS[variant.status].tone}>{STATUS_LABELS[variant.status].label}</Badge>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <section className="sb-catalogue__section" aria-labelledby="fiche-references">
        <h3 id="fiche-references">Références · {formatNumber(document.references.length)}</h3>
        {document.references.length === 0 ? (
          <p className="sb-catalogue__muted">Aucune référence.</p>
        ) : (
          <ul className="sb-catalogue__items">
            {document.references.map((reference) => (
              <li key={`${reference.kind}-${reference.id}`}>
                {reference.label ?? <span className="sb-mono">{reference.id}</span>}
                {reference.version !== null && <span className="sb-mono"> {versionLabel(reference.version)}</span>}
                {reference.found ? null : (
                  <>
                    {" "}
                    <Badge tone="danger">Non résolue</Badge>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="sb-catalogue__section" aria-labelledby="fiche-utilisations">
        <h3 id="fiche-utilisations">Utilisée par · {formatNumber(document.referenced_by.length)}</h3>
        {document.referenced_by.length === 0 ? (
          <p className="sb-catalogue__muted">Aucun document Atlas ne la référence.</p>
        ) : (
          <ul className="sb-catalogue__items">
            {document.referenced_by.map((dependent) => (
              <li key={`${dependent.kind}-${dependent.id}`}>
                {dependent.label} <span className="sb-mono sb-catalogue__muted">{dependent.id}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="sb-catalogue__muted">
          Impact : {document.impact === 1 ? "1 document en dépend" : `${formatNumber(document.impact)} documents en dépendent`}, directement ou non.
        </p>
      </section>
    </>
  );
}
