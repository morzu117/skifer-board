import { useId } from "react";
import { cssVariableName } from "../design/tokens";
import { contrastOf, type Base, type Role, type TokenCatalog } from "./catalog";
import { choicesFor } from "./edition";

interface Props {
  catalog: TokenCatalog;
  base: Base;
  role: Role | "palette";
  label: string;
  value: string;
  onChange: (token: string) => void;
}

/** Liste native : une valeur devenue inadmissible reste visible sans être proposée. */
export function TokenChoices({ catalog, base, role, label, value, onChange }: Props) {
  const id = useId();
  const choices = choicesFor(catalog, base, role);
  const available = choices.includes(value);
  const known = Object.hasOwn(catalog.luminance, value);
  const contrast = (token: string) => contrastOf(catalog, base, token).toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return <div className="sb-field sb-themes__token"><label htmlFor={id}>{label}</label><div className="sb-themes__token-control">
    {known ? <span aria-hidden="true" className="sb-themes__swatch" style={{ backgroundColor: `var(${cssVariableName(value.split("."))})` }} /> : null}
    <select id={id} value={available ? value : ""} onChange={(event) => { onChange(event.target.value); }}>
      {available ? null : <option value="" disabled>Choix inadmissible : {value}{known ? ` · ${contrast(value)}:1` : ""}</option>}
      {choices.map((token) => <option key={token} value={token}>{token} · {contrast(token)}:1</option>)}
    </select></div></div>;
}
