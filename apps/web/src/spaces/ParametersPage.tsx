import { useEffect, useId, useRef, useState, type ChangeEvent, type ReactNode, type SyntheticEvent } from "react";

import { formatInstant } from "../format/date";
import type { Environment } from "../shell/sections";
import { Badge, type BadgeTone } from "../ui/Badge";
import { Banner } from "../ui/Banner";
import { Card } from "../ui/Card";
import { useRefreshed } from "../ui/useOutcome";
import { AdminTabs, Confirm, FeedbackRegion, Journal, ReadFailure, Reading, useAdminWrite } from "./AdminParts";
import {
  clearParameterValue,
  declareParameter,
  fetchEvents,
  fetchParameters,
  redeclareParameter,
  removeParameter,
  setParameterValue,
  type AdminOutcome,
} from "./admin";
import type { Fetch } from "./api";
import { personLabel, type Space } from "./model";
import {
  constraintsLabel,
  integerOrText,
  missingLabel,
  PARAMETER_TYPES,
  STATE_LABELS,
  TYPE_LABELS,
  valueLabel,
  type Configuration,
  type DeclarationInput,
  type Parameter,
  type ParameterType,
  type Resolved,
  type ValueState,
} from "./parameters";
import "../catalogue/catalogue.css";
import "./spaces.css";

/** Rappel permanent de l'écran (plan 10, 10.3). */
export const PARAMETER_REMINDER = "Un paramètre n'est jamais un secret, et changer une valeur demande le droit de déployer dans l'environnement.";

const STATE_TONES: Record<ValueState, BadgeTone> = { value: "neutral", default: "neutral", missing: "danger", absent: "neutral" };

interface ParametersPageProps {
  space: Space;
  fetcher: Fetch;
  /** Environnement choisi dans la coque : proposé d'abord pour poser une valeur. */
  target: Environment;
  /** Après chaque écriture : la coque relit l'espace. */
  onWritten?: () => void;
}

/** Valeur à modifier, choisie depuis la grille ; `nonce` distingue deux choix identiques successifs. */
interface Selection {
  name: string;
  environment: Environment;
  nonce: number;
}

type Pending = { action: "remove"; name: string } | { action: "clear"; name: string; environment: Environment };

/**
 * « Paramètres » d'un espace (écrans §9, plan 10, 10.3) : les paramètres déclarés et leur valeur dans
 * chaque environnement. Le serveur décide de tout, états résolus et complétude compris : la page
 * envoie la demande et rend sa réponse, refus compris, avec sa raison.
 */
