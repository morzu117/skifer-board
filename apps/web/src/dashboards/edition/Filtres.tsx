import { useContext, useEffect, useId, useState } from "react";

import type { Scalar } from "../../analyses/document";
import type { LogicalType } from "../../explorer/model";
import { OPERATORS } from "../../explorer/filters";
import { Banner } from "../../ui/Banner";
import { COMMON_OPERATORS, filterValues, type CommonFilter, type CommonOperator } from "../document";
import { useEditor } from "./EditorContext";
import { PendingInputs } from "./Champs";
import { incompatibleTargets } from "./problems";
import { findNode } from "./tree";

/** Convertit la saisie selon le type déclaré ; les listes prennent une valeur par ligne. */
function parse(text: string, type: LogicalType): Scalar {
  if (type === "number") return text.trim() === "" ? Number.NaN : Number(text);
  if (type === "boolean") {
    if (text === "true") return true;
    if (text === "false") return false;
  }
  return text;
}
const lines = (text: string, type: LogicalType): Scalar[] => text.split("\n").map((line) => line.trim()).filter((line) => line !== "").map((line) => parse(line, type));
const show = (value: CommonFilter["default"]): string => value === undefined ? "" : (Array.isArray(value) ? value.map(String).join("\n") : String(value));

/** Formulaire commun à la création et aux propriétés d'un filtre. */
export function FiltreForm({ filter, onDone }: { filter?: CommonFilter; onDone?: () => void }) {
  const editor = useEditor();
  const catalog = editor.catalog ?? [];
  const dimensions = [...new Map(catalog.flatMap((model) => model.dimensions.map((dimension) => [`${dimension.name}:${dimension.type}`, dimension] as const))).values()];
  const firstTarget = filter?.targets.map((id) => editor.analyses[id]).find((one) => one !== undefined);
  const firstModel = catalog.find((one) => one.name === firstTarget?.pinned.analysis.query.model);
  const initialDimension = firstModel?.dimensions.find((one) => one.name === filter?.dimension) ?? dimensions.find((one) => one.name === filter?.dimension);
  const [label, setLabel] = useState(filter?.label ?? "");
  const [dimension, setDimension] = useState(initialDimension === undefined ? "" : `${initialDimension.name}:${initialDimension.type}`);
  const [operator, setOperator] = useState<CommonOperator>(filter?.operator ?? "eq");
  const [preferred, setPreferred] = useState(show(filter?.default));
  const [allowed, setAllowed] = useState(show(filter?.allowed));
  const [targets, setTargets] = useState<readonly string[]>(filter?.targets ?? []);
  const [error, setError] = useState<string | null>(null);
  const report = useContext(PendingInputs);
  const formId = useId();
  const [initial] = useState(() => JSON.stringify([label, dimension, operator, preferred, allowed, targets]));
  const pending = initial !== JSON.stringify([label, dimension, operator, preferred, allowed, targets]);
  useEffect(() => {
    report?.(formId, pending);
    return () => { report?.(formId, false); };
  }, [report, formId, pending]);
  const selected = dimensions.find((one) => `${one.name}:${one.type}` === dimension);
  const candidates = Object.entries(editor.analyses).flatMap(([id, known]) => {
    if (known === undefined || selected === undefined) return [];
    const probe: CommonFilter = { id: "candidat", label: "Candidat", dimension: selected.name, operator: "eq", targets: [id] };
    return incompatibleTargets(probe, editor.analyses, catalog, selected.type).length === 0 ? [id] : [];
  });
  const choices = [...new Set([...candidates, ...targets])];
  const save = (): void => {
    if (selected === undefined) { setError("Choisissez une dimension du catalogue."); return; }
    try {
      const value = filterValues({ label, dimension: selected.name, operator, targets,
        ...(preferred === "" ? {} : { default: operator === "eq" ? parse(preferred, selected.type) : lines(preferred, selected.type) }),
        ...(allowed.trim() === "" ? {} : { allowed: lines(allowed, selected.type) }),
      }, "filtre");
      if (incompatibleTargets({ id: filter?.id ?? "nouveau", ...value }, editor.analyses, catalog).length > 0) { setError("Le filtre est incompatible avec une cible ou ses valeurs."); return; }
      const command = filter === undefined ? { type: "add_filter" as const, value } : { type: "update_filter" as const, id: filter.id, value, remove: [...(value.default === undefined ? ["default" as const] : []), ...(value.allowed === undefined ? ["allowed" as const] : [])] };
      if (editor.run(command, filter === undefined ? "Filtre ajouté." : "Filtre modifié.")) onDone?.();
    } catch (problem) { setError(String(problem)); }
  };
  return <div className="sb-props__fields">
    <label className="sb-field">Libellé<input value={label} onChange={(event) => { setLabel(event.target.value); }} /></label>
    <label className="sb-field">Dimension<select value={dimension} onChange={(event) => { setDimension(event.target.value); setTargets([]); }}><option value="">Choisir une dimension</option>{dimensions.map((one) => <option key={`${one.name}:${one.type}`} value={`${one.name}:${one.type}`}>{one.label || one.name} · {one.name} ({one.type})</option>)}</select></label>
    <label className="sb-field">Opérateur<select value={operator} onChange={(event) => { setOperator(event.target.value as CommonOperator); }}>{COMMON_OPERATORS.map((one) => <option key={one} value={one} disabled={selected !== undefined && !OPERATORS[selected.type].includes(one)}>{one}</option>)}</select></label>
    <label className="sb-field">Valeur par défaut<textarea aria-label="Valeur par défaut" value={preferred} onChange={(event) => { setPreferred(event.target.value); }} /><small>Pour une liste, une valeur par ligne ; vide retire le défaut.</small></label>
    <label className="sb-field">Valeurs autorisées<textarea aria-label="Valeurs autorisées" value={allowed} onChange={(event) => { setAllowed(event.target.value); }} /><small>Une valeur par ligne ; vide retire la liste.</small></label>
    <fieldset><legend>Cibles explicites</legend>{choices.map((id) => <label key={id} className="sb-field"><input type="checkbox" checked={targets.includes(id)} onChange={(event) => { setTargets(event.target.checked ? [...targets, id] : targets.filter((one) => one !== id)); }} /> {findNode(editor.tree, id)?.label ?? id}</label>)}{choices.length === 0 ? <p>Aucune tuile compatible connue.</p> : null}</fieldset>
    {error === null ? null : <Banner tone="danger">{error}</Banner>}
    <button type="button" className="sb-button" disabled={editor.readOnly} onClick={save}>{filter === undefined ? "Ajouter le filtre" : "Appliquer les propriétés"}</button>
    {filter === undefined ? null : <button type="button" className="sb-button" disabled={editor.readOnly} onClick={() => { if (editor.run({ type: "delete_filter", id: filter.id }, "Filtre supprimé.")) { editor.select(null); onDone?.(); } }}>Supprimer le filtre</button>}
  </div>;
}

/** Valeur de travail, distincte du défaut enregistré ; null désactive explicitement le filtre. */
export function ValeurFiltre({ filter }: { filter: CommonFilter }) {
  const editor = useEditor();
  const first = filter.targets.map((id) => editor.analyses[id]).find((one) => one !== undefined);
  const model = editor.catalog?.find((one) => one.name === first?.pinned.analysis.query.model);
  const type = model?.dimensions.find((one) => one.name === filter.dimension)?.type ?? "unknown";
  const [text, setText] = useState(show(filter.default));
  return <div><label className="sb-field">Valeur de travail · {filter.label}<textarea value={text} onChange={(event) => { setText(event.target.value); }} /></label>
    <button type="button" className="sb-button" onClick={() => { editor.setValue(filter.id, filter.operator === "eq" ? parse(text, type) : lines(text, type)); }}>Appliquer la valeur</button>
    <button type="button" className="sb-button" onClick={() => { editor.setValue(filter.id, null); }}>Effacer le filtre</button>
  </div>;
}
