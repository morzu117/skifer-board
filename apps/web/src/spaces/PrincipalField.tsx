import { useEffect, useId, useRef, useState } from "react";

import { Banner } from "../ui/Banner";
import { REFUSAL_LABELS, searchPeople, type AdminOutcome } from "./admin";
import type { Fetch } from "./api";
import { personDetail, personLabel, type KnownPerson, type Principal } from "./model";

/** Recherche limitée côté serveur (`QUERY_MAX`). */
export const QUERY_MAX = 200;
/** Nom de groupe limité côté serveur (`GROUP_MAX`). */
export const GROUP_MAX = 256;

/** Saisie d'un principal : un groupe par sa valeur exacte, ou une personne connue choisie par recherche (E3, E5). */
export type PrincipalDraft = { kind: "group"; name: string } | { kind: "person"; person: KnownPerson | null };

export const EMPTY_DRAFT: PrincipalDraft = { kind: "group", name: "" };

/** Principal à envoyer ; `null` tant que la saisie est incomplète. Le nom de groupe est gardé tel quel, sans repli. */
export function principalOf(draft: PrincipalDraft): Principal | null {
  if (draft.kind === "group") {
    return draft.name === "" ? null : { kind: "group", name: draft.name };
  }
  return draft.person === null ? null : { kind: "person", issuer: draft.person.issuer, subject: draft.person.subject };
}

interface PrincipalFieldProps {
  legend: string;
  draft: PrincipalDraft;
  onChange: (draft: PrincipalDraft) => void;
  fetcher: Fetch;
  disabled?: boolean;
  /** Erreur de saisie, montrée sous la légende et reliée au groupe de champs. */
  error?: { id: string; text: string } | undefined;
}

export function PrincipalField({ legend, draft, onChange, fetcher, disabled = false, error }: PrincipalFieldProps) {
  const id = useId();
  return (
    <fieldset className="sb-principal" disabled={disabled} aria-describedby={error?.id}>
      <legend className="sb-principal__legend">{legend}</legend>
      {error === undefined ? null : (
        <span id={error.id} tabIndex={-1} className="sb-create__problem">
          {error.text}
        </span>
      )}
      <div className="sb-principal__kinds">
        <label className="sb-principal__kind">
          <input
            type="radio"
            name={`${id}-kind`}
            checked={draft.kind === "group"}
            onChange={() => {
              onChange({ kind: "group", name: "" });
            }}
          />
          Groupe du fournisseur
        </label>
        <label className="sb-principal__kind">
          <input
            type="radio"
            name={`${id}-kind`}
            checked={draft.kind === "person"}
            onChange={() => {
              onChange({ kind: "person", person: null });
            }}
          />
          Personne connue
        </label>
      </div>
      {draft.kind === "group" ? (
        <label className="sb-field">
          Nom exact du groupe
          <input
            value={draft.name}
            maxLength={GROUP_MAX}
            spellCheck={false}
            autoComplete="off"
            aria-describedby={`${id}-group-hint`}
            onChange={(event) => {
              onChange({ kind: "group", name: event.target.value });
            }}
          />
          <span id={`${id}-group-hint`} className="sb-principal__hint">
            Valeur exacte du claim des groupes, casse comprise.
          </span>
        </label>
      ) : (
        <PersonPicker
          selected={draft.person}
          onSelect={(person) => {
            onChange({ kind: "person", person });
          }}
          fetcher={fetcher}
        />
      )}
    </fieldset>
  );
}

type Search = { status: "idle" } | { status: "loading" } | AdminOutcome<readonly KnownPerson[]>;

interface PersonPickerProps {
  selected: KnownPerson | null;
  onSelect: (person: KnownPerson | null) => void;
  fetcher: Fetch;
}

/** Choix d'une personne connue de Board, cherchée par nom ou par adresse (E5). */
function PersonPicker({ selected, onSelect, fetcher }: PersonPickerProps) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<Search>({ status: "idle" });
  const pending = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      pending.current?.abort();
    },
    [],
  );

  if (selected !== null) {
    return (
      <p className="sb-principal__chosen">
        <span>
          <strong>{personLabel(selected, selected)}</strong>
          <span className="sb-principal__hint"> · {personDetail(selected, selected)}</span>
        </span>
        <button
          type="button"
          className="sb-button"
          onClick={() => {
            onSelect(null);
          }}
        >
          Changer de personne
        </button>
      </p>
    );
  }

  const run = () => {
    if (query.trim() === "") {
      return;
    }
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setSearch({ status: "loading" });
    searchPeople(query, controller.signal, fetcher).then(
      (outcome) => {
        if (!controller.signal.aborted) {
          setSearch(outcome);
        }
      },
      () => undefined, // Recherche abandonnée : une plus récente la remplace.
    );
  };

  return (
    <div className="sb-principal__search">
      <div className="sb-principal__row">
        <label className="sb-field sb-field--wide">
          Nom ou adresse
          <input
            type="search"
            value={query}
            maxLength={QUERY_MAX}
            autoComplete="off"
            aria-describedby={`${id}-hint`}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                // Entrée cherche, sans envoyer le formulaire qui l'entoure.
                event.preventDefault();
                run();
              }
            }}
          />
        </label>
        <button type="button" className="sb-button" disabled={query.trim() === ""} onClick={run}>
          Chercher
        </button>
      </div>
      <span id={`${id}-hint`} className="sb-principal__hint">
        Seules les personnes déjà connectées une fois sont connues de Board.
      </span>
      <SearchResults search={search} onSelect={onSelect} />
    </div>
  );
}

function SearchResults({ search, onSelect }: { search: Search; onSelect: (person: KnownPerson) => void }) {
  if (search.status === "idle") {
    return null;
  }
  if (search.status === "loading") {
    return (
      <p role="status" aria-busy="true" className="sb-principal__hint">
        Recherche…
      </p>
    );
  }
  if (search.status === "refused") {
    return <Banner tone="danger">{REFUSAL_LABELS[search.code]}</Banner>;
  }
  if (search.status === "error") {
    return <Banner tone="danger">Recherche impossible : {search.message}</Banner>;
  }
  if (search.value.length === 0) {
    return (
      <p role="status" className="sb-principal__hint">
        Aucune personne connue ne correspond. Une personne s'ajoute après sa première connexion, ou par un groupe.
      </p>
    );
  }
  return (
    <ul className="sb-principal__results" aria-label="Personnes trouvées">
      {search.value.map((person) => (
        <li key={`${person.issuer}\n${person.subject}`}>
          <button
            type="button"
            className="sb-principal__pick"
            onClick={() => {
              onSelect(person);
            }}
          >
            <strong>{personLabel(person, person)}</strong>
            <span className="sb-principal__hint">{personDetail(person, person)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
