import { LockIcon } from "../ui/icons";
import "./shell.css";

export interface Identity {
  /** Nom affiché du lecteur dont les droits évaluent les données. */
  name: string;
  /** Entité du lecteur ; `null` tant que les espaces n'existent pas (plan 06, 6.3). */
  entity: string | null;
}

interface IdentityPillProps {
  identity: Identity | null;
}

/**
 * Pastille d'identité, présente sur toute vue qui affiche des données (RULES §1). Sans identité
 * établie, elle le dit sur fond neutre plutôt que d'afficher des droits fictifs (plan 02, W11) ;
 * elle n'invente pas non plus d'entité.
 */
export function IdentityPill({ identity }: IdentityPillProps) {
  if (identity === null) {
    return (
      <span className="sb-identity sb-identity--unknown">
        Identité non établie · données de démonstration
      </span>
    );
  }
  return (
    <span className="sb-identity">
      <LockIcon />
      Données évaluées pour {identity.name}
      {identity.entity === null ? null : ` · Entité ${identity.entity}`}
    </span>
  );
}
