import { useEffect, useRef, useState, type SyntheticEvent } from "react";

import { formatInstant } from "../format/date";
import { routeHash } from "../shell/route";
import { ENVIRONMENTS, type Environment } from "../shell/sections";
import { Badge } from "../ui/Badge";
import { Banner } from "../ui/Banner";
import { Card } from "../ui/Card";
import { useRefreshed } from "../ui/useOutcome";
import { AdminTabs, Confirm, FeedbackRegion, Journal, PrincipalCell, ReadFailure, Reading, refusalText, samePrincipal, useAdminWrite } from "./AdminParts";
import { fetchEvents, fetchGrants, fetchParameters, grantDeploy, revokeDeploy, type AdminOutcome } from "./admin";
import type { Fetch } from "./api";
import { EMPTY_DRAFT, PrincipalField, principalOf, type PrincipalDraft } from "./PrincipalField";
import { personLabel, principalLabel, type DeployGrant, type Principal, type Space } from "./model";
import { missingLabel, type Configuration, type EnvironmentConfiguration } from "./parameters";
import "../catalogue/catalogue.css";
import "./spaces.css";

/** Rappel permanent de l'écran (plan 09, V3). */
export const DEPLOY_REMINDER = "Un droit de déployer n'a d'effet qu'avec le rôle Créateur ou Administrateur dans l'espace, et ne donne aucun droit sur les données.";

interface EnvironmentsPageProps {
  space: Space;
  fetcher: Fetch;
  /** Environnement choisi dans la coque : la cible du pipeline. */
  target: Environment;
  /** Après chaque écriture : la coque relit l'espace, dont les droits ont pu changer. */
  onWritten?: () => void;
}

/**
 * « Environnements » d'un espace (écrans §9, plan 09, 9.4) : les trois environnements dans leur ordre
 * de promotion, et qui peut déployer dans chacun. Le serveur décide de tout : la page envoie la
 * demande et rend sa réponse, refus compris, avec sa raison.
 */
export function EnvironmentsPage({ space, fetcher, target, onWritten }: EnvironmentsPageProps) {
  const [pending, setPending] = useState<DeployGrant | null>(null);
  const { version, busy, feedback, setFeedback, announced, write } = useAdminWrite(onWritten, () => {
    setPending(null);
  });
  const grants = useRefreshed(`grants:${space.id}`, version, (signal) => fetchGrants(space.id, signal, fetcher));
  const events = useRefreshed(`events:${space.id}`, version, (signal) => fetchEvents(space.id, signal, fetcher));
  const parameters = useRefreshed(`parameters:${space.id}`, version, (signal) => fetchParameters(space.id, signal, fetcher));

  return (
    <>
      <div className="sb-page-head">
        <div>
          <h1 className="sb-page-head__title">Environnements</h1>
          <p className="sb-page-head__lead">
            {space.name} · <span className="sb-mono">{space.id}</span>
          </p>
        </div>
      </div>
      <AdminTabs space={space} current="environments" />
      <Banner tone="neutral">
        <strong>{DEPLOY_REMINDER}</strong> Il dit qui pourra déployer, et où ; les déploiements arriveront avec les releases.
      </Banner>
      <FeedbackRegion feedback={feedback} announced={announced} />
      {/* Sans pipeline, sa complétude n'a pas lieu d'être dite : le refus des droits suffit, une seule fois. */}
      {grants.status !== "ok" || parameters.status === "ok" || parameters.status === "loading" ? null : (
        <CompletenessFailure outcome={parameters} />
      )}
      <Pipeline
        space={space}
        grants={grants}
        parameters={parameters}
        target={target}
        pending={pending}
        busy={busy}
        onPending={(next) => {
          setFeedback(null);
          setPending(next);
        }}
        onRevoke={(grant) => {
          void write(() => revokeDeploy(space.id, grant.id, fetcher), `Droit de déployer en ${grant.environment} retiré : ${principalLabel(grant)}.`);
        }}
      />
      {grants.status === "ok" ? (
        <AddGrant
          grants={grants.value}
          target={target}
          busy={busy}
          fetcher={fetcher}
          onAdd={(environment, principal, label) =>
            write(() => grantDeploy(space.id, environment, principal, fetcher), `${label} : droit de déployer en ${environment} accordé.`)
          }
        />
      ) : null}
      <Card title="Journal de l'espace">
        <Journal events={events} />
      </Card>
    </>
  );
}

