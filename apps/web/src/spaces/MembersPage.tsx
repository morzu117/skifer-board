import { useEffect, useRef, useState, type SyntheticEvent } from "react";

import { formatInstant } from "../format/date";
import { Banner } from "../ui/Banner";
import { Card } from "../ui/Card";
import { useRefreshed } from "../ui/useOutcome";
import { AdminTabs, Confirm, FeedbackRegion, Journal, PrincipalCell, ReadFailure, Reading, samePrincipal, useAdminWrite } from "./AdminParts";
import { fetchEvents, fetchMembers, removeMember, setMember, type AdminOutcome } from "./admin";
import type { Fetch } from "./api";
import { EMPTY_DRAFT, PrincipalField, principalOf, type PrincipalDraft } from "./PrincipalField";
import { personLabel, principalLabel, ROLE_LABELS, ROLES, type Binding, type Principal, type Role, type Space } from "./model";
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

/**
 * « Membres et rôles » d'un espace (écrans §9, plan 08, 8.4). Le serveur décide de tout : la page
 * envoie la demande et rend sa réponse, refus compris, avec sa raison (E7, E8).
 */
export function MembersPage({ space, fetcher, onWritten }: MembersPageProps) {
  const [pending, setPending] = useState<Pending | null>(null);
  const { version, busy, feedback, setFeedback, announced, write } = useAdminWrite(onWritten, () => {
    setPending(null);
  });
  // Relu après chaque écriture : la liste et le journal sont ceux du serveur, jamais une copie corrigée sur place.
  // L'ancienne réponse reste affichée pendant la relecture : saisie et focus ne sont pas perdus.
  const members = useRefreshed(`members:${space.id}`, version, (signal) => fetchMembers(space.id, signal, fetcher));
  const events = useRefreshed(`events:${space.id}`, version, (signal) => fetchEvents(space.id, signal, fetcher));

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
      <AdminTabs space={space} current="members" />
      <Banner tone="neutral">
        <strong>{NO_DATA_RIGHT}</strong> Les données restent évaluées pour chaque personne, selon son identité et les règles de la source.
      </Banner>
      <FeedbackRegion feedback={feedback} announced={announced} />
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

interface MembersTableProps {
  members: { status: "loading" } | AdminOutcome<readonly Binding[]>;
  pending: Pending | null;
  busy: boolean;
  onPending: (pending: Pending | null) => void;
  onConfirm: (pending: Pending) => void;
}

function MembersTable({ members, pending, busy, onPending, onConfirm }: MembersTableProps) {
  if (members.status === "loading") {
    return <Reading>Lecture des liaisons…</Reading>;
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
        <PrincipalCell principal={binding.principal} person={binding.person} label={label} />
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
