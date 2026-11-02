import { useEffect, useId, useRef, useState, type SyntheticEvent } from "react";

import { Banner } from "../ui/Banner";
import { Card } from "../ui/Card";
import { createSpace, type Refusal } from "./admin";
import type { Fetch, SpaceOutcome } from "./api";
import { refusalText } from "./AdminParts";
import { SPACE_ID, type Space, type SpaceList } from "./model";
import { EMPTY_DRAFT, PrincipalField, principalOf, type PrincipalDraft } from "./PrincipalField";
import "../catalogue/catalogue.css";
import "./spaces.css";

/** Nom affiché limité côté serveur (`NAME_MAX`). */
export const NAME_MAX = 80;

interface CreateSpacePageProps {
  listed: { status: "loading" } | SpaceOutcome<SpaceList>;
  fetcher: Fetch;
  /** Ouvre l'espace créé, sur ses membres. */
  onCreated: (space: Space) => void;
}

type Problem = "id" | "name" | "first_admin";

/**
 * Blanc retiré autour du nom : tous ceux que le serveur retire (`str.strip`), soit ceux de
 * JavaScript plus U+001C à U+001F et U+0085. U+FEFF, blanc pour JavaScript seulement, est aussi
 * retiré : le serveur l'accepterait, il ne refuse donc rien de plus.
 */
function isBlank(char: string): boolean {
  return /\s/u.test(char) || (char >= "\u001c" && char <= "\u001f") || char === "\u0085";
}

/** Nom tel que le serveur l'accepte : sans blancs autour (E12). */
export function bareName(name: string): string {
  let start = 0;
  let end = name.length;
  while (start < end && isBlank(name.charAt(start))) {
    start += 1;
  }
  while (end > start && isBlank(name.charAt(end - 1))) {
    end -= 1;
  }
  return name.slice(start, end);
}

const PROBLEMS: Record<Problem, string> = {
  id: "L'identifiant compte 2 à 40 caractères : lettres minuscules, chiffres et tirets, sans tiret au début ni à la fin.",
  name: "Le nom est obligatoire.",
  first_admin: "Choisissez le premier administrateur : un groupe ou une personne connue.",
};

/**
 * Création d'un espace, réservée aux administrateurs de la plateforme (plan 08, E6). L'identifiant
 * est définitif (E1) ; le premier administrateur garantit que l'espace n'est jamais sans administrateur (E8).
 */
export function CreateSpacePage({ listed, fetcher, onCreated }: CreateSpacePageProps) {
  return (
    <>
      <div className="sb-page-head">
        <div>
          <h1 className="sb-page-head__title">Nouvel espace</h1>
          <p className="sb-page-head__lead">Un rôle dans un espace ne donne aucun droit sur les données : elles restent évaluées pour chaque personne.</p>
        </div>
      </div>
      <Gate listed={listed} fetcher={fetcher} onCreated={onCreated} />
    </>
  );
}

function Gate({ listed, fetcher, onCreated }: CreateSpacePageProps) {
  if (listed.status === "loading") {
    return (
      <p role="status" aria-busy="true">
        Lecture de vos droits…
      </p>
    );
  }
  if (listed.status !== "ok") {
    return <Banner tone="danger">Droits indisponibles : {listed.status === "error" ? listed.message : "réponse inattendue du serveur."}</Banner>;
  }
  if (listed.value.spaces.some((space) => space.implicit)) {
    return <Banner tone="neutral">En mode local, Board n'a qu'un espace implicite : on n'en crée pas d'autre.</Banner>;
  }
  if (!listed.value.platformAdmin) {
    return <Banner tone="neutral">Seuls les administrateurs de la plateforme créent des espaces.</Banner>;
  }
  return <CreateForm fetcher={fetcher} onCreated={onCreated} />;
}

function CreateForm({ fetcher, onCreated }: Omit<CreateSpacePageProps, "listed">) {
  const id = useId();
  const [spaceId, setSpaceId] = useState("");
  const [name, setName] = useState("");
  const [draft, setDraft] = useState<PrincipalDraft>(EMPTY_DRAFT);
  const [checked, setChecked] = useState(false);
  // Chaque envoi refusé côté page porte le focus sur le premier champ en cause.
  const [attempt, setAttempt] = useState<object | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Refusal | string | null>(null);

  const firstAdmin = principalOf(draft);
  // Le nom est envoyé sans les blancs qui l'entourent : le serveur les refuserait.
  const trimmed = bareName(name);
  const problems: Problem[] = [];
  if (!SPACE_ID.test(spaceId)) {
    problems.push("id");
  }
  if (trimmed === "") {
    problems.push("name");
  }
  if (firstAdmin === null) {
    problems.push("first_admin");
  }
  const shown = checked ? problems : [];
  useEffect(() => {
    if (attempt !== null) {
      form.current?.querySelector<HTMLElement>('[aria-invalid="true"], .sb-create__problem[tabindex]')?.focus();
    }
  }, [attempt]);

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    setChecked(true);
    if (firstAdmin === null || problems.length > 0) {
      setAttempt({});
      return;
    }
    setBusy(true);
    setFailure(null);
    void createSpace({ id: spaceId, name: trimmed, firstAdmin }, fetcher).then((outcome) => {
      setBusy(false);
      if (outcome.status === "ok") {
        onCreated(outcome.value);
      } else {
        setFailure(outcome.status === "refused" ? { code: outcome.code, field: outcome.field } : outcome.message);
      }
    });
  };

  const invalid = (problem: Problem) => (shown.includes(problem) ? true : undefined);
  const described = (problem: Problem, hint: string) => (shown.includes(problem) ? `${hint} ${id}-${problem}` : hint);

  return (
    <Card title="Espace">
      <form ref={form} className="sb-create" onSubmit={submit} noValidate aria-label="Créer un espace">
        {failure === null ? null : (
          <Banner tone="danger">{typeof failure === "string" ? `Création non confirmée : ${failure}` : refusalText(failure)}</Banner>
        )}
        <label className="sb-field">
          Identifiant
          <input
            value={spaceId}
            maxLength={40}
            spellCheck={false}
            autoComplete="off"
            className="sb-mono"
            aria-invalid={invalid("id")}
            aria-describedby={described("id", `${id}-id-hint`)}
            disabled={busy}
            onChange={(event) => {
              setSpaceId(event.target.value);
            }}
          />
          <span id={`${id}-id-hint`} className="sb-principal__hint">
            Définitif : il figure dans les adresses de l'espace.
          </span>
          {shown.includes("id") ? (
            <span id={`${id}-id`} className="sb-create__problem">
              {PROBLEMS.id}
            </span>
          ) : null}
        </label>
        <label className="sb-field">
          Nom affiché
          <input
            value={name}
            maxLength={NAME_MAX}
            autoComplete="off"
            aria-invalid={invalid("name")}
            aria-describedby={shown.includes("name") ? `${id}-name` : undefined}
            disabled={busy}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
          {shown.includes("name") ? (
            <span id={`${id}-name`} className="sb-create__problem">
              {PROBLEMS.name}
            </span>
          ) : null}
        </label>
        <PrincipalField
          legend="Premier administrateur"
          draft={draft}
          onChange={setDraft}
          fetcher={fetcher}
          disabled={busy}
          error={shown.includes("first_admin") ? { id: `${id}-first_admin`, text: PROBLEMS.first_admin } : undefined}
        />
        <div>
          <button type="submit" className="sb-button sb-button--primary" disabled={busy}>
            {busy ? "Création…" : "Créer l'espace"}
          </button>
        </div>
      </form>
    </Card>
  );
}
