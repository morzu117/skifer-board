import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import { routeHash, type Route } from "../shell/route";
import { formatInstant } from "../format/date";
import { Badge } from "../ui/Badge";
import { Banner } from "../ui/Banner";
import { ENVIRONMENTS } from "../shell/sections";
import { REFUSAL_LABELS, type AdminOutcome, type Refusal } from "./admin";
import { constraintsLabel, decodeDeclaration, valueLabel, type Declaration, type ParameterValue } from "./parameters";
import { personDetail, personLabel, ROLE_LABELS, ROLES, type Known, type Principal, type Role, type Space, type SpaceEvent } from "./model";
import "./spaces.css";

/**
 * Pièces communes aux écrans d'administration d'un espace (plan 08, 8.4 ; plan 09, 9.4 ; plan 10, 10.3) : onglets,
 * écriture relue, retours et refus du serveur, confirmation sur place, journal.
 */

export type Feedback = { tone: "neutral"; text: string } | ({ tone: "danger" } & Refusal) | { tone: "error"; text: string };

/** Onglets des écrans d'administration, reliés l'un à l'autre (écrans §9). */
type AdminPage = "members" | "environments" | "parameters";

export function AdminTabs({ space, current }: { space: Space; current: AdminPage }) {
  const tabs: readonly { page: Route & { page: AdminPage }; label: string }[] = [
    { page: { page: "members", space: space.id }, label: "Membres et rôles" },
    { page: { page: "environments", space: space.id }, label: "Environnements" },
    { page: { page: "parameters", space: space.id }, label: "Paramètres" },
  ];
  return (
    <nav className="sb-admin-tabs" aria-label="Administration de l'espace">
      {tabs.map(({ page, label }) => (
        <a key={page.page} className="sb-admin-tabs__tab" href={routeHash(page)} aria-current={page.page === current ? "page" : undefined}>
          {label}
        </a>
      ))}
    </nav>
  );
}

interface AdminWrite {
  /** Révision des lectures : relues après chaque écriture, jamais corrigées sur place. */
  version: number;
  busy: boolean;
  feedback: Feedback | null;
  setFeedback: (feedback: Feedback | null) => void;
  /** Reçoit le focus après une écriture : la ligne confirmée a pu disparaître. */
  announced: RefObject<HTMLDivElement | null>;
  /** Rend `true` si le serveur a accepté. */
  write: <T>(run: () => Promise<AdminOutcome<T>>, done: string) => Promise<boolean>;
}

export function useAdminWrite(onWritten: (() => void) | undefined, onSettled?: () => void): AdminWrite {
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const announced = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (feedback !== null) {
      announced.current?.focus();
    }
  }, [feedback]);
  const write = async <T,>(run: () => Promise<AdminOutcome<T>>, done: string): Promise<boolean> => {
    setBusy(true);
    setFeedback(null);
    const outcome = await run();
    setBusy(false);
    onSettled?.();
    if (outcome.status === "ok") {
      setFeedback({ tone: "neutral", text: done });
    } else if (outcome.status === "refused") {
      const { code, field, environments, environment } = outcome;
      setFeedback({ tone: "danger", code, field, environments, environment });
    } else {
      setFeedback({ tone: "error", text: outcome.message });
    }
    setVersion((value) => value + 1);
    onWritten?.();
    return outcome.status === "ok";
  };
  return { version, busy, feedback, setFeedback, announced, write };
}

