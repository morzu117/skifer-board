import { useEffect, useRef, useState } from "react";

/** Lit une réponse à chaque changement de `key` et ignore celle d'une demande abandonnée. */
export function useOutcome<T>(key: string, load: (signal: AbortSignal) => Promise<T>): T | { status: "loading" } {
  const [answer, setAnswer] = useState<{ key: string; outcome: T } | null>(null);
  // `load` est recréée à chaque rendu ; `key` dit tout ce dont elle dépend.
  const loader = useRef(load);
  useEffect(() => {
    loader.current = load;
  });
  useEffect(() => {
    const controller = new AbortController();
    loader.current(controller.signal).then(
      (outcome) => {
        if (!controller.signal.aborted) {
          setAnswer({ key, outcome });
        }
      },
      () => undefined, // Lecture abandonnée : une demande plus récente la remplace.
    );
    return () => {
      controller.abort();
    };
  }, [key]);
  return answer?.key === key ? answer.outcome : { status: "loading" };
}

/**
 * Comme `useOutcome`, mais une relecture du même objet (`revision` change, `base` non) garde la
 * réponse précédente affichée jusqu'à la nouvelle : la page ne se démonte pas, saisie et focus
 * restent. Un autre objet (`base` change) repart de la lecture.
 */
export function useRefreshed<T>(base: string, revision: number, load: (signal: AbortSignal) => Promise<T>): T | { status: "loading" } {
  const fresh = useOutcome(`${base}:${String(revision)}`, load);
  const [kept, setKept] = useState<{ base: string; outcome: T } | null>(null);
  const loading = isLoading(fresh);
  if (!loading && (kept?.base !== base || kept.outcome !== fresh)) {
    setKept({ base, outcome: fresh });
  }
  return loading && kept?.base === base ? kept.outcome : fresh;
}

function isLoading(value: unknown): value is { status: "loading" } {
  return typeof value === "object" && value !== null && "status" in value && value.status === "loading";
}
