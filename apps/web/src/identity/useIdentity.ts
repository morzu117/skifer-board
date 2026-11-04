import { useCallback, useEffect, useState } from "react";

import { fetchMe, type Fetch, type IdentityOutcome } from "./api";
import { onSessionLost } from "./session";

export type IdentityState = { status: "loading" } | IdentityOutcome | { status: "lost" };

/**
 * Identité de la page : lue une fois au chargement, relue à la demande. Une session perdue
 * pendant l'usage (401 d'une lecture de données) l'emporte sur l'identité déjà lue.
 */
export function useIdentity(fetcher: Fetch = fetch): { state: IdentityState; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<{ attempt: number; outcome: IdentityOutcome } | null>(null);
  const [lost, setLost] = useState(false);

  useEffect(
    () =>
      onSessionLost(() => {
        setLost(true);
      }),
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchMe(controller.signal, fetcher).then(
      (outcome) => {
        // Une réponse arrivée après l'abandon de sa requête ne remplace jamais une issue plus récente.
        if (!controller.signal.aborted) {
          setAnswer({ attempt, outcome });
        }
      },
      () => undefined,
    );
    return () => {
      controller.abort();
    };
  }, [attempt, fetcher]);

  const retry = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  if (lost) {
    return { state: { status: "lost" }, retry };
  }
  return { state: answer?.attempt === attempt ? answer.outcome : { status: "loading" }, retry };
}
