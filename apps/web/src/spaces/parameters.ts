import { boolean, ContractError, instant, integer, list, nullable, object, oneOf, text } from "../catalogue/decode";
import { ENVIRONMENTS, type Environment } from "../shell/sections";
import type { Known, PersonRef } from "./model";

/**
 * Paramètres de déploiement d'un espace (plan 10). Les états résolus et la complétude viennent du
 * serveur (P4) : le navigateur les affiche, il ne les recalcule pas.
 */
export const PARAMETER_TYPES = ["text", "integer", "boolean", "choice", "identifier"] as const;

export type ParameterType = (typeof PARAMETER_TYPES)[number];

export const TYPE_LABELS: Record<ParameterType, string> = {
  text: "Texte",
  integer: "Entier",
  boolean: "Booléen",
  choice: "Choix",
  identifier: "Identifiant",
};

export const STATES = ["value", "default", "missing", "absent"] as const;

export type ValueState = (typeof STATES)[number];

export const STATE_LABELS: Record<ValueState, string> = {
  value: "valeur propre",
  default: "par défaut",
  missing: "manquant",
  absent: "absent",
};

export type ParameterValue = string | number | boolean;

/** Contraintes d'un type ; seules celles du type déclaré sont renseignées. */
export type Constraints =
  | { type: "text"; maxLength: number }
  | { type: "integer"; minimum: number | null; maximum: number | null }
  | { type: "boolean" }
  | { type: "choice"; choices: readonly string[] }
  | { type: "identifier" };

export interface Declaration {
  constraints: Constraints;
  required: boolean;
  default: ParameterValue | null;
  description: string;
}

export interface Parameter {
  name: string;
  declaration: Declaration;
  createdAt: Date;
  createdBy: PersonRef;
  createdByPerson: Known | null;
  updatedAt: Date;
  updatedBy: PersonRef;
  updatedByPerson: Known | null;
}

/** Valeur résolue d'un paramètre dans un environnement ; une valeur propre dit qui l'a posée. */
export interface Resolved {
  name: string;
  state: ValueState;
  value: ParameterValue | null;
  setAt: Date | null;
  setBy: PersonRef | null;
  setByPerson: Known | null;
}

export interface EnvironmentConfiguration {
  code: Environment;
  /** La session peut y poser ou vider une valeur (P6) ; le serveur reste seul juge. */
  canSet: boolean;
  complete: boolean;
  missing: readonly string[];
  /** Une entrée par paramètre, dans l'ordre des déclarations. */
  values: readonly Resolved[];
}

export interface Configuration {
  parameters: readonly Parameter[];
  environments: readonly EnvironmentConfiguration[];
}

/** Valeur posée, telle que le serveur la rend. */
export interface StoredValue {
  name: string;
  environment: Environment;
  value: ParameterValue;
  setAt: Date;
  setBy: PersonRef;
  setByPerson: Known | null;
}

const decodeRef = object<PersonRef>({ issuer: text, subject: text });
const decodeKnown = object<Known>({ name: nullable(text), email: nullable(text) });

function decodeConstraints(type: ParameterType, value: unknown, path: string): Constraints {
  switch (type) {
    case "text":
      return { type, maxLength: object({ max_length: integer })(value, path).max_length };
    case "integer": {
      const raw = object({ minimum: nullable(integer), maximum: nullable(integer) })(value, path);
      return { type, minimum: raw.minimum, maximum: raw.maximum };
    }
    case "choice":
      return { type, choices: object({ choices: list(text) })(value, path).choices };
    case "boolean":
    case "identifier":
      object({})(value, path);
      return { type };
  }
}

/** Une valeur du type déclaré : un texte pour un texte, un choix ou un identifiant, un entier, un booléen. */
function decodeValue(type: ParameterType): (value: unknown, path: string) => ParameterValue {
  if (type === "integer") {
    return integer;
  }
  return type === "boolean" ? boolean : text;
}

const decodeRawParameter = object({
  name: text,
  type: oneOf(PARAMETER_TYPES),
  constraints: (value: unknown) => value,
  required: boolean,
  default: (value: unknown) => value,
  description: text,
  created_at: instant,
  created_by: decodeRef,
  created_by_person: nullable(decodeKnown),
  updated_at: instant,
  updated_by: decodeRef,
  updated_by_person: nullable(decodeKnown),
});

export function decodeParameter(value: unknown, path: string): Parameter {
  const raw = decodeRawParameter(value, path);
  return {
    name: raw.name,
    declaration: {
      constraints: decodeConstraints(raw.type, raw.constraints, `${path}.constraints`),
      required: raw.required,
      default: nullable(decodeValue(raw.type))(raw.default, `${path}.default`),
      description: raw.description,
    },
    createdAt: raw.created_at,
    createdBy: raw.created_by,
    createdByPerson: raw.created_by_person,
    updatedAt: raw.updated_at,
    updatedBy: raw.updated_by,
    updatedByPerson: raw.updated_by_person,
  };
}

const decodeRawResolved = object({
  name: text,
  state: oneOf(STATES),
  value: (value: unknown) => value,
  set_at: nullable(instant),
  set_by: nullable(decodeRef),
  set_by_person: nullable(decodeKnown),
});

const decodeRawEnvironment = object({
  code: oneOf(ENVIRONMENTS),
  can_set: boolean,
  complete: boolean,
  missing: list(text),
  values: list(decodeRawResolved),
});

