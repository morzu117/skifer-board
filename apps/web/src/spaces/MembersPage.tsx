import { useEffect, useRef, useState, type SyntheticEvent, type ReactNode } from "react";

import { formatInstant } from "../format/date";
import { Badge } from "../ui/Badge";
import { Banner } from "../ui/Banner";
import { Card } from "../ui/Card";
import { useRefreshed } from "../ui/useOutcome";
import { fetchEvents, fetchMembers, REFUSAL_LABELS, removeMember, setMember, type AdminOutcome, type Refusal } from "./admin";
import type { Fetch } from "./api";
import { EMPTY_DRAFT, PrincipalField, principalOf, type PrincipalDraft } from "./PrincipalField";
import { personDetail, personLabel, principalLabel, ROLE_LABELS, ROLES, type Binding, type Principal, type Role, type Space, type SpaceEvent } from "./model";
import "../catalogue/catalogue.css";
import "../charts/charts.css";
import "./spaces.css";

/** Rappel permanent de l'écran (plan 08, 8.4). */
export const NO_DATA_RIGHT = "Un rôle ne donne aucun droit sur les données.";

interface MembersPageProps {
  space: Space;
  fetcher: Fetch;
  /** Après chaque écriture : la coque relit l'espace, dont le rôle a pu changer (E4). */
  onWritten?: () => void;
}

/** Changement en attente de confirmation sur une liaison. */
type Pending = { binding: Binding; action: "role"; role: Role } | { binding: Binding; action: "remove" };

type Feedback = { tone: "neutral"; text: string } | ({ tone: "danger" } & Refusal) | { tone: "error"; text: string };

/**
 * « Membres et rôles » d'un espace (écrans §9, plan 08, 8.4). Le serveur décide de tout : la page
 * envoie la demande et rend sa réponse, refus compris, avec sa raison (E7, E8).
 */
export function MembersPage({ space, fetcher, onWritten }: MembersPageProps) {
  // Relu après chaque écriture : la liste et le journal sont ceux du serveur, jamais une copie corrigée sur place.
  // L'ancienne réponse reste affichée pendant la relecture : saisie et focus ne sont pas perdus.
  const [version, setVersion] = useState(0);
  const members = useRefreshed(`members:${space.id}`, version, (signal) => fetchMembers(space.id, signal, fetcher));
  const events = useRefreshed(`events:${space.id}`, version, (signal) => fetchEvents(space.id, signal, fetcher));
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const announced = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // La réponse d'une écriture reçoit le focus : la ligne confirmée a pu disparaître.
    if (feedback !== null) {
      announced.current?.focus();
    }
  }, [feedback]);

  const write = async <T,>(run: () => Promise<AdminOutcome<T>>, done: string): Promise<boolean> => {
    setBusy(true);
    setFeedback(null);
    const outcome = await run();
    setBusy(false);
    setPending(null);
    if (outcome.status === "ok") {
      setFeedback({ tone: "neutral", text: done });
    } else if (outcome.status === "refused") {
      setFeedback({ tone: "danger", code: outcome.code, field: outcome.field });
    } else {
      setFeedback({ tone: "error", text: outcome.message });
    }
    setVersion((value) => value + 1);
    onWritten?.();
    return outcome.status === "ok";
  };

  const confirm = (change: Pending) => {
    const label = principalLabel(change.binding);
    if (change.action === "remove") {
      void write(() => removeMember(space.id, change.binding.id, fetcher), `Liaison retirée : ${label}.`);
    } else {
      void write(() => setMember(space.id, change.binding.principal, change.role, fetcher), `${label} : ${ROLE_LABELS[change.role]}.`);
    }
  };

  const bindings = members.status === "ok" ? members.value : null;

  return (
    <>
      <div className="sb-page-head">
        <div>
          <h1 className="sb-page-head__title">Membres et rôles</h1>
          <p className="sb-page-head__lead">
            {space.name} · <span className="sb-mono">{space.id}</span>
          </p>
        </div>
      </div>
      <Banner tone="neutral">
        <strong>{NO_DATA_RIGHT}</strong> Les données restent évaluées pour chaque personne, selon son identité et les règles de la source.
      </Banner>
      {feedback === null ? null : (
        <div ref={announced} tabIndex={-1} className="sb-members__feedback">
          <FeedbackBanner feedback={feedback} />
        </div>
      )}
      <Card title="Liaisons">
        <MembersTable
          members={members}
          pending={pending}
          busy={busy}
          onPending={(next) => {
            setFeedback(null);
            setPending(next);
          }}
          onConfirm={confirm}
        />
      </Card>
      {bindings === null ? null : (
        <AddBinding
          bindings={bindings}
          busy={busy}
          fetcher={fetcher}
          onAdd={(principal, role, label) => write(() => setMember(space.id, principal, role, fetcher), `${label} : ${ROLE_LABELS[role]}.`)}
        />
      )}
      <Card title="Journal de l'espace">
        <Journal events={events} />
      </Card>
    </>
  );
}