/** Réponse de la dernière écriture, qui reçoit le focus. */
export function FeedbackRegion({ feedback, announced }: { feedback: Feedback | null; announced: RefObject<HTMLDivElement | null> }) {
  if (feedback === null) {
    return null;
  }
  return (
    <div ref={announced} tabIndex={-1} className="sb-members__feedback">
      <FeedbackBanner feedback={feedback} />
    </div>
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

/** Libellé des champs qu'un `invalid_request` peut nommer (plan 08, E12 ; plan 09, V9 ; plan 10, P8). */
const FIELD_LABELS: Record<string, string> = {
  id: "identifiant",
  name: "nom",
  role: "rôle",
  environment: "environnement",
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
  type: "type",
  constraints: "contraintes",
  "constraints.max_length": "longueur maximale",
  "constraints.minimum": "minimum",
  "constraints.maximum": "maximum",
  "constraints.choices": "valeurs possibles",
  required: "obligatoire",
  default: "valeur par défaut",
  description: "description",
  value: "valeur",
  body: "corps de la demande",
};

export function refusalText(refusal: Refusal): string {
  if (refusal.environment !== undefined) {
    return `Cette action demande le droit de déployer en ${refusal.environment}.`;
  }
  const label = REFUSAL_LABELS[refusal.code];
  if (refusal.environments !== undefined && refusal.environments.length > 0) {
    return `${label} Environnements en cause : ${refusal.environments.join(", ")}.`;
  }
  if (refusal.field === null) {
    return label;
  }
  return `${label} Champ en cause : ${FIELD_LABELS[refusal.field] ?? refusal.field}.`;
}

/** `title` dit ce qui manque, accordé : « Liaisons indisponibles », « Journal indisponible ». */
export function ReadFailure({ outcome, title }: { outcome: Exclude<AdminOutcome<unknown>, { status: "ok" }>; title: string }) {
  if (outcome.status === "refused") {
    return <Banner tone="danger">{refusalText(outcome)}</Banner>;
  }
  return (
    <Banner tone="danger">
      {title} : {outcome.message} Rien n'est affiché.
    </Banner>
  );
}

/** Lecture en cours d'une liste d'administration. */
export function Reading({ children }: { children: ReactNode }) {
  return (
    <p role="status" aria-busy="true" className="sb-members__state">
      {children}
    </p>
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
export function Confirm({ question, action, busy, onConfirm, onCancel }: ConfirmProps) {
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

export function samePrincipal(left: Principal, right: Principal): boolean {
  if (left.kind === "group") {
    return right.kind === "group" && left.name === right.name;
  }
  return right.kind === "person" && left.issuer === right.issuer && left.subject === right.subject;
}

/** Libellé et détail d'un principal lié : badge Groupe ou Personne, adresse ou sujet d'une personne. */
export function PrincipalCell({ principal, person, label }: { principal: Principal; person: Known | null; label: string }) {
  return (
    <>
      <span>{label}</span>
      <span className="sb-members__detail">
        <Badge tone="neutral">{principal.kind === "group" ? "Groupe" : "Personne"}</Badge>
        {principal.kind === "group" ? null : (
          <>
            {person === null ? <span>Inconnue de Board ·</span> : null}
            <span className="sb-mono">{personDetail(principal, person)}</span>
          </>
        )}
      </span>
    </>
  );
}

const ACTION_LABELS = {
  space_created: "a créé l'espace",
  binding_added: "a ajouté",
  binding_changed: "a changé le rôle de",
  binding_removed: "a retiré",
  deploy_granted: "a accordé le droit de déployer",
  deploy_revoked: "a retiré le droit de déployer",
  parameter_declared: "a déclaré le paramètre",
  parameter_changed: "a modifié la déclaration de",
  parameter_removed: "a retiré le paramètre",
  value_set: "a posé la valeur de",
  value_cleared: "a vidé la valeur de",
} as const;

export function Journal({ events }: { events: { status: "loading" } | AdminOutcome<readonly SpaceEvent[]> }) {
  if (events.status === "loading") {
    return <Reading>Lecture du journal…</Reading>;
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

function isEnvironment(value: unknown): value is string {
  return (ENVIRONMENTS as readonly unknown[]).includes(value);
}

interface Target {
  /** Complément direct : « le groupe finance », « Dominique Leroy ». */
  named: string;
  /** Complément introduit par « à » : « au groupe finance », « à Dominique Leroy ». */
  toward: string;
}

/** Principal visé ; une personne est nommée par ce que le serveur sait d'elle, même retirée depuis. */
function journalPrincipal(value: unknown, person: SpaceEvent["principalPerson"]): Target | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const fields = value as Record<string, unknown>;
  if (fields.kind === "group" && isText(fields.name)) {
    return { named: `le groupe ${fields.name}`, toward: `au groupe ${fields.name}` };
  }
  if (fields.kind === "person" && isText(fields.issuer) && isText(fields.subject)) {
    const label = personLabel({ issuer: fields.issuer, subject: fields.subject }, person);
    return { named: label, toward: `à ${label}` };
  }
  return null;
}

function isValue(value: unknown): value is ParameterValue {
  return typeof value === "string" || typeof value === "boolean" || Number.isSafeInteger(value);
}

/** Déclaration du détail d'un événement, ou `null` si elle n'est pas au contrat : la ligne reste alors brute. */
function journalDeclaration(value: unknown): Declaration | null {
  try {
    return decodeDeclaration(value, "détail");
  } catch {
    return null;
  }
}

function defaultLabel(value: ParameterValue | null): string {
  return value === null ? "aucun" : valueLabel(value);
}

/** « Choix · eu-west, eu-central, obligatoire, sans défaut ». */
function declarationLabel(declaration: Declaration): string {
  const fallback = declaration.default === null ? "sans défaut" : `défaut ${valueLabel(declaration.default)}`;
  return `${constraintsLabel(declaration.constraints)}, ${declaration.required ? "obligatoire" : "facultatif"}, ${fallback}`;
}

/** Ce qui a changé d'une déclaration à l'autre, dans l'ordre de l'écran ; rien n'est tu. */
function declarationChanges(before: Declaration, after: Declaration): string {
  const changes: string[] = [];
  if (JSON.stringify(before.constraints) !== JSON.stringify(after.constraints)) {
    changes.push(`${constraintsLabel(before.constraints)} → ${constraintsLabel(after.constraints)}`);
  }
  if (before.required !== after.required) {
    changes.push(before.required ? "obligatoire → facultatif" : "facultatif → obligatoire");
  }
  if (before.default !== after.default) {
    changes.push(`défaut ${defaultLabel(before.default)} → ${defaultLabel(after.default)}`);
  }
  if (before.description !== after.description) {
    changes.push("description modifiée");
  }
  return changes.length === 0 ? "sans changement" : changes.join(" ; ");
}

/** Valeurs retirées avec un paramètre, dans l'ordre de promotion ; `null` si une entrée sort du contrat. */
function removedValues(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const entries = Object.entries(value);
  if (!entries.every(([environment, found]) => isEnvironment(environment) && isValue(found))) {
    return null;
  }
  // Le détail est rangé en JSONB, qui ne garde pas l'ordre des clés (plan 10, 10.2) : il est remis ici.
  const shown = ENVIRONMENTS.flatMap((environment) => entries.filter(([key]) => key === environment).map(([key, found]) => `${key} : ${valueLabel(found as ParameterValue)}`));
  return shown.length === 0 ? ", sans valeur posée" : ` et ses valeurs (${shown.join(", ")})`;
}

/** Phrase d'un événement de paramètre (plan 10, 10.4), ou `null` si l'action ou son détail sortent du contrat. */
function describeParameter(action: string, detail: Record<string, unknown>): string | null {
  const { name } = detail;
  if (!isText(name)) {
    return null;
  }
  if (action === "parameter_declared") {
    const declaration = journalDeclaration(detail.declaration);
    return declaration === null ? null : `${ACTION_LABELS.parameter_declared} ${name} : ${declarationLabel(declaration)}.`;
  }
  if (action === "parameter_changed") {
    const before = journalDeclaration(detail.before);
    const after = journalDeclaration(detail.after);
    return before === null || after === null ? null : `${ACTION_LABELS.parameter_changed} ${name} : ${declarationChanges(before, after)}.`;
  }
  if (action === "parameter_removed") {
    const values = removedValues(detail.values);
    return values === null ? null : `${ACTION_LABELS.parameter_removed} ${name}${values}.`;
  }
  if (!isEnvironment(detail.environment)) {
    return null;
  }
  const where = `${name} en ${detail.environment}`;
  if (action === "value_set" && isValue(detail.after) && (detail.before === null || isValue(detail.before))) {
    const change = detail.before === null ? valueLabel(detail.after) : `${valueLabel(detail.before)} → ${valueLabel(detail.after)}`;
    return `${ACTION_LABELS.value_set} ${where} : ${change}.`;
  }
  if (action === "value_cleared" && isValue(detail.before)) {
    return `${ACTION_LABELS.value_cleared} ${where} (était ${valueLabel(detail.before)}).`;
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
  const parameter = describeParameter(event.action, detail);
  if (parameter !== null) {
    return parameter;
  }
  const target = journalPrincipal(detail.principal, event.principalPerson);
  if (target === null) {
    return `action non reconnue : ${raw}`;
  }
  const principal = target.named;
  if (event.action === "binding_added" && isRole(detail.after)) {
    return `${ACTION_LABELS.binding_added} ${principal} : ${ROLE_LABELS[detail.after]}.`;
  }
  if (event.action === "binding_changed" && isRole(detail.before) && isRole(detail.after)) {
    return `${ACTION_LABELS.binding_changed} ${principal} : ${ROLE_LABELS[detail.before]} → ${ROLE_LABELS[detail.after]}.`;
  }
  if (event.action === "binding_removed" && isRole(detail.before)) {
    return `${ACTION_LABELS.binding_removed} ${principal} (${ROLE_LABELS[detail.before]}).`;
  }
  if ((event.action === "deploy_granted" || event.action === "deploy_revoked") && isEnvironment(detail.environment)) {
    return `${ACTION_LABELS[event.action]} en ${detail.environment} ${target.toward}.`;
  }
  return `action non reconnue : ${raw}`;
}