export function ParametersPage({ space, fetcher, target, onWritten }: ParametersPageProps) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [editing, setEditing] = useState<Parameter | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const { version, busy, feedback, setFeedback, announced, write } = useAdminWrite(onWritten, () => {
    setPending(null);
  });
  const configuration = useRefreshed(`parameters:${space.id}`, version, (signal) => fetchParameters(space.id, signal, fetcher));
  const events = useRefreshed(`events:${space.id}`, version, (signal) => fetchEvents(space.id, signal, fetcher));

  return (
    <>
      <div className="sb-page-head">
        <div>
          <h1 className="sb-page-head__title">Paramètres</h1>
          <p className="sb-page-head__lead">
            {space.name} · <span className="sb-mono">{space.id}</span>
          </p>
        </div>
      </div>
      <AdminTabs space={space} current="parameters" />
      <Banner tone="neutral">
        <strong>{PARAMETER_REMINDER}</strong> Une valeur est une donnée typée, jamais un fragment de requête.
      </Banner>
      <FeedbackRegion feedback={feedback} announced={announced} />
      <Card title="Paramètres déclarés">
        <ParametersGrid
          configuration={configuration}
          target={target}
          editing={editing?.name ?? null}
          pending={pending}
          busy={busy}
          onPending={(next) => {
            setFeedback(null);
            setPending(next);
          }}
          onConfirm={(confirmed) => {
            if (confirmed.action === "remove") {
              void write(() => removeParameter(space.id, confirmed.name, fetcher), `Paramètre ${confirmed.name} retiré, avec ses valeurs.`).then((accepted) => {
                if (accepted && editing?.name === confirmed.name) {
                  setEditing(null);
                }
              });
            } else {
              void write(
                () => clearParameterValue(space.id, confirmed.name, confirmed.environment, fetcher),
                `Valeur de ${confirmed.name} en ${confirmed.environment} vidée.`,
              );
            }
          }}
          onEdit={(parameter) => {
            setFeedback(null);
            setEditing(parameter);
          }}
          onSelect={(name, environment) => {
            setFeedback(null);
            setSelection({ name, environment, nonce: (selection?.nonce ?? 0) + 1 });
          }}
        />
      </Card>
      {configuration.status === "ok" ? (
        <ValueForm
          configuration={configuration.value}
          target={target}
          selection={selection}
          busy={busy}
          onSet={(name, environment, value, shown) =>
            write(() => setParameterValue(space.id, name, environment, value, fetcher), `${name} en ${environment} : ${shown}.`)
          }
        />
      ) : null}
      {configuration.status === "ok" ? (
        <DeclarationForm
          editing={editing}
          busy={busy}
          onCancel={() => {
            setEditing(null);
          }}
          onSubmit={(name, input) => {
            if (editing === null) {
              return write(() => declareParameter(space.id, name, input, fetcher), `Paramètre ${name} déclaré.`);
            }
            return write(() => redeclareParameter(space.id, name, input, fetcher), `Déclaration de ${name} enregistrée.`).then((accepted) => {
              if (accepted) {
                setEditing(null);
              }
              return accepted;
            });
          }}
        />
      ) : null}
      <Card title="Journal de l'espace">
        <Journal events={events} />
      </Card>
    </>
  );
}

interface ParametersGridProps {
  configuration: { status: "loading" } | AdminOutcome<Configuration>;
  target: Environment;
  /** Paramètre dont la déclaration est ouverte dans le formulaire. */
  editing: string | null;
  pending: Pending | null;
  busy: boolean;
  onPending: (pending: Pending | null) => void;
  onConfirm: (pending: Pending) => void;
  onEdit: (parameter: Parameter) => void;
  onSelect: (name: string, environment: Environment) => void;
}

