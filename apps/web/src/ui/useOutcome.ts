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
