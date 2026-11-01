import type { ContextualRequest, Selection } from "../charts/selection";
import "./prototype.css";

interface SelectionBarProps {
  selection: Selection;
  /** Nom pluriel des valeurs sélectionnées : « régions ». */
  noun: string;
  /** Demande que Board adresse à sa couche de calcul contextuel pour le total. */
  request: ContextualRequest;
  onClear: () => void;
}

/**
 * Barre de sélection. Le total n'est pas calculé dans ce prototype : l'écran le dit, avec la
 * cause, plutôt que d'inventer un chiffre (RULES §5.5, plan 02, W9).
 */
export function SelectionBar({ selection, noun, request, onClear }: SelectionBarProps) {
  const count = selection.keys.length;
  return (
    <section className="sb-selection-bar" aria-label="Sélection">
      <span className="sb-selection-bar__count">
        <span className="sb-mono">{count}</span> {noun} sélectionnée{count > 1 ? "s" : ""}
      </span>
      <span>
        Total de la sélection : <strong>non disponible</strong> · le calcul contextuel est branché au lot 05
      </span>
      <details className="sb-selection-bar__request">
        <summary>Demande transmise au calcul contextuel</summary>
        <pre className="sb-mono">{JSON.stringify(request, null, 2)}</pre>
      </details>
      <button type="button" className="sb-button" onClick={onClear}>
        Tout désélectionner
      </button>
    </section>
  );
}
