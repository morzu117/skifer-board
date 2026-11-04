import { boolean, ContractError, instant, integer, json, list, nullable, object, oneOf, text } from "../catalogue/decode";
import { ENVIRONMENTS, type Environment } from "../shell/sections";

/**
 * Espaces vus par la personne (plan 08). Le rôle vient du serveur, recalculé à chaque requête :
 * le navigateur ne fait que l'afficher, il ne décide de rien (E7).
 */
export const ROLES = ["reader", "creator", "admin"] as const;

/** Format d'un identifiant d'espace (E1) ; un autre ne désigne aucun espace et n'est pas demandé au serveur. */
export const SPACE_ID = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = { reader: "Lecteur", creator: "Créateur", admin: "Administrateur" };

/** Administrateur de la plateforme sans rôle dans l'espace : il en gère les membres, il n'en lit rien (E6). */
export const NO_ROLE_LABEL = "Administration de la plateforme";

export interface PersonRef {
  issuer: string;
  subject: string;
}

/** Environnement d'un espace et droit de la personne d'y déployer, recalculé par le serveur (plan 09, V7). */
export interface SpaceEnvironment {
  code: Environment;
  deploy: boolean;
}

export interface Space {
  id: string;
  name: string;
  /** Rattachement Atlas de l'espace. */
  atlas: string;
  createdAt: Date;
  createdBy: PersonRef;
  role: Role | null;
  /** Espace implicite du mode local : ses membres ne se gèrent pas (E11). */
  implicit: boolean;
  /** Les trois environnements, dans l'ordre DEV | TEST | PROD (plan 09, V1). */
  environments: readonly SpaceEnvironment[];
}

export interface SpaceList {
  spaces: readonly Space[];
  platformAdmin: boolean;
}

const decodeRef = object<PersonRef>({ issuer: text, subject: text });

const decodeRaw = object({
  id: text,
  name: text,
  atlas: text,
  created_at: instant,
  created_by: decodeRef,
  role: nullable(oneOf(ROLES)),
  implicit: boolean,
  environments: list(object<SpaceEnvironment>({ code: oneOf(ENVIRONMENTS), deploy: boolean })),
});

export function decodeSpace(value: unknown, path: string): Space {
  const raw = decodeRaw(value, path);
  // Environnements fixes et ordre invariable (V1, RULES §9) : un autre ensemble est hors contrat.
  if (raw.environments.map((environment) => environment.code).join("|") !== ENVIRONMENTS.join("|")) {
    throw new ContractError(`${path}.environments : ${ENVIRONMENTS.join(" | ")} attendus dans cet ordre`);
  }
  return {
    id: raw.id,
    name: raw.name,
    atlas: raw.atlas,
    createdAt: raw.created_at,
    createdBy: raw.created_by,
    role: raw.role,
    implicit: raw.implicit,
    environments: raw.environments,
  };
}

export function decodeSpaceList(value: unknown): SpaceList {
  const raw = object({ spaces: list(decodeSpace), platform_admin: boolean })(value, "réponse");
  return { spaces: raw.spaces, platformAdmin: raw.platform_admin };
}

/** Environnements où la personne peut déployer, toujours dans l'ordre DEV | TEST | PROD ; le serveur reste seul juge (V7). */
export function deployCodes(space: Space): readonly Environment[] {
  return ENVIRONMENTS.filter((code) => space.environments.some((environment) => environment.code === code && environment.deploy));
}

export function roleLabel(role: Role | null): string {
  return role === null ? NO_ROLE_LABEL : ROLE_LABELS[role];
}

/**
 * Gère les membres de l'espace : administrateur de l'espace ou de la plateforme, hors espace
 * implicite (E6, E11). Sert à offrir les liens ; le serveur reste seul juge (E7).
 */
export function manages(space: Space, platformAdmin: boolean): boolean {
  // Un espace lisible sans rôle ne l'est qu'à l'administration de la plateforme (E6) : il se gère
  // même avant que la liste des espaces ait confirmé ce droit.
  return !space.implicit && (space.role === "admin" || space.role === null || platformAdmin);
}

/** Groupe du fournisseur, par sa valeur exacte, ou personne par son émetteur et son sujet (E3). */
export type Principal = { kind: "group"; name: string } | ({ kind: "person" } & PersonRef);

/** Nom et adresse d'une personne connue de Board ; `null` si elle ne l'est pas. */
export interface Known {
  name: string | null;
  email: string | null;
}

export interface Binding {
  id: string;
  principal: Principal;
  /** Personne liée, si elle est connue. */
  person: Known | null;
  role: Role;
  createdAt: Date;
  createdBy: PersonRef;
  createdByPerson: Known | null;
}

