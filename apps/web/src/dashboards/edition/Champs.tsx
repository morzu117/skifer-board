import { createContext, useContext, useEffect, useId, useState, type KeyboardEvent, type ReactNode } from "react";

/**
 * Où les champs disent qu'une saisie n'est pas encore validée vers le document (l'éditeur la fournit). Une saisie en cours est un
 * changement non enregistré : elle compte pour la garde de sortie, que le document, lui, ne connaît pas encore.
 */
export const PendingInputs = createContext<((key: string, pending: boolean) => void) | null>(null);

/**
 * Champ de texte qui valide à la sortie du champ ou sur Entrée, non à chaque frappe : une commande par modification, donc une
 * étape d'annulation par modification. Le texte saisi suit la valeur du document (annulation, rétablissement).
 */
export function CommitField({ label, value, onCommit, multiline = false, maxLength, hint, disabled = false, type = "text" }: {
  label: string;
  value: string;
  onCommit: (text: string) => void;
  multiline?: boolean;
  maxLength?: number;
  hint?: string;
  disabled?: boolean;
  type?: "text" | "number";
}) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  const hintId = useId();
  const report = useContext(PendingInputs);
  const pending = draft !== value;
  useEffect(() => {
    report?.(hintId, pending);
    return () => { report?.(hintId, false); };
  }, [report, hintId, pending]);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }
  const commit = (): void => {
    if (draft !== value) onCommit(draft);
  };
  const keys = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") commit();
  };
  return <label className="sb-field">{label}
    {multiline
      ? <textarea value={draft} rows={3} {...(maxLength === undefined ? {} : { maxLength })} disabled={disabled} aria-describedby={hint === undefined ? undefined : hintId} onChange={(event) => { setDraft(event.target.value); }} onBlur={commit} />
      : <input type={type} value={draft} {...(maxLength === undefined ? {} : { maxLength })} disabled={disabled} aria-describedby={hint === undefined ? undefined : hintId} onChange={(event) => { setDraft(event.target.value); }} onBlur={commit} onKeyDown={keys} />}
    {hint === undefined ? null : <small id={hintId} className="sb-field__hint">{hint}</small>}
  </label>;
}

/** Liste déroulante à valeurs fermées. */
export function Choice<T extends string>({ label, value, options, onChange, disabled = false, note }: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  note?: ReactNode;
}) {
  return <label className="sb-field">{label}
    <select value={value} disabled={disabled} onChange={(event) => { onChange(event.target.value as T); }}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
    {note === undefined ? null : <small className="sb-field__hint">{note}</small>}
  </label>;
}
