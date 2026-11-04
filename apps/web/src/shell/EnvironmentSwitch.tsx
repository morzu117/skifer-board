import { useId } from "react";

import { ENVIRONMENTS, type Environment } from "./sections";
import "./shell.css";

interface EnvironmentSwitchProps {
  value: Environment;
  onChange: (environment: Environment) => void;
  /**
   * Dans un espace, les environnements où la personne peut déployer, tels que le serveur les a
   * rendus (plan 09, V7) ; `null` hors d'un espace, sans marque.
   */
  deploy?: ReadonlySet<Environment> | null | undefined;
}

/**
 * Bascule d'environnement, toujours dans l'ordre DEV | TEST | PROD. Elle choisit l'environnement
 * affiché ; la marque dit seulement où la personne peut déployer. Chaque segment garde son nom
 * (« DEV »), le droit est sa description, et la marque, hors du flux, laisse à la bascule sa
 * largeur et sa position d'un espace à l'autre (DESIGN-SYSTEM §1.5).
 */
export function EnvironmentSwitch({ value, onChange, deploy = null }: EnvironmentSwitchProps) {
  const described = useId();
  return (
    <div className="sb-env" role="group" aria-label="Environnement">
      <span id={described} hidden>
        Déploiement autorisé
      </span>
      {ENVIRONMENTS.map((environment) => {
        const allowed = deploy?.has(environment) === true;
        return (
          <button
            key={environment}
            type="button"
            className="sb-env__segment"
            aria-pressed={environment === value}
            aria-describedby={allowed ? described : undefined}
            onClick={() => {
              onChange(environment);
            }}
          >
            {environment}
            <span className="sb-env__deploy" aria-hidden="true">
              {allowed ? "●" : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}
