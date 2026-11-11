import { useEffect, useRef, useState } from "react";

import { guardNavigation } from "./route";

/**
 * Garde de sortie d'une page qui porte des changements non enregistrés (plan 19, 19.5a). Elle retient les sorties que
 * l'application commande : les liens d'ancre (`#/…`) et `navigate` (barre latérale, sélecteur d'espace). Elle rattrape aussi
 * un changement d'adresse qu'elle n'a pas commandé, le bouton Précédent du navigateur ou une adresse saisie à la main : au
 * `hashchange`, l'adresse de la page est rétablie sur place (`replaceState`, sans rechargement ni perte d'état) et l'adresse
 * demandée attend la réponse de la personne (`pending`). `stay` la laisse où elle est, `leave` va à l'adresse retenue.
 * Après un refus de Précédent, l'entrée visitée garde l'adresse de la page (l'entrée précédente est donc remplacée dans
 * l'historique) ; une adresse saisie à la main est quittée par un pas en arrière. `beforeunload` attrape le rechargement ou la fermeture de l'onglet.
 */
export function useExitGuard(dirty: boolean): { pending: string | null; stay: () => void; leave: () => void } {
  const [pending, setPending] = useState<string | null>(null);
  const unsaved = useRef(dirty);
  const home = useRef(window.location.hash);
  /** L'adresse que la personne vient de choisir de rejoindre : ses événements d'adresse passent sans question. */
  const allowed = useRef<string | null>(null);
  useEffect(() => {
    unsaved.current = dirty;
  });
  useEffect(() => {
    const release = guardNavigation((hash) => {
      if (!unsaved.current) return true;
      setPending(hash);
      return false;
    });
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.defaultPrevented) return;
      const link = (event.target as Element).closest("a[href^='#/']");
      if (link === null || !unsaved.current) return;
      event.preventDefault();
      setPending(link.getAttribute("href"));
    };
    /** Retient l'adresse demandée si la page a des changements : l'adresse de la page est rétablie sur place (sans rechargement). */
    const refuse = (pushed: boolean) => {
      const asked = window.location.hash;
      if (asked === allowed.current || !unsaved.current || asked === home.current) return;
      // Une URL vide se résoudrait à l'adresse courante : on réécrit donc le chemin et la requête avec l'ancre de la page.
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}${home.current}`);
      // Une adresse saisie à la main a ajouté une entrée : on la quitte, pour que Précédent ne tombe pas sur un doublon.
      if (pushed) window.history.go(-1);
      setPending(asked);
    };
    const onPop = () => { refuse(false); };
    const onHashChange = () => { refuse(true); };
    const onUnload = (event: BeforeUnloadEvent) => {
      if (unsaved.current) event.preventDefault();
    };
    document.addEventListener("click", onClick, true);
    // Précédent change l'adresse dès `popstate`, avant `hashchange`, et un rendu de React entre les deux démonterait la page :
    // on écoute les deux, en capture, et `hashchange` ne trouve plus rien à faire (l'adresse est déjà rétablie). Sans `popstate`,
    // c'est une adresse saisie à la main.
    window.addEventListener("popstate", onPop, true);
    window.addEventListener("hashchange", onHashChange, true);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      release();
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPop, true);
      window.removeEventListener("hashchange", onHashChange, true);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, []);
  return {
    pending,
    stay: () => { setPending(null); },
    leave: () => {
      unsaved.current = false;
      allowed.current = pending;
      setPending(null);
      window.location.hash = pending as string;
    },
  };
}
