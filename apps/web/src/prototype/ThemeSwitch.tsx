import { THEMES, type ChartTheme } from "../charts/theme";
import "../shell/shell.css";

interface ThemeSwitchProps {
  value: ChartTheme;
  onChange: (theme: ChartTheme) => void;
}

/** Bascule de thème : change l'apparence des tuiles, jamais leurs valeurs (plan 02, W8). */
export function ThemeSwitch({ value, onChange }: ThemeSwitchProps) {
  return (
    <div className="sb-env" role="group" aria-label="Thème">
      {THEMES.map((theme) => (
        <button
          key={theme.id}
          type="button"
          className="sb-env__segment sb-env__segment--text"
          aria-pressed={theme.id === value.id}
          onClick={() => {
            onChange(theme);
          }}
        >
          {theme.label}
        </button>
      ))}
    </div>
  );
}
