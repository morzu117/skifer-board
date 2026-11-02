import type { ReactNode } from "react";

import { BrandMark } from "../ui/icons";
import { SECTIONS, type SectionId } from "./sections";
import "./shell.css";

interface SidebarProps {
  /** Entrées livrées, cliquables ; les autres sont affichées comme à venir, sans lien mort. */
  available: ReadonlySet<SectionId>;
  active?: SectionId | undefined;
  onNavigate: (section: SectionId) => void;
  /** Rattachement Atlas de l'espace courant, ou `null` hors d'un espace. */
  workspace: string | null;
  /** Sélecteur d'espace, sous la marque. */
  spaceSwitch?: ReactNode;
  /** Mention d'une entrée indisponible ; « à venir » par défaut. */
  pending?: Partial<Record<SectionId, string>> | undefined;
}

export function Sidebar({ available, active, onNavigate, workspace, spaceSwitch, pending }: SidebarProps) {
  return (
    <nav className="sb-sidebar" aria-label="Navigation principale">
      <a className="sb-sidebar__brand" href="#/">
        <BrandMark />
        <span>Skifer Board</span>
      </a>
      {spaceSwitch}
      <ul className="sb-sidebar__list">
        {SECTIONS.map((section) => (
          <li key={section.id}>
            {available.has(section.id) ? (
              <button
                type="button"
                className="sb-sidebar__item"
                aria-current={section.id === active ? "page" : undefined}
                onClick={() => {
                  onNavigate(section.id);
                }}
              >
                {section.label}
              </button>
            ) : (
              <span className="sb-sidebar__item sb-sidebar__item--pending">
                {section.label}
                <span className="sb-sidebar__pending">{pending?.[section.id] ?? "à venir"}</span>
              </span>
            )}
          </li>
        ))}
      </ul>
      <div className="sb-sidebar__foot">
        <span className="sb-sidebar__foot-label">Espace rattaché à Atlas</span>
        <span>{workspace ?? "Aucun espace choisi"}</span>
      </div>
    </nav>
  );
}
