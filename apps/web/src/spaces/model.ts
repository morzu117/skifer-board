import { boolean, instant, list, nullable, object, oneOf, text } from "../catalogue/decode";

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
});

export function decodeSpace(value: unknown, path: string): Space {
  const raw = decodeRaw(value, path);
  return {
    id: raw.id,
    name: raw.name,
    atlas: raw.atlas,
    createdAt: raw.created_at,
    createdBy: raw.created_by,
    role: raw.role,
    implicit: raw.implicit,
  };
}

export function decodeSpaceList(value: unknown): SpaceList {
  const raw = object({ spaces: list(decodeSpace), platform_admin: boolean })(value, "réponse");
  return { spaces: raw.spaces, platformAdmin: raw.platform_admin };
}

export function roleLabel(role: Role | null): string {
  return role === null ? NO_ROLE_LABEL : ROLE_LABELS[role];
}
