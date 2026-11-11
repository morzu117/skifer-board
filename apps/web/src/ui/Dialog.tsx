import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";

import "./ui.css";

interface DialogProps {
  title: string;
  /** Échap, ou le bouton que le contenu offre : la personne ferme, rien n'est décidé à sa place. */
  onClose: () => void;
  children: ReactNode;
}

const FOCUSABLE = "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])";

/**
 * Dialogue modal : le focus y entre (sur l'élément marqué `data-autofocus`, sinon sur le premier contrôle), n'en sort pas au clavier
 * (Tab boucle), revient à l'élément qui l'a ouvert à la fermeture, et Échap le ferme. Le reste de la page n'est pas atteignable
 * tant qu'il est ouvert : le voile le couvre et `aria-modal` le dit aux lecteurs d'écran.
 */
export function Dialog({ title, onClose, children }: DialogProps) {
  const heading = useId();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement;
    const inside = box.current as HTMLDivElement;
    (inside.querySelector<HTMLElement>("[data-autofocus]") ?? inside.querySelector<HTMLElement>(FOCUSABLE) ?? inside).focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = [...(box.current as HTMLDivElement).querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = controls[0];
    const last = controls.at(-1);
    if (first === undefined || last === undefined) {
      event.preventDefault();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  return <div className="sb-dialog" onKeyDown={keys}>
    <div ref={box} className="sb-dialog__box" role="dialog" aria-modal="true" aria-labelledby={heading} tabIndex={-1}>
      <h2 id={heading} className="sb-dialog__title">{title}</h2>
      {children}
    </div>
  </div>;
}
