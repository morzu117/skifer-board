/**
 * Perte de session signalée par une lecture de données (réponse 401). La coque l'écoute et
 * remplace l'écran par la connexion : aucune donnée n'est laissée affichée sans session.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

export function onSessionLost(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function reportSessionLost(): void {
  for (const listener of [...listeners]) {
    listener();
  }
}
