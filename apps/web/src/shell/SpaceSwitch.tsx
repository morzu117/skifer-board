import { useId } from "react";

import { deployCodes, roleLabel, type Space } from "../spaces/model";
import { Badge } from "../ui/Badge";
import "./shell.css";

interface SpaceSwitchProps {
  /** Espaces de la personne ; `loading` pendant leur lecture, `null` s'ils sont illisibles. */
  spaces: readonly Space[] | "loading" | null;
  /** Espace courant, tel que le serveur l'a confirmé ; `null` hors d'un espace. */
  current: Space | null;
  onChange: (id: string) => void;
}

/**
 * Sélecteur d'espace, toujours visible dans la coque (plan 08, 8.3). La pastille dit le rôle dans
 * l'espace courant, lu du serveur, et dessous les environnements où la personne peut déployer
 * (plan 09, 9.3) ; ni l'un ni l'autre ne donne de droit sur les données.
 */
export function SpaceSwitch({ spaces, current, onChange }: SpaceSwitchProps) {
  const id = useId();
  const listed = spaces === "loading" || spaces === null ? [] : spaces;
  const options = current === null || listed.some((space) => space.id === current.id) ? listed : [current, ...listed];
  const placeholder = spaces === "loading" ? "Lecture des espaces…" : spaces === null ? "Espaces indisponibles" : listed.length === 0 ? "Aucun espace" : "Choisir un espace";
  return (
    <div className="sb-space-switch">
      <label htmlFor={id} className="sb-space-switch__label">
        Espace
      </label>
      <select
        id={id}
        className="sb-space-switch__select"
        value={current?.id ?? ""}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {options.map((space) => (
          <option key={space.id} value={space.id}>
            {space.name}
          </option>
        ))}
      </select>
      {current === null ? null : (
        <>
          <Badge tone="neutral">Rôle : {roleLabel(current.role)}</Badge>
          <DeployLine space={current} />
        </>
      )}
    </div>
  );
}

/** « Déploiement : DEV, TEST », codes en mono (RULES §5), ou « Déploiement : aucun ». */
function DeployLine({ space }: { space: Space }) {
  const codes = deployCodes(space);
  return (
    <span className="sb-space-switch__deploy">
      Déploiement : {codes.length === 0 ? "aucun" : <span className="sb-mono">{codes.join(", ")}</span>}
    </span>
  );
}