function FeedbackBanner({ feedback }: { feedback: Feedback }) {
  if (feedback.tone === "neutral") {
    return <Banner tone="neutral">{feedback.text}</Banner>;
  }
  if (feedback.tone === "error") {
    return <Banner tone="danger">Changement non confirmé : {feedback.text} La liste a été relue.</Banner>;
  }
  return <Banner tone="danger">{refusalText(feedback)}</Banner>;
}

/** Libellé des champs qu'un `invalid_request` peut nommer (E12). */
const FIELD_LABELS: Record<string, string> = {
  id: "identifiant",
  name: "nom",
  role: "rôle",
  principal: "membre",
  "principal.name": "nom du groupe",
  "principal.kind": "type de membre",
  "principal.issuer": "personne",
  "principal.subject": "personne",
  first_admin: "premier administrateur",
  "first_admin.kind": "type de premier administrateur",
  "first_admin.name": "nom du groupe",
  "first_admin.issuer": "personne",
  "first_admin.subject": "personne",
  body: "corps de la demande",
};

export function refusalText(refusal: Refusal): string {
  const label = REFUSAL_LABELS[refusal.code];
  if (refusal.field === null) {
    return label;
  }
  return `${label} Champ en cause : ${FIELD_LABELS[refusal.field] ?? refusal.field}.`;
}

/** `title` dit ce qui manque, accordé : « Liaisons indisponibles », « Journal indisponible ». */
function ReadFailure({ outcome, title }: { outcome: Exclude<AdminOutcome<unknown>, { status: "ok" }>; title: string }) {
  if (outcome.status === "refused") {
    return <Banner tone="danger">{refusalText(outcome)}</Banner>;
  }
  return (
    <Banner tone="danger">
      {title} : {outcome.message} Rien n'est affiché.
    </Banner>
  );
}

interface MembersTableProps {
  members: { status: "loading" } | AdminOutcome<readonly Binding[]>;
  pending: Pending | null;
  busy: boolean;
  onPending: (pending: Pending | null) => void;
  onConfirm: (pending: Pending) => void;
}