/** Droit de déployer accordé dans un environnement à un groupe ou à une personne (plan 09, V3). */
export interface DeployGrant {
  id: string;
  environment: Environment;
  principal: Principal;
  /** Personne visée, si elle est connue. */
  person: Known | null;
  createdAt: Date;
  createdBy: PersonRef;
  createdByPerson: Known | null;
}

export interface SpaceEvent {
  id: number;
  at: Date;
  actor: PersonRef;
  actorPerson: Known | null;
  action: string;
  /** Détail tel que journalisé : principal, rôle avant, rôle après, ou nom de l'espace. */
  detail: unknown;
  /** Personne visée par une liaison ou un accord, si elle est connue ; elle peut avoir été retirée depuis. */
  principalPerson: Known | null;
}

export interface KnownPerson extends PersonRef, Known {
  lastLogin: Date;
}

const decodeKnown = object<Known>({ name: nullable(text), email: nullable(text) });

function decodePrincipal(value: unknown, path: string): Principal {
  const { kind } = object({ kind: oneOf(["group", "person"] as const) })(value, path);
  if (kind === "group") {
    return { kind, ...object({ name: text })(value, path) };
  }
  return { kind, ...decodeRef(value, path) };
}

const decodeRawBinding = object({
  id: text,
  principal: decodePrincipal,
  person: nullable(decodeKnown),
  role: oneOf(ROLES),
  created_at: instant,
  created_by: decodeRef,
  created_by_person: nullable(decodeKnown),
});

export function decodeBinding(value: unknown, path: string): Binding {
  const raw = decodeRawBinding(value, path);
  return {
    id: raw.id,
    principal: raw.principal,
    person: raw.person,
    role: raw.role,
    createdAt: raw.created_at,
    createdBy: raw.created_by,
    createdByPerson: raw.created_by_person,
  };
}

export function decodeMembers(value: unknown): readonly Binding[] {
  return object({ members: list(decodeBinding) })(value, "réponse").members;
}

const decodeRawGrant = object({
  id: text,
  environment: oneOf(ENVIRONMENTS),
  principal: decodePrincipal,
  person: nullable(decodeKnown),
  created_at: instant,
  created_by: decodeRef,
  created_by_person: nullable(decodeKnown),
});

export function decodeGrant(value: unknown, path: string): DeployGrant {
  const raw = decodeRawGrant(value, path);
  return {
    id: raw.id,
    environment: raw.environment,
    principal: raw.principal,
    person: raw.person,
    createdAt: raw.created_at,
    createdBy: raw.created_by,
    createdByPerson: raw.created_by_person,
  };
}

export function decodeGrants(value: unknown): readonly DeployGrant[] {
  return object({ grants: list(decodeGrant) })(value, "réponse").grants;
}

const decodeRawEvent = object({
  id: integer,
  at: instant,
  actor: decodeRef,
  actor_person: nullable(decodeKnown),
  action: text,
  detail: json,
  principal_person: nullable(decodeKnown),
});

export function decodeEvents(value: unknown): readonly SpaceEvent[] {
  return object({ events: list(decodeRawEvent) })(value, "réponse").events.map((raw) => ({
    id: raw.id,
    at: raw.at,
    actor: raw.actor,
    actorPerson: raw.actor_person,
    action: raw.action,
    detail: raw.detail,
    principalPerson: raw.principal_person,
  }));
}

const decodeRawPerson = object({ issuer: text, subject: text, name: nullable(text), email: nullable(text), last_login: instant });

export function decodePeople(value: unknown): readonly KnownPerson[] {
  return object({ people: list(decodeRawPerson) })(value, "réponse").people.map((raw) => ({
    issuer: raw.issuer,
    subject: raw.subject,
    name: raw.name,
    email: raw.email,
    lastLogin: raw.last_login,
  }));
}

function filled(value: string | null | undefined): value is string {
  return value !== undefined && value !== null && value.trim() !== "";
}

/** Nom affiché d'une personne : son nom, sinon son adresse, sinon son sujet ; un nom vide ne compte pas. */
export function personLabel(ref: PersonRef, known: Known | null): string {
  if (filled(known?.name)) {
    return known.name;
  }
  return filled(known?.email) ? known.email : ref.subject;
}

/**
 * Ce qui distingue deux personnes de même libellé : l'adresse sous un nom, sinon le sujet, sinon
 * l'émetteur quand le sujet sert déjà de libellé. Mêmes règles que `personLabel`.
 */
export function personDetail(ref: PersonRef, known: Known | null): string {
  const name = filled(known?.name);
  const email = known?.email;
  if (name && filled(email)) {
    return email;
  }
  return name || filled(email) ? ref.subject : ref.issuer;
}

export function principalLabel(binding: { principal: Principal; person: Known | null }): string {
  return binding.principal.kind === "group" ? `Groupe ${binding.principal.name}` : personLabel(binding.principal, binding.person);
}