/** Grille paramètres × environnements, dans l'ordre DEV | TEST | PROD ; la complétude en tête de colonne. */
function ParametersGrid({ configuration, target, editing, pending, busy, onPending, onConfirm, onEdit, onSelect }: ParametersGridProps) {
  if (configuration.status === "loading") {
    return <Reading>Lecture des paramètres…</Reading>;
  }
  if (configuration.status !== "ok") {
    return <ReadFailure outcome={configuration} title="Paramètres indisponibles" />;
  }
  const { parameters, environments } = configuration.value;
  if (parameters.length === 0) {
    return <p className="sb-members__state">Aucun paramètre déclaré : chaque environnement est complet.</p>;
  }
  return (
    <div className="sb-table-wrap" role="group" aria-label="Paramètres et valeurs par environnement" tabIndex={0}>
      <table className="sb-table sb-params">
        <caption className="sb-visually-hidden">Paramètres et valeurs par environnement</caption>
        <thead>
          <tr>
            <th scope="col">Paramètre</th>
            <th scope="col">Type et contraintes</th>
            <th scope="col">Obligatoire</th>
            <th scope="col">Défaut</th>
            {environments.map((environment) => (
              <th key={environment.code} scope="col" className={environment.code === target ? "sb-params__env sb-params__env--target" : "sb-params__env"}>
                <span className="sb-mono">{environment.code}</span>
                {/* La cible se dit en mots, pas seulement par sa couleur (RULES §2). */}
                {environment.code === target ? <span className="sb-params__note">environnement affiché</span> : null}
                {environment.complete ? <Badge tone="success">complet</Badge> : <Badge tone="danger">incomplet · {missingLabel(environment.missing.length)}</Badge>}
              </th>
            ))}
            <th scope="col">
              <span className="sb-visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {parameters.map((parameter, position) => (
            <ParameterRow
              key={parameter.name}
              parameter={parameter}
              cells={environments.map((environment) => ({
                environment: environment.code,
                canSet: environment.canSet,
                // Le décodage garantit une valeur par paramètre, à la même place.
                resolved: environment.values[position] as Resolved,
              }))}
              target={target}
              editing={editing === parameter.name}
              pending={pending}
              busy={busy}
              onPending={onPending}
              onConfirm={onConfirm}
              onEdit={onEdit}
              onSelect={onSelect}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface Cell {
  environment: Environment;
  canSet: boolean;
  resolved: Resolved;
}

interface ParameterRowProps {
  parameter: Parameter;
  cells: readonly Cell[];
  target: Environment;
  editing: boolean;
  pending: Pending | null;
  busy: boolean;
  onPending: (pending: Pending | null) => void;
  onConfirm: (pending: Pending) => void;
  onEdit: (parameter: Parameter) => void;
  onSelect: (name: string, environment: Environment) => void;
}

function ParameterRow({ parameter, cells, target, editing, pending, busy, onPending, onConfirm, onEdit, onSelect }: ParameterRowProps) {
  const { name, declaration } = parameter;
  const removing = pending?.action === "remove" && pending.name === name ? pending : null;
  // Une confirmation annulée rend le focus au bouton qui l'a ouverte.
  const retire = useRef<HTMLButtonElement>(null);
  const restore = useRef(false);
  useEffect(() => {
    if (removing === null && restore.current) {
      restore.current = false;
      retire.current?.focus();
    }
  }, [removing]);
  return (
    <tr className={removing === null && !editing ? undefined : "sb-row--selected"}>
      <th scope="row" className="sb-params__name">
        <span className="sb-mono">{name}</span>
        {declaration.description === "" ? null : <span className="sb-params__description">{declaration.description}</span>}
      </th>
      <td>{constraintsLabel(declaration.constraints)}</td>
      <td>{declaration.required ? "oui" : "non"}</td>
      <td>{declaration.default === null ? <span className="sb-params__none">aucun</span> : <span className="sb-mono">{valueLabel(declaration.default)}</span>}</td>
      {cells.map((cell) => (
        <ValueCell
          key={cell.environment}
          name={name}
          cell={cell}
          isTarget={cell.environment === target}
          pending={pending?.action === "clear" && pending.name === name && pending.environment === cell.environment}
          busy={busy}
          onPending={onPending}
          onConfirm={onConfirm}
          onSelect={onSelect}
        />
      ))}
      <td className="sb-members__actions">
        {removing === null ? (
          <span className="sb-params__actions">
            <button
              type="button"
              className="sb-button"
              disabled={busy}
              aria-label={`Modifier la déclaration de ${name}`}
              onClick={() => {
                onEdit(parameter);
              }}
            >
              Modifier
            </button>
            <button
              ref={retire}
              type="button"
              className="sb-button"
              disabled={busy}
              aria-label={`Retirer le paramètre ${name}`}
              onClick={() => {
                onPending({ action: "remove", name });
              }}
            >
              Retirer
            </button>
          </span>
        ) : (
          <Confirm
            question={`Retirer le paramètre ${name} et ses valeurs\u00a0?`}
            action="Retirer"
            busy={busy}
            onConfirm={() => {
              onConfirm(removing);
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

interface ValueCellProps {
  name: string;
  cell: Cell;
  isTarget: boolean;
  pending: boolean;
  busy: boolean;
  onPending: (pending: Pending | null) => void;
  onConfirm: (pending: Pending) => void;
  onSelect: (name: string, environment: Environment) => void;
}

function ValueCell({ name, cell, isTarget, pending, busy, onPending, onConfirm, onSelect }: ValueCellProps) {
  const { environment, canSet, resolved } = cell;
  const clear = useRef<HTMLButtonElement>(null);
  const restore = useRef(false);
  useEffect(() => {
    if (!pending && restore.current) {
      restore.current = false;
      clear.current?.focus();
    }
  }, [pending]);
  return (
    <td className={isTarget ? "sb-params__value sb-params__value--target" : "sb-params__value"}>
      <span className="sb-params__resolved">
        {resolved.value === null ? <span className="sb-params__none">—</span> : <span className="sb-mono">{valueLabel(resolved.value)}</span>}
        <Badge tone={STATE_TONES[resolved.state]}>{STATE_LABELS[resolved.state]}</Badge>
      </span>
      {resolved.setAt !== null && resolved.setBy !== null ? (
        <span className="sb-params__meta">
          {personLabel(resolved.setBy, resolved.setByPerson)} · <span className="sb-mono">{formatInstant(resolved.setAt)}</span>
        </span>
      ) : null}
      {!canSet ? null : pending ? (
        <Confirm
          question={`Vider la valeur de ${name} en ${environment}\u00a0?`}
          action="Vider"
          busy={busy}
          onConfirm={() => {
            onConfirm({ action: "clear", name, environment });
          }}
          onCancel={() => {
            restore.current = true;
            onPending(null);
          }}
        />
      ) : (
        <span className="sb-params__actions">
          <button
            type="button"
            className="sb-button"
            disabled={busy}
            aria-label={`${resolved.state === "value" ? "Changer" : "Poser"} la valeur de ${name} en ${environment}`}
            onClick={() => {
              onSelect(name, environment);
            }}
          >
            {resolved.state === "value" ? "Changer" : "Poser"}
          </button>
          {resolved.state === "value" ? (
            <button
              ref={clear}
              type="button"
              className="sb-button"
              disabled={busy}
              aria-label={`Vider la valeur de ${name} en ${environment}`}
              onClick={() => {
                onPending({ action: "clear", name, environment });
              }}
            >
              Vider
            </button>
          ) : null}
        </span>
      )}
    </td>
  );
}

interface FieldProps {
  label: string;
  /** Aide liée au contrôle par `aria-describedby` : elle ne s'ajoute pas à son nom. */
  hint?: string;
  children: (control: { id: string; describedBy: string | undefined }) => ReactNode;
}

function Field({ label, hint, children }: FieldProps) {
  const id = useId();
  const hintId = useId();
  return (
    <div className="sb-field">
      <label htmlFor={id}>{label}</label>
      {children({ id, describedBy: hint === undefined ? undefined : hintId })}
      {hint === undefined ? null : (
        <span id={hintId} className="sb-field__hint">
          {hint}
        </span>
      )}
    </div>
  );
}

interface ValueFormProps {
  configuration: Configuration;
  target: Environment;
  selection: Selection | null;
  busy: boolean;
  /** Rend `true` si le serveur a accepté ; la saisie n'est vidée qu'alors. */
  onSet: (name: string, environment: Environment, value: unknown, shown: string) => Promise<boolean>;
}

/** Valeur saisie, convertie selon le type : un booléen choisi, un entier écrit en chiffres, sinon le texte tel quel. */
function typedValue(type: ParameterType, draft: string): unknown {
  if (type === "boolean") {
    return draft === "true";
  }
  return type === "integer" ? integerOrText(draft) : draft;
}

/** Options d'une liste de valeurs : vrai et faux, ou les valeurs possibles d'un choix. */
function ValueOptions({ type, choices }: { type: "boolean" | "choice"; choices: readonly string[] }) {
  const values = type === "boolean" ? ["true", "false"] : choices;
  // Par position : deux lignes identiques saisies dans un choix restent deux options, que le serveur refusera.
  return values.map((choice, index) => (
    <option key={`${String(index)}:${choice}`} value={choice}>
      {type === "boolean" ? valueLabel(choice === "true") : choice}
    </option>
  ));
}

/** Poser une valeur dans un environnement où le serveur l'autorise, avec un contrôle adapté au type. */
function ValueForm({ configuration, target, selection, busy, onSet }: ValueFormProps) {
  const settable = configuration.environments.filter((environment) => environment.canSet).map((environment) => environment.code);
  const preferred = (wanted: Environment): Environment | undefined => (settable.includes(wanted) ? wanted : settable[0]);
  const [name, setName] = useState(configuration.parameters[0]?.name ?? "");
  const [environment, setEnvironment] = useState<Environment | undefined>(preferred(target));
  const [draft, setDraft] = useState("");
  const control = useRef<HTMLInputElement & HTMLSelectElement>(null);
  // L'environnement proposé suit la cible de la coque ; un choix fait depuis la grille l'emporte.
  const [seenTarget, setSeenTarget] = useState(target);
  if (seenTarget !== target) {
    setSeenTarget(target);
    setEnvironment(preferred(target));
  }
  const [seenSelection, setSeenSelection] = useState<Selection | null>(null);
  if (selection !== null && selection !== seenSelection) {
    setSeenSelection(selection);
    setName(selection.name);
    setEnvironment(selection.environment);
    // Seule une valeur propre préremplit la saisie : un défaut recopié deviendrait une valeur propre.
    const resolved = configuration.environments.find((found) => found.code === selection.environment)?.values.find((found) => found.name === selection.name);
    setDraft(resolved?.state === "value" && resolved.value !== null ? String(resolved.value) : "");
  }
  useEffect(() => {
    if (selection !== null) {
      control.current?.focus();
    }
  }, [selection]);

  const [first] = configuration.parameters;
  const [firstSettable] = settable;
  if (firstSettable === undefined) {
    return (
      <Card title="Poser une valeur">
        <p className="sb-members__state">Vous ne pouvez poser de valeur dans aucun environnement : il faut le rôle Administrateur dans l'espace et le droit d'y déployer.</p>
      </Card>
    );
  }
  if (first === undefined) {
    return null;
  }
  // Un paramètre retiré depuis le choix revient au premier ; un environnement choisi reste dans la liste autorisée.
  const parameter = configuration.parameters.find((found) => found.name === name) ?? first;
  const chosen = environment !== undefined && settable.includes(environment) ? environment : firstSettable;
  const { constraints } = parameter.declaration;

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    const value = typedValue(constraints.type, draft);
    const shown = typeof value === "boolean" ? valueLabel(value) : draft;
    void onSet(parameter.name, chosen, value, shown).then((accepted) => {
      // Un refus garde la saisie, pour la corriger sans tout reprendre.
      if (accepted) {
        setDraft("");
      }
    });
  };

  return (
    <Card title="Poser une valeur">
      <form className="sb-members__add sb-params__form" onSubmit={submit} aria-label="Poser une valeur">
        <Field label="Paramètre">
          {({ id }) => (
            <select
              id={id}
              className="sb-mono"
              value={parameter.name}
              disabled={busy}
              onChange={(event) => {
                setName(event.target.value);
                setDraft("");
              }}
            >
              {configuration.parameters.map((found) => (
                <option key={found.name} value={found.name}>
                  {found.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Environnement">
          {({ id }) => (
            <select
              id={id}
              className="sb-mono"
              value={chosen}
              disabled={busy}
              onChange={(event) => {
                setEnvironment(event.target.value as Environment);
              }}
            >
              {settable.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Valeur" hint={constraintsLabel(constraints)}>
          {({ id, describedBy }) =>
            constraints.type === "boolean" || constraints.type === "choice" ? (
              <select
                ref={control}
                id={id}
                aria-describedby={describedBy}
                className="sb-mono"
                value={draft}
                disabled={busy}
                onChange={(event) => {
                  setDraft(event.target.value);
                }}
              >
                <option value="">Choisir…</option>
                <ValueOptions type={constraints.type} choices={constraints.type === "choice" ? constraints.choices : []} />
              </select>
            ) : (
              <input
                ref={control}
                id={id}
                aria-describedby={describedBy}
                className="sb-mono"
                value={draft}
                disabled={busy}
                inputMode={constraints.type === "integer" ? "numeric" : undefined}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => {
                  setDraft(event.target.value);
                }}
              />
            )
          }
        </Field>
        <button type="submit" className="sb-button sb-button--primary" disabled={busy || draft === ""}>
          Poser la valeur
        </button>
      </form>
    </Card>
  );
}

interface DeclarationDraft {
  name: string;
  type: ParameterType;
  maxLength: string;
  minimum: string;
  maximum: string;
  /** Valeurs possibles d'un choix, une par ligne. */
  choices: string;
  required: boolean;
  /** Vide : aucune valeur par défaut. */
  defaultValue: string;
  description: string;
}

const EMPTY_DECLARATION: DeclarationDraft = {
  name: "",
  type: "text",
  maxLength: "",
  minimum: "",
  maximum: "",
  choices: "",
  required: false,
  defaultValue: "",
  description: "",
};

function draftOf(parameter: Parameter): DeclarationDraft {
  const { constraints, required, description } = parameter.declaration;
  const value = parameter.declaration.default;
  return {
    ...EMPTY_DECLARATION,
    name: parameter.name,
    type: constraints.type,
    maxLength: constraints.type === "text" ? String(constraints.maxLength) : "",
    minimum: constraints.type === "integer" && constraints.minimum !== null ? String(constraints.minimum) : "",
    maximum: constraints.type === "integer" && constraints.maximum !== null ? String(constraints.maximum) : "",
    choices: constraints.type === "choice" ? constraints.choices.join("\n") : "",
    required,
    defaultValue: value === null ? "" : String(value),
    description,
  };
}

/** Lignes non vides, sans retouche : une valeur n'est jamais corrigée en silence. */
function choicesOf(raw: string): string[] {
  return raw.split("\n").filter((line) => line !== "");
}

function bound(raw: string): number | string | null {
  return raw === "" ? null : integerOrText(raw);
}

function inputOf(draft: DeclarationDraft): DeclarationInput {
  const constraints: Record<ParameterType, Record<string, unknown>> = {
    text: { max_length: integerOrText(draft.maxLength) },
    integer: { minimum: bound(draft.minimum), maximum: bound(draft.maximum) },
    boolean: {},
    choice: { choices: choicesOf(draft.choices) },
    identifier: {},
  };
  return {
    type: draft.type,
    constraints: constraints[draft.type],
    required: draft.required,
    default: draft.defaultValue === "" ? null : typedValue(draft.type, draft.defaultValue),
    description: draft.description,
  };
}

interface DeclarationFormProps {
  /** Paramètre en cours de modification, ou `null` pour en déclarer un nouveau. */
  editing: Parameter | null;
  busy: boolean;
  onCancel: () => void;
  /** Rend `true` si le serveur a accepté ; la saisie n'est vidée qu'alors. */
  onSubmit: (name: string, input: DeclarationInput) => Promise<boolean>;
}

/** Déclarer un paramètre, ou modifier sa déclaration ; le nom ne change pas (plan 10, P3). */
function DeclarationForm({ editing, busy, onCancel, onSubmit }: DeclarationFormProps) {
  const [draft, setDraft] = useState<DeclarationDraft>(EMPTY_DECLARATION);
  const first = useRef<HTMLSelectElement>(null);
  // Chaque modification ouverte depuis la grille recharge la déclaration du serveur.
  const [seen, setSeen] = useState<Parameter | null>(null);
  if (editing !== seen) {
    setSeen(editing);
    setDraft(editing === null ? EMPTY_DECLARATION : draftOf(editing));
  }
  useEffect(() => {
    if (editing !== null) {
      first.current?.focus();
    }
  }, [editing]);
  const change = (patch: Partial<DeclarationDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };
  const text = (key: "name" | "maxLength" | "minimum" | "maximum" | "defaultValue" | "description") => ({
    value: draft[key],
    disabled: busy,
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      change({ [key]: event.target.value });
    },
  });

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    void onSubmit(draft.name, inputOf(draft)).then((accepted) => {
      if (accepted && editing === null) {
        setDraft(EMPTY_DECLARATION);
      }
    });
  };

  const title = editing === null ? "Déclarer un paramètre" : `Modifier la déclaration de ${editing.name}`;
  return (
    <Card title={title}>
      <form className="sb-params__declaration" onSubmit={submit} aria-label={title}>
        {editing === null ? (
          <Field label="Nom" hint="Minuscules, chiffres et _, en commençant par une lettre ; il ne change plus ensuite.">
            {({ id, describedBy }) => <input id={id} aria-describedby={describedBy} className="sb-mono" spellCheck={false} autoComplete="off" {...text("name")} />}
          </Field>
        ) : null}
        <Field label="Type">
          {({ id }) => (
            <select
              ref={first}
              id={id}
              value={draft.type}
              disabled={busy}
              onChange={(event) => {
                change({ type: event.target.value as ParameterType, defaultValue: "" });
              }}
            >
              {PARAMETER_TYPES.map((type) => (
                <option key={type} value={type}>
                  {TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          )}
        </Field>
        {draft.type === "text" ? (
          <Field label="Longueur maximale" hint="De 1 à 1024 caractères.">
            {({ id, describedBy }) => <input id={id} aria-describedby={describedBy} className="sb-mono" inputMode="numeric" {...text("maxLength")} />}
          </Field>
        ) : null}
        {draft.type === "integer" ? (
          <>
            <Field label="Minimum (facultatif)">{({ id }) => <input id={id} className="sb-mono" inputMode="numeric" {...text("minimum")} />}</Field>
            <Field label="Maximum (facultatif)">{({ id }) => <input id={id} className="sb-mono" inputMode="numeric" {...text("maximum")} />}</Field>
          </>
        ) : null}
        {draft.type === "choice" ? (
          <Field label="Valeurs possibles" hint="Une par ligne, de 1 à 50.">
            {({ id, describedBy }) => (
              <textarea
                id={id}
                aria-describedby={describedBy}
                className="sb-mono"
                rows={4}
                value={draft.choices}
                disabled={busy}
                spellCheck={false}
                onChange={(event) => {
                  change({ choices: event.target.value });
                }}
              />
            )}
          </Field>
        ) : null}
        {draft.type === "identifier" ? <p className="sb-field__hint">Format fixe : une lettre ou _, puis lettres, chiffres ou _, 128 caractères au plus.</p> : null}
        <Field label="Valeur par défaut" hint="Vide : aucune valeur par défaut.">
          {({ id, describedBy }) =>
            draft.type === "boolean" || draft.type === "choice" ? (
              <select
                id={id}
                aria-describedby={describedBy}
                className="sb-mono"
                value={draft.defaultValue}
                disabled={busy}
                onChange={(event) => {
                  change({ defaultValue: event.target.value });
                }}
              >
                <option value="">Aucune</option>
                <ValueOptions type={draft.type} choices={choicesOf(draft.choices)} />
              </select>
            ) : (
              <input
                id={id}
                aria-describedby={describedBy}
                className="sb-mono"
                inputMode={draft.type === "integer" ? "numeric" : undefined}
                spellCheck={false}
                autoComplete="off"
                {...text("defaultValue")}
              />
            )
          }
        </Field>
        <label className="sb-field sb-params__check">
          <input
            type="checkbox"
            checked={draft.required}
            disabled={busy}
            onChange={(event) => {
              change({ required: event.target.checked });
            }}
          />
          Obligatoire : un environnement sans valeur ni défaut est incomplet
        </label>
        <Field label="Description (facultative)" hint="200 caractères au plus.">
          {({ id, describedBy }) => <input id={id} aria-describedby={describedBy} {...text("description")} />}
        </Field>
        <span className="sb-params__submit">
          {/* Un seul bouton principal par vue (RULES §2) : celui de « Poser une valeur ». */}
          <button type="submit" className="sb-button" disabled={busy || (editing === null && draft.name === "")}>
            {editing === null ? "Déclarer le paramètre" : "Enregistrer la déclaration"}
          </button>
          {editing === null ? null : (
            <button type="button" className="sb-button" disabled={busy} onClick={onCancel}>
              Annuler
            </button>
          )}
        </span>
      </form>
    </Card>
  );
}