function MembersTable({ members, pending, busy, onPending, onConfirm }: MembersTableProps) {
  if (members.status === "loading") {
    return (
      <p role="status" aria-busy="true" className="sb-members__state">
        Lecture des liaisons…
      </p>
    );
  }
  if (members.status !== "ok") {
    return <ReadFailure outcome={members} title="Liaisons indisponibles" />;
  }
  if (members.value.length === 0) {
    // Le serveur garde toujours un administrateur (E8) : une liste vide n'est pas attendue, elle est dite.
    return <p className="sb-members__state">Aucune liaison.</p>;
  }
  return (
    <div className="sb-table-wrap" role="group" aria-label="Liaisons de l'espace" tabIndex={0}>
      <table className="sb-table sb-members">
        <caption className="sb-visually-hidden">Liaisons de l'espace</caption>
        <thead>
          <tr>
            <th scope="col">Membre</th>
            <th scope="col">Rôle</th>
            <th scope="col">Ajouté par</th>
            <th scope="col">Depuis</th>
            <th scope="col">
              <span className="sb-visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {members.value.map((binding) => (
            <MemberRow
              key={binding.id}
              binding={binding}
              pending={pending?.binding.id === binding.id ? pending : null}
              busy={busy}
              onPending={onPending}
              onConfirm={onConfirm}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface MemberRowProps {
  binding: Binding;
  pending: Pending | null;
  busy: boolean;
  onPending: (pending: Pending | null) => void;
  onConfirm: (pending: Pending) => void;
}

function MemberRow({ binding, pending, busy, onPending, onConfirm }: MemberRowProps) {
  const label = principalLabel(binding);
  // Une confirmation annulée rend le focus au bouton « Retirer » de la ligne.
  const retire = useRef<HTMLButtonElement>(null);
  const restore = useRef(false);
  useEffect(() => {
    if (pending === null && restore.current) {
      restore.current = false;
      retire.current?.focus();
    }
  }, [pending]);
  const shown = pending?.action === "role" ? pending.role : binding.role;
  return (
    <tr className={pending === null ? undefined : "sb-row--selected"}>
      <th scope="row" className="sb-members__principal">
        <span>{label}</span>
        <span className="sb-members__detail">
          <Badge tone="neutral">{binding.principal.kind === "group" ? "Groupe" : "Personne"}</Badge>
          {principalDetail(binding)}
        </span>
      </th>
      <td>
        <select
          className="sb-members__role"
          aria-label={`Rôle de ${label}`}
          value={shown}
          disabled={busy || pending?.action === "remove"}
          onChange={(event) => {
            const role = event.target.value as Role;
            onPending(role === binding.role ? null : { binding, action: "role", role });
          }}
        >
          {ROLES.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </select>
      </td>
      <td>{personLabel(binding.createdBy, binding.createdByPerson)}</td>
      <td className="sb-mono">{formatInstant(binding.createdAt)}</td>
      <td className="sb-members__actions">
        {pending === null ? (
          <button
            ref={retire}
            type="button"
            className="sb-button"
            disabled={busy}
            aria-label={`Retirer ${label}`}
            onClick={() => {
              onPending({ binding, action: "remove" });
            }}
          >
            Retirer
          </button>
        ) : (
          <Confirm
            question={
              pending.action === "remove"
                ? `Retirer ${label} ?`
                : `Passer ${label} de ${ROLE_LABELS[binding.role]} à ${ROLE_LABELS[pending.role]} ?`
            }
            action={pending.action === "remove" ? "Retirer" : "Confirmer"}
            busy={busy}
            onConfirm={() => {
              onConfirm(pending);
            }}
            onCancel={() => {
              restore.current = true;
              onPending(null);
            }}
          />
        )}
      </td>
    </tr>
  );
}

/** Ce qui identifie le principal sans ambiguïté : l'adresse ou le sujet d'une personne, rien pour un groupe déjà nommé. */
function principalDetail(binding: Binding): ReactNode {
  if (binding.principal.kind === "group") {
    return null;
  }
  return (
    <>
      {binding.person === null ? <span>Inconnue de Board ·</span> : null}
      <span className="sb-mono">{personDetail(binding.principal, binding.person)}</span>
    </>
  );
}

interface ConfirmProps {
  question: string;
  action: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirmation sur place ; le focus va au bouton de confirmation pour qu'un clavier enchaîne. */
function Confirm({ question, action, busy, onConfirm, onCancel }: ConfirmProps) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    button.current?.focus();
  }, []);
  return (
    <div className="sb-confirm" role="group" aria-label={question}>
      <span className="sb-confirm__question">{question}</span>
      <button ref={button} type="button" className="sb-button sb-button--primary" disabled={busy} onClick={onConfirm}>
        {action}
      </button>
      <button type="button" className="sb-button" disabled={busy} onClick={onCancel}>
        Annuler
      </button>
    </div>
  );
}

function samePrincipal(left: Principal, right: Principal): boolean {
  if (left.kind === "group") {
    return right.kind === "group" && left.name === right.name;
  }
  return right.kind === "person" && left.issuer === right.issuer && left.subject === right.subject;
}

interface AddBindingProps {
  bindings: readonly Binding[];
  busy: boolean;
  fetcher: Fetch;
  /** Rend `true` si le serveur a accepté ; la saisie n'est vidée qu'alors. */
  onAdd: (principal: Principal, role: Role, label: string) => Promise<boolean>;
}

/** Ajout d'une liaison. Un membre déjà lié change de rôle : la page le dit et le fait confirmer. */
function AddBinding({ bindings, busy, fetcher, onAdd }: AddBindingProps) {
  const [draft, setDraft] = useState<PrincipalDraft>(EMPTY_DRAFT);
  const [role, setRole] = useState<Role>("reader");
  const [confirming, setConfirming] = useState(false);
  const principal = principalOf(draft);
  const existing = principal === null ? undefined : bindings.find((binding) => samePrincipal(binding.principal, principal));
  const label = draft.kind === "group" ? `Groupe ${draft.name}` : draft.person === null ? "" : personLabel(draft.person, draft.person);

  const add = (chosen: Principal) => {
    setConfirming(false);
    void onAdd(chosen, role, label).then((accepted) => {
      // Un refus garde la saisie, pour la corriger sans tout reprendre.
      if (accepted) {
        setDraft(EMPTY_DRAFT);
      }
    });
  };

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (principal === null) {
      return;
    }
    if (existing !== undefined && existing.role !== role) {
      setConfirming(true);
      return;
    }
    add(principal);
  };

  return (
    <Card title="Ajouter une liaison">
      <form className="sb-members__add" onSubmit={submit} aria-label="Ajouter une liaison">
        <PrincipalField
          legend="Membre"
          draft={draft}
          onChange={(next) => {
            setConfirming(false);
            setDraft(next);
          }}
          fetcher={fetcher}
          disabled={busy}
        />
        <label className="sb-field sb-members__add-role">
          Rôle
          <select
            value={role}
            disabled={busy}
            onChange={(event) => {
              setConfirming(false);
              setRole(event.target.value as Role);
            }}
          >
            {ROLES.map((value) => (
              <option key={value} value={value}>
                {ROLE_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        {existing === undefined ? null : (
          <p className="sb-members__state" role="status">
            {existing.role === role
              ? `${label} a déjà le rôle ${ROLE_LABELS[role]} : rien ne changera.`
              : `${label} a déjà le rôle ${ROLE_LABELS[existing.role]}.`}
          </p>
        )}
        {confirming && existing !== undefined ? (
          <Confirm
            question={`Passer ${label} de ${ROLE_LABELS[existing.role]} à ${ROLE_LABELS[role]} ?`}
            action="Confirmer"
            busy={busy}
            onConfirm={() => {
              add(existing.principal);
            }}
            onCancel={() => {
              setConfirming(false);
            }}
          />
        ) : (
          <button type="submit" className="sb-button sb-button--primary" disabled={busy || principal === null || existing?.role === role}>
            Ajouter la liaison
          </button>
        )}
      </form>
    </Card>
  );
}

const ACTION_LABELS = {
  space_created: "a créé l'espace",
  binding_added: "a ajouté",
  binding_changed: "a changé le rôle de",
  binding_removed: "a retiré",
} as const;

interface JournalProps {
  events: { status: "loading" } | AdminOutcome<readonly SpaceEvent[]>;
}

function Journal({ events }: JournalProps) {
  if (events.status === "loading") {
    return (
      <p role="status" aria-busy="true" className="sb-members__state">
        Lecture du journal…
      </p>
    );
  }
  if (events.status !== "ok") {
    return <ReadFailure outcome={events} title="Journal indisponible" />;
  }
  if (events.value.length === 0) {
    return <p className="sb-members__state">Aucun événement.</p>;
  }
  return (
    <ol className="sb-journal" aria-label="Journal de l'espace">
      {events.value.map((event) => (
        <li key={event.id} className="sb-journal__item">
          <span className="sb-mono sb-journal__at">{formatInstant(event.at)}</span>
          <span>
            <strong>{personLabel(event.actor, event.actorPerson)}</strong> {describe(event)}
          </span>
        </li>
      ))}
    </ol>
  );
}

function isText(value: unknown): value is string {
  return typeof value === "string";
}

function isRole(value: unknown): value is Role {
  return (ROLES as readonly unknown[]).includes(value);
}

/** Principal visé ; une personne est nommée par ce que le serveur sait d'elle, même retirée depuis. */
function journalPrincipal(value: unknown, person: SpaceEvent["principalPerson"]): string | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const fields = value as Record<string, unknown>;
  if (fields.kind === "group" && isText(fields.name)) {
    return `le groupe ${fields.name}`;
  }
  if (fields.kind === "person" && isText(fields.issuer) && isText(fields.subject)) {
    const ref = { issuer: fields.issuer, subject: fields.subject };
    return personLabel(ref, person);
  }
  return null;
}

/** Phrase d'un événement. Une action ou un détail inattendus sont montrés tels quels, sans être interprétés. */
function describe(event: SpaceEvent): string {
  const raw = `${event.action} ${JSON.stringify(event.detail)}`;
  const detail = typeof event.detail === "object" && event.detail !== null ? (event.detail as Record<string, unknown>) : {};
  if (event.action === "space_created" && isText(detail.name)) {
    return `${ACTION_LABELS.space_created} « ${detail.name} ».`;
  }
  const principal = journalPrincipal(detail.principal, event.principalPerson);
  if (principal === null) {
    return `action non reconnue : ${raw}`;
  }
  if (event.action === "binding_added" && isRole(detail.after)) {
    return `${ACTION_LABELS.binding_added} ${principal} : ${ROLE_LABELS[detail.after]}.`;
  }
  if (event.action === "binding_changed" && isRole(detail.before) && isRole(detail.after)) {
    return `${ACTION_LABELS.binding_changed} ${principal} : ${ROLE_LABELS[detail.before]} → ${ROLE_LABELS[detail.after]}.`;
  }
  if (event.action === "binding_removed" && isRole(detail.before)) {
    return `${ACTION_LABELS.binding_removed} ${principal} (${ROLE_LABELS[detail.before]}).`;
  }
  return `action non reconnue : ${raw}`;
}
