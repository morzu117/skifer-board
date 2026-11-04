import { boolean, ContractError, instant, list, nullable, object, oneOf, text } from "../catalogue/decode";

/**
 * Identité établie par le backend (plan 06, 6.3). Le navigateur ne voit jamais un jeton du
 * fournisseur : il lit `/api/me`, que le serveur remplit depuis la session.
 */
export interface Person {
  issuer: string;
  subject: string;
  name: string | null;
  email: string | null;
  groups: readonly string[];
}

export type Me = { established: false } | { established: true; identity: Person; expiresAt: Date };

const decodePerson = object<Person>({
  issuer: text,
  subject: text,
  name: nullable(text),
  email: nullable(text),
  groups: list(text),
});

const decodeEstablished = object({ identity: decodePerson, expires_at: instant });

export function decodeMe(value: unknown): Me {
  const { established } = object({ established: boolean })(value, "me");
  if (!established) {
    return { established: false };
  }
  const found = decodeEstablished(value, "me");
  return { established: true, identity: found.identity, expiresAt: found.expires_at };
}

/** Réponse 401 du serveur : l'adresse de connexion est un chemin de Board, jamais une autre origine. */
export function decodeUnauthenticated(value: unknown): string {
  const { error } = object({ error: object({ code: oneOf(["unauthenticated"] as const), login_url: text }) })(value, "réponse");
  const url = error.login_url;
  if (!url.startsWith("/") || url.startsWith("//")) {
    throw new ContractError("réponse.error.login_url : chemin de Board attendu");
  }
  return url;
}

/** Nom affiché : le nom, sinon l'adresse, sinon le sujet ; jamais vide. */
export function displayName(person: Person): string {
  return person.name ?? person.email ?? person.subject;
}

/** Raisons fermées d'une connexion qui n'aboutit pas (`contracts/identite/refus-connexion.json`). */
export const LOGIN_ERRORS = ["login_cancelled", "invalid_state", "code_rejected", "provider_unavailable", "token_refused"] as const;

export type LoginError = (typeof LOGIN_ERRORS)[number];

/** Pourquoi l'écran de connexion est affiché, au-delà de l'absence de session. */
export type LoginReason = LoginError | "session_expired" | "unknown";

export const LOGIN_REASON_LABELS: Record<LoginReason, string> = {
  login_cancelled: "La connexion a été annulée auprès du fournisseur d'identité.",
  invalid_state: "La demande de connexion a expiré ou ne vient pas de ce navigateur. Recommencez.",
  code_rejected: "Le fournisseur d'identité a refusé la connexion.",
  provider_unavailable: "Le fournisseur d'identité ne répond pas. Réessayez plus tard.",
  token_refused: "L'identité renvoyée par le fournisseur n'a pas pu être vérifiée.",
  session_expired: "Votre session a expiré. Reconnectez-vous pour continuer.",
  unknown: "La connexion a échoué.",
};

/** Raison passée par le serveur dans `?login_error=` ; une valeur inconnue reste un échec. */
export function loginReasonFrom(search: string): LoginReason | null {
  const value = new URLSearchParams(search).get("login_error");
  if (value === null) {
    return null;
  }
  return (LOGIN_ERRORS as readonly string[]).includes(value) ? (value as LoginError) : "unknown";
}
