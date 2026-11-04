/**
 * Espace perdu pendant l'usage : une lecture de l'espace courant a répondu `space_not_found`
 * (liaison retirée, plan 08, E4). La coque relit alors l'espace, qui s'affiche « Espace
 * introuvable » : rien de l'espace n'est laissé affiché comme si l'accès durait.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

export function onSpaceLost(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function reportSpaceLost(): void {
  for (const listener of [...listeners]) {
    listener();
  }
}
