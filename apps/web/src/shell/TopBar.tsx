import { EnvironmentSwitch } from "./EnvironmentSwitch";
import { IdentityPill, type Identity } from "./IdentityPill";
import type { Environment } from "./sections";
import "./shell.css";

interface TopBarProps {
  /** Fil d'Ariane, du plus général au plus précis ; le dernier élément est la page courante. */
  breadcrumb: readonly string[];
  environment: Environment;
  onEnvironmentChange: (environment: Environment) => void;
  identity: Identity | null;
}

export function TopBar({ breadcrumb, environment, onEnvironmentChange, identity }: TopBarProps) {
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
      <EnvironmentSwitch value={environment} onChange={onEnvironmentChange} />
      <IdentityPill identity={identity} />
    </header>
  );
}
