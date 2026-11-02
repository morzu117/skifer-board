import { EnvironmentSwitch } from "./EnvironmentSwitch";
import { IdentityPill, type Identity } from "./IdentityPill";
import type { Environment } from "./sections";
import "./shell.css";

interface TopBarProps {
  /** Fil d'Ariane, du plus général au plus précis ; le dernier élément est la page courante. */
  breadcrumb: readonly string[];
  environment: Environment;
  onEnvironmentChange: (environment: Environment) => void;
  /** Environnements où la personne peut déployer dans l'espace courant ; `null` hors d'un espace. */
  deploy?: ReadonlySet<Environment> | null | undefined;
  identity: Identity | null;
  /** Présent quand une session est ouverte : bouton « Se déconnecter ». */
  onLogout?: (() => void) | undefined;
}

export function TopBar({ breadcrumb, environment, onEnvironmentChange, deploy, identity, onLogout }: TopBarProps) {
  return (
    <header className="sb-topbar">
      <nav aria-label="Fil d'Ariane" className="sb-topbar__crumbs">
        <ol>
          {breadcrumb.map((crumb, index) => (
            <li key={crumb} aria-current={index === breadcrumb.length - 1 ? "page" : undefined}>
              {crumb}
            </li>
          ))}
        </ol>
      </nav>
      <EnvironmentSwitch value={environment} onChange={onEnvironmentChange} deploy={deploy} />
      <IdentityPill identity={identity} />
      {onLogout === undefined ? null : (
        <button type="button" className="sb-button" onClick={onLogout}>
          Se déconnecter
        </button>
      )}
    </header>
  );
}
