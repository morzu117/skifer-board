import { ENVIRONMENTS, type Environment } from "./sections";
import "./shell.css";

interface EnvironmentSwitchProps {
  value: Environment;
  onChange: (environment: Environment) => void;
}

/** Bascule d'environnement, toujours dans l'ordre DEV | TEST | PROD. */
export function EnvironmentSwitch({ value, onChange }: EnvironmentSwitchProps) {
  return (
    <div className="sb-env" role="group" aria-label="Environnement">
      {ENVIRONMENTS.map((environment) => (
        <button
          key={environment}
          type="button"
          className="sb-env__segment"
          aria-pressed={environment === value}
          onClick={() => {
            onChange(environment);
          }}
        >
          {environment}
        </button>
      ))}
    </div>
  );
}