interface PipelineProps {
  space: Space;
  grants: { status: "loading" } | AdminOutcome<readonly DeployGrant[]>;
  /** Complétude de chaque environnement (plan 10, 10.4), calculée par le serveur. */
  parameters: { status: "loading" } | AdminOutcome<Configuration>;
  target: Environment;
  pending: DeployGrant | null;
  busy: boolean;
  onPending: (grant: DeployGrant | null) => void;
  onRevoke: (grant: DeployGrant) => void;
}

/** Pipeline d'environnements (DESIGN-SYSTEM §5) : trois étapes reliées, la cible mise en avant. */
function Pipeline({ space, grants, parameters, target, pending, busy, onPending, onRevoke }: PipelineProps) {
  if (grants.status === "loading") {
    return (
      <Card title="Droits de déployer">
        <Reading>Lecture des droits de déployer…</Reading>
      </Card>
    );
  }
  if (grants.status !== "ok") {
    return (
      <Card title="Droits de déployer">
        <ReadFailure outcome={grants} title="Droits de déployer indisponibles" />
      </Card>
    );
  }
  return (
    <ol className="sb-pipeline" aria-label="Droits de déployer, dans l'ordre de promotion">
      {ENVIRONMENTS.map((environment) => {
        const here = grants.value.filter((grant) => grant.environment === environment);
        const isTarget = environment === target;
        return (
          <li key={environment} className={isTarget ? "sb-pipeline__stage sb-pipeline__stage--target" : "sb-pipeline__stage"} aria-current={isTarget ? "step" : undefined}>
            <h2 className="sb-pipeline__name">
              <span className="sb-mono">{environment}</span>
              {isTarget ? <span className="sb-pipeline__note">environnement affiché</span> : null}
            </h2>
            <p className="sb-pipeline__parameters">
              <Completeness parameters={parameters} environment={environment} />{" "}
              <a className="sb-pipeline__link" href={routeHash({ page: "parameters", space: space.id })} aria-label={`Paramètres de ${environment}`}>
                Paramètres
              </a>
            </p>
            {here.length === 0 ? (
              <p className="sb-members__state">Personne ne peut y déployer.</p>
            ) : (
              <ul className="sb-grants" aria-label={`Droits de déployer en ${environment}`}>
                {here.map((grant) => (
                  <GrantItem
                    key={grant.id}
                    grant={grant}
                    pending={pending?.id === grant.id}
                    busy={busy}
                    onPending={onPending}
                    onRevoke={onRevoke}
                  />
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Au-dessus d'un pipeline lu et gérable, un refus dit aussi ce qui manque : la complétude, pas les droits. */
function CompletenessFailure({ outcome }: { outcome: Exclude<PipelineProps["parameters"], { status: "loading" } | { status: "ok" }> }) {
  if (outcome.status === "refused") {
    return <Banner tone="danger">Complétude des paramètres indisponible : {refusalText(outcome)}</Banner>;
  }
  return <ReadFailure outcome={outcome} title="Complétude des paramètres indisponible" />;
}

/** Complétude d'un environnement ; une lecture refusée ou en échec est dite une fois, au-dessus du pipeline. */
function Completeness({ parameters, environment }: { parameters: PipelineProps["parameters"]; environment: Environment }) {
  if (parameters.status === "loading") {
    return (
      <span role="status" aria-busy="true" className="sb-members__state">
        Lecture des paramètres…
      </span>
    );
  }
  if (parameters.status !== "ok") {
    return <span className="sb-members__state">Complétude indisponible.</span>;
  }
  // Le décodage garantit les trois environnements dans l'ordre de promotion (plan 10, 10.3).
  const configuration = parameters.value.environments[ENVIRONMENTS.indexOf(environment)] as EnvironmentConfiguration;
  if (configuration.values.length === 0) {
    return <span className="sb-members__state">Aucun paramètre déclaré.</span>;
  }
  return configuration.complete ? (
    <Badge tone="success">paramètres complets</Badge>
  ) : (
    <Badge tone="danger">incomplet · {missingLabel(configuration.missing.length)}</Badge>
  );
}

interface GrantItemProps {
  grant: DeployGrant;
  pending: boolean;
  busy: boolean;
  onPending: (grant: DeployGrant | null) => void;
  onRevoke: (grant: DeployGrant) => void;
}

function GrantItem({ grant, pending, busy, onPending, onRevoke }: GrantItemProps) {
  const label = principalLabel(grant);
  // Une confirmation annulée rend le focus au bouton « Retirer » de l'accord.
  const retire = useRef<HTMLButtonElement>(null);
  const restore = useRef(false);
  useEffect(() => {
    if (!pending && restore.current) {
      restore.current = false;
      retire.current?.focus();
    }
  }, [pending]);
  return (
    <li className={pending ? "sb-grant sb-grant--pending" : "sb-grant"}>
      <div className="sb-members__principal">
        <PrincipalCell principal={grant.principal} person={grant.person} label={label} />
      </div>
      <p className="sb-grant__meta">
        Accordé par {personLabel(grant.createdBy, grant.createdByPerson)} · <span className="sb-mono">{formatInstant(grant.createdAt)}</span>
      </p>
      {pending ? (
        <Confirm
          // Espace insécable avant « ? » : le point d'interrogation ne passe pas seul à la ligne.
          question={`Retirer le droit de déployer en ${grant.environment} : ${label}\u00a0?`}
          action="Retirer"
          busy={busy}
          onConfirm={() => {
            onRevoke(grant);
          }}
          onCancel={() => {
            restore.current = true;
            onPending(null);
          }}
        />
      ) : (
        <button
          ref={retire}
          type="button"
          className="sb-button"
          disabled={busy}
          aria-label={`Retirer le droit de déployer en ${grant.environment} : ${label}`}
          onClick={() => {
            onPending(grant);
          }}
        >
          Retirer
        </button>
      )}
    </li>
  );
}

interface AddGrantProps {
  grants: readonly DeployGrant[];
  target: Environment;
  busy: boolean;
  fetcher: Fetch;
  /** Rend `true` si le serveur a accepté ; la saisie n'est vidée qu'alors. */
  onAdd: (environment: Environment, principal: Principal, label: string) => Promise<boolean>;
}

/** Accord d'un droit de déployer à un groupe, par son nom exact, ou à une personne connue. */
function AddGrant({ grants, target, busy, fetcher, onAdd }: AddGrantProps) {
  const [draft, setDraft] = useState<PrincipalDraft>(EMPTY_DRAFT);
  // L'environnement proposé suit la cible de la coque : chaque changement de cible oublie le choix fait ici.
  const [environment, setEnvironment] = useState<Environment>(target);
  const [seen, setSeen] = useState(target);
  if (seen !== target) {
    setSeen(target);
    setEnvironment(target);
  }
  const principal = principalOf(draft);
  const existing = principal === null ? undefined : grants.find((grant) => grant.environment === environment && samePrincipal(grant.principal, principal));
  const label = draft.kind === "group" ? `Groupe ${draft.name}` : draft.person === null ? "" : personLabel(draft.person, draft.person);

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (principal === null) {
      return;
    }
    void onAdd(environment, principal, label).then((accepted) => {
      // Un refus garde la saisie, pour la corriger sans tout reprendre.
      if (accepted) {
        setDraft(EMPTY_DRAFT);
      }
    });
  };

  return (
    <Card title="Accorder un droit de déployer">
      <form className="sb-members__add" onSubmit={submit} aria-label="Accorder un droit de déployer">
        <PrincipalField legend="Groupe ou personne" draft={draft} onChange={setDraft} fetcher={fetcher} disabled={busy} />
        <label className="sb-field sb-members__add-role">
          Environnement
          <select
            className="sb-mono"
            value={environment}
            disabled={busy}
            onChange={(event) => {
              setEnvironment(event.target.value as Environment);
            }}
          >
            {ENVIRONMENTS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        {existing === undefined ? null : (
          <p className="sb-members__state" role="status">
            {label} peut déjà déployer en {environment} : rien ne changera.
          </p>
        )}
        <button type="submit" className="sb-button sb-button--primary" disabled={busy || principal === null || existing !== undefined}>
          Accorder le droit
        </button>
      </form>
    </Card>
  );
}