export function decodeConfiguration(value: unknown): Configuration {
  const raw = object({ parameters: list(decodeParameter), environments: list(decodeRawEnvironment) })(value, "réponse");
  // Environnements fixes et ordre invariable (plan 09, V1) : un autre ensemble est hors contrat.
  if (raw.environments.map((environment) => environment.code).join("|") !== ENVIRONMENTS.join("|")) {
    throw new ContractError(`réponse.environments : ${ENVIRONMENTS.join(" | ")} attendus dans cet ordre`);
  }
  const environments = raw.environments.map((environment, index) => {
    const path = `réponse.environments[${String(index)}]`;
    // Une valeur par paramètre, dans l'ordre des déclarations : sinon, laquelle afficher serait un choix silencieux.
    const values = environment.values.map((resolved, position) => {
      const at = `${path}.values[${String(position)}]`;
      const parameter = raw.parameters[position];
      if (parameter === undefined || parameter.name !== resolved.name) {
        throw new ContractError(`${at}.name : paramètre déclaré à cette place attendu`);
      }
      const type = parameter.declaration.constraints.type;
      const shown = resolved.state === "missing" || resolved.state === "absent";
      const own = resolved.state === "value";
      // Un état et sa valeur vont ensemble : une valeur pour « valeur propre » et « par défaut »,
      // aucune pour « manquant » et « absent » ; un auteur pour une valeur propre seulement.
      if (shown !== (resolved.value === null) || own !== (resolved.set_at !== null) || own !== (resolved.set_by !== null)) {
        throw new ContractError(`${at} : état ${resolved.state} incohérent avec sa valeur`);
      }
      return {
        name: resolved.name,
        state: resolved.state,
        value: nullable(decodeValue(type))(resolved.value, `${at}.value`),
        setAt: resolved.set_at,
        setBy: resolved.set_by,
        setByPerson: resolved.set_by_person,
      };
    });
    if (values.length !== raw.parameters.length) {
      throw new ContractError(`${path}.values : une valeur par paramètre déclaré`);
    }
    // Complétude et manquants vont avec les états : deux affichages contradictoires seraient un choix silencieux.
    const missing = values.filter((resolved) => resolved.state === "missing").map((resolved) => resolved.name);
    const differs = missing.length !== environment.missing.length || missing.some((name, index) => name !== environment.missing[index]);
    if (differs || environment.complete !== (missing.length === 0)) {
      throw new ContractError(`${path} : complétude incohérente avec les états « manquant »`);
    }
    return { code: environment.code, canSet: environment.can_set, complete: environment.complete, missing: environment.missing, values };
  });
  return { parameters: raw.parameters, environments };
}

export function decodeStoredValue(value: unknown, path: string): StoredValue {
  const raw = object({
    name: text,
    environment: oneOf(ENVIRONMENTS),
    value: (found: unknown) => found,
    set_at: instant,
    set_by: decodeRef,
    set_by_person: nullable(decodeKnown),
  })(value, path);
  if (typeof raw.value !== "string" && typeof raw.value !== "boolean" && !(typeof raw.value === "number" && Number.isInteger(raw.value))) {
    throw new ContractError(`${path}.value : texte, entier ou booléen attendu`);
  }
  return { name: raw.name, environment: raw.environment, value: raw.value, setAt: raw.set_at, setBy: raw.set_by, setByPerson: raw.set_by_person };
}

/**
 * Déclaration saisie, telle qu'envoyée : tous les champs présents (plan 10, P3). Les nombres mal
 * formés restent du texte, que le serveur refuse en nommant le champ : rien n'est arrondi ni corrigé ici.
 */
export interface DeclarationInput {
  type: ParameterType;
  constraints: Record<string, unknown>;
  required: boolean;
  default: unknown;
  description: string;
}

/** Entier saisi : un nombre s'il est écrit en chiffres et exact dans le navigateur, sinon le texte tel quel. */
export function integerOrText(raw: string): number | string {
  const parsed = Number(raw);
  return /^-?\d+$/.test(raw) && Number.isSafeInteger(parsed) ? parsed : raw;
}

/** Valeur affichée : un booléen en mot, le reste tel quel ; jamais arrondi ni mis en forme. */
export function valueLabel(value: ParameterValue): string {
  if (typeof value === "boolean") {
    return value ? "vrai" : "faux";
  }
  return String(value);
}

/** Type et contraintes en clair : « Texte · 64 caractères au plus », « Entier · de 1 à 100 ». */
export function constraintsLabel(constraints: Constraints): string {
  const type = TYPE_LABELS[constraints.type];
  switch (constraints.type) {
    case "text":
      return `${type} · ${String(constraints.maxLength)} ${constraints.maxLength === 1 ? "caractère" : "caractères"} au plus`;
    case "integer": {
      const { minimum, maximum } = constraints;
      if (minimum !== null && maximum !== null) {
        return `${type} · de ${String(minimum)} à ${String(maximum)}`;
      }
      if (minimum !== null) {
        return `${type} · ${String(minimum)} au moins`;
      }
      return maximum === null ? type : `${type} · ${String(maximum)} au plus`;
    }
    case "choice":
      return `${type} · ${constraints.choices.join(", ")}`;
    default:
      return type;
  }
}
