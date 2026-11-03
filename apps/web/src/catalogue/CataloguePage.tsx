import { useEffect, useId, useRef, useState } from "react";

import { formatAge } from "../format/date";
import { formatNumber } from "../format/number";
import { Badge } from "../ui/Badge";
import { Banner } from "../ui/Banner";
import { Card } from "../ui/Card";
import { catalogUrl, EMPTY_QUERY, fetchCatalog, type CatalogQuery, type Fetch, type Outcome } from "./api";
import { DocumentPanel } from "./DocumentPanel";
import { ProvenanceLine } from "./ProvenanceLine";
import { availabilityLabel, KIND_LABELS, PROBLEM_LABELS, shortCommit, STATUS_LABELS, versionLabel } from "./labels";
import { ATLAS_STATUSES, DOCUMENT_KINDS, type CatalogEntry, type CatalogPage, type Facets, type Provenance } from "./model";
import "./catalogue.css";

interface CataloguePageProps {
  /** Espace dont le catalogue est lu ; la lecture exige le rôle lecteur (plan 08, E9). */
  space: string;
  fetcher?: Fetch;
  now?: () => Date;
}

type Loading = { status: "loading" } | Outcome<CatalogPage>;

/** Catalogue métier (écrans §2), en lecture seule : les définitions appartiennent à Atlas. */
export function CataloguePage({ space, fetcher = fetch, now = () => new Date() }: CataloguePageProps) {
  const [query, setQuery] = useState<CatalogQuery>(EMPTY_QUERY);
  const [attempt, setAttempt] = useState(0);
  // Une réponse n'est affichée que pour la requête qui l'a demandée : sinon, chargement.
  const [answer, setAnswer] = useState<{ key: string; outcome: Outcome<CatalogPage> } | null>(null);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const openers = useRef(new Map<string, HTMLButtonElement>());
  const key = `${catalogUrl(space, query)}#${String(attempt)}`;
  const result: Loading = answer?.key === key ? answer.outcome : { status: "loading" };

  useEffect(() => {
    const controller = new AbortController();
    fetchCatalog(space, query, controller.signal, fetcher).then(
      (outcome) => {
        // Une réponse arrivée après l'abandon de sa requête n'est jamais affichée.
        if (controller.signal.aborted) {
          return;
        }
        setAnswer({ key, outcome });
        if (outcome.status === "ok") {
          setFacets(outcome.value.facets);
        }
      },
      () => undefined, // Lecture abandonnée : une requête plus récente la remplace.
    );
    return () => {
      controller.abort();
    };
  }, [key, space, query, fetcher]);

  const close = (id: string) => {
    setSelected(null);
    openers.current.get(id)?.focus();
  };

  if (result.status === "unavailable") {
    return (
      <>
        <PageHead />
        <Card title="Catalogue indisponible">
          <Banner tone="danger">
            Atlas est indisponible : {PROBLEM_LABELS[result.problem]}. {result.problem === "index_busy" ? "Le catalogue ne peut pas être servi maintenant." : "Aucun index antérieur n'existe ; le catalogue ne peut pas être servi."}
            <span className="sb-catalogue__detail">{result.detail}</span>
          </Banner>
        </Card>
      </>
    );
  }

  const page = result.status === "ok" ? result.value : null;
  return (
    <>
      <PageHead />
      {page?.provenance.freshness === "stale" && <StaleBanner provenance={page.provenance} now={now()} />}
      <div className="sb-catalogue">
        <Card title="Définitions" className="sb-catalogue__list">
          <Filters query={query} facets={facets} onChange={setQuery} />
          {result.status === "loading" && (
            <p className="sb-catalogue__state" role="status">
              Chargement du catalogue…
            </p>
          )}
          {result.status === "not_found" && (
            <Banner tone="danger">Le service du catalogue est introuvable sur ce serveur.</Banner>
          )}
          {result.status === "error" && (
            <Banner
              tone="danger"
              action={
                <button
                  type="button"
                  className="sb-button"
                  onClick={() => {
                    setAttempt((n) => n + 1);
                  }}
                >
                  Réessayer
                </button>
              }
            >
              Le catalogue n'a pas pu être lu. {result.message}
            </Banner>
          )}
          {page !== null && (
            <>
              <p className="sb-catalogue__count" role="status">
                {countLabel(page.entries.length)}
              </p>
              {page.entries.length === 0 ? (
                <p className="sb-catalogue__state">Aucune définition ne correspond à ces critères.</p>
              ) : (
                <EntryTable
                  entries={page.entries}
                  selected={selected}
                  onOpen={setSelected}
                  register={(id, button) => {
                    if (button === null) {
                      openers.current.delete(id);
                    } else {
                      openers.current.set(id, button);
                    }
                  }}
                />
              )}
              <ProvenanceLine provenance={page.provenance} now={now()} />
            </>
          )}
        </Card>
        {selected !== null && <DocumentPanel key={selected} space={space} id={selected} fetcher={fetcher} now={now} onClose={() => { close(selected); }} />}
      </div>
    </>
  );
}

function PageHead() {
  return (
    <div className="sb-page-head">
      <div>
        <h1 className="sb-page-head__title">Catalogue Atlas</h1>
        <p className="sb-page-head__lead">Définitions métier de l'espace Atlas, en lecture seule : elles se modifient dans Atlas.</p>
      </div>
    </div>
  );
}

function countLabel(count: number): string {
  return count === 1 ? "1 définition" : `${formatNumber(count)} définitions`;
}

