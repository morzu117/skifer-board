import type { ReactNode } from "react";

import "./ui.css";

interface CardProps {
  title: string;
  /** Contrôles placés à droite du titre. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Carte : fond blanc, bordure, rayon 8, sans ombre ; une région nommée par son titre. */
export function Card({ title, actions, children, className }: CardProps) {
  return (
    <section className={className === undefined ? "sb-card" : `sb-card ${className}`} aria-label={title}>
      <div className="sb-card__head">
        <h2 className="sb-card__title">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}
