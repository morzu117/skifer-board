import { BrandMark } from "../ui/icons";
import { SECTIONS, type SectionId } from "./sections";
import "./shell.css";

interface SidebarProps {
  /** Entrées livrées, cliquables ; les autres sont affichées comme à venir, sans lien mort. */
  available: ReadonlySet<SectionId>;
  active?: SectionId | undefined;
  onNavigate: (section: SectionId) => void;
  /** Espace Atlas rattaché, ou `null` s'il n'y en a pas. */
  workspace: string | null;
}

export function Sidebar({ available, active, onNavigate, workspace }: SidebarProps) {
  return (
    <nav className="sb-sidebar" aria-label="Navigation principale">
      <div className="sb-sidebar__brand">
        <BrandMark />
        <span>Skifer Board</span>
      </div>
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
                <span className="sb-sidebar__pending">à venir</span>
              </span>
            )}
          </li>
        ))}
      </ul>
      <div className="sb-sidebar__foot">
        <span className="sb-sidebar__foot-label">Espace rattaché à Atlas</span>
        <span>{workspace ?? "Aucun espace rattaché"}</span>
      </div>
    </nav>
  );
}