function StaleBanner({ provenance, now }: { provenance: Provenance; now: Date }) {
  return (
    <Banner tone="warning">
      <strong>Atlas indisponible</strong> : {provenance.problem === null ? "le clone de l'espace n'a pas pu être relu" : PROBLEM_LABELS[provenance.problem]}. Catalogue servi depuis le
      dernier index connu, lu {formatAge(provenance.read_at, now)} (commit <span className="sb-mono">{shortCommit(provenance.commit)}</span>).
      {provenance.detail !== null && <span className="sb-catalogue__detail">{provenance.detail}</span>}
    </Banner>
  );
}

interface FiltersProps {
  query: CatalogQuery;
  facets: Facets | null;
  onChange: (query: CatalogQuery) => void;
}

function Filters({ query, facets, onChange }: FiltersProps) {
  const id = useId();
  // Une valeur choisie reste proposée même si les nouvelles facettes ne la contiennent plus.
  const options = <T extends string>(values: readonly T[], current: T | "") =>
    current === "" || values.includes(current) ? values : [...values, current];
  return (
    <form
      role="search"
      aria-label="Filtrer le catalogue"
      className="sb-catalogue__filters"
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <div className="sb-field sb-field--wide">
        <label htmlFor={`${id}-q`}>Rechercher</label>
        <input
          id={`${id}-q`}
          type="search"
          value={query.q}
          placeholder="Nom, identifiant ou synonyme"
          onChange={(event) => {
            onChange({ ...query, q: event.target.value });
          }}
        />
      </div>
      <div className="sb-field">
        <label htmlFor={`${id}-kind`}>Type</label>
        <select
          id={`${id}-kind`}
          value={query.kind}
          onChange={(event) => {
            onChange({ ...query, kind: DOCUMENT_KINDS.find((kind) => kind === event.target.value) ?? "" });
          }}
        >
          <option value="">Tous</option>
          {options(facets?.kind ?? DOCUMENT_KINDS, query.kind).map((kind) => (
            <option key={kind} value={kind}>
              {KIND_LABELS[kind]}
            </option>
          ))}
        </select>
      </div>
      <div className="sb-field">
        <label htmlFor={`${id}-domain`}>Domaine</label>
        <select
          id={`${id}-domain`}
          value={query.domain}
          onChange={(event) => {
            onChange({ ...query, domain: event.target.value });
          }}
        >
          <option value="">Tous</option>
          {options(facets?.domain ?? [], query.domain).map((domain) => (
            <option key={domain} value={domain}>
              {domain}
            </option>
          ))}
        </select>
      </div>
      <div className="sb-field">
        <label htmlFor={`${id}-owner`}>Propriétaire</label>
        <select
          id={`${id}-owner`}
          value={query.owner}
          onChange={(event) => {
            onChange({ ...query, owner: event.target.value });
          }}
        >
          <option value="">Tous</option>
          {options(facets?.owner ?? [], query.owner).map((owner) => (
            <option key={owner} value={owner}>
              {owner}
            </option>
          ))}
        </select>
      </div>
      <div className="sb-field">
        <label htmlFor={`${id}-status`}>Statut Atlas</label>
        <select
          id={`${id}-status`}
          value={query.status}
          onChange={(event) => {
            onChange({ ...query, status: ATLAS_STATUSES.find((status) => status === event.target.value) ?? "" });
          }}
        >
          <option value="">Tous</option>
          {options(facets?.status ?? ATLAS_STATUSES, query.status).map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status].label}
            </option>
          ))}
        </select>
      </div>
    </form>
  );
}

interface EntryTableProps {
  entries: readonly CatalogEntry[];
  selected: string | null;
  onOpen: (id: string) => void;
  register: (id: string, button: HTMLButtonElement | null) => void;
}

function EntryTable({ entries, selected, onOpen, register }: EntryTableProps) {
  return (
    <div className="sb-table-wrap" role="group" aria-label="Définitions du catalogue" tabIndex={0}>
      <table className="sb-table sb-catalogue__table">
        <caption className="sb-visually-hidden">Définitions du catalogue</caption>
        <thead>
          <tr>
            <th scope="col">Définition</th>
            <th scope="col">Domaine</th>
            <th scope="col" className="sb-num">
              Version
            </th>
            <th scope="col" className="sb-num">
              Déclinaisons
            </th>
            <th scope="col">Statut Atlas</th>
            <th scope="col">Disponibilité</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const status = STATUS_LABELS[entry.status];
            const availability = entry.availability === null ? null : availabilityLabel(entry.availability);
            return (
              <tr key={entry.id} className={entry.id === selected ? "sb-row--selected" : undefined}>
                <td>
                  <button
                    type="button"
                    className="sb-catalogue__open"
                    aria-expanded={entry.id === selected}
                    aria-controls={entry.id === selected ? "catalogue-fiche" : undefined}
                    ref={(button) => {
                      register(entry.id, button);
                    }}
                    onClick={() => {
                      onOpen(entry.id);
                    }}
                  >
                    {entry.label}
                  </button>
                  <span className="sb-catalogue__id">
                    {KIND_LABELS[entry.kind]} · <span className="sb-mono">{entry.id}</span>
                  </span>
                </td>
                <td>{entry.domain ?? "—"}</td>
                <td className="sb-num">{versionLabel(entry.version)}</td>
                <td className="sb-num">{entry.kind === "kpi" ? formatNumber(entry.variant_count) : "—"}</td>
                <td>
                  <Badge tone={status.tone}>{status.label}</Badge>
                </td>
                <td>
                  {availability === null ? (
                    <span className="sb-catalogue__muted">Sans objet</span>
                  ) : (
                    <>
                      <Badge tone={availability.tone}>{availability.label}</Badge>
                      {availability.short !== null && <span className="sb-catalogue__cause">{availability.short}</span>}
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
