import { useState } from "react";

import { VISIBILITIES, type Visibility } from "../../analyses/document";
import { Badge } from "../../ui/Badge";
import { Banner } from "../../ui/Banner";
import { LEGENDS, NUMBER_FORMATS, TOOLTIPS, type Defaults, type ExecutableComponent, type Section, type Threshold } from "../document";
import { CHART_LABELS, KIND_LABELS, LEGEND_LABELS, NUMBER_FORMAT_LABELS, ORIGIN_LABELS, TOOLTIP_LABELS, VISIBILITY_LABELS } from "../labels";
import { BlocksEditor } from "./Blocs";
import { Choice, CommitField } from "./Champs";
import type { Origin } from "./commands";
import { useEditor } from "./EditorContext";
import { FiltreForm } from "./Filtres";
import { effective, titleOf, withField, withoutField } from "./presentation";
import { compatibleCharts } from "./problems";
import { findLayoutNode, findNode } from "./tree";

export const PROPS_TITLE_ID = "sb-props-title";

/**
 * Les propriétés du nœud sélectionné, ou celles du dashboard quand rien n'est sélectionné (plan 19, 19.5a). Chaque modification est
 * une commande du modèle d'édition, donc une étape d'annulation, et un refus se lit sans rien changer. Une surcharge de présentation
 * dit d'où vient chaque valeur (thème, analyse, dashboard, composant) et peut être retirée : le choix du type de graphique se
 * limite à ce que les dimensions de l'analyse permettent.
 */
export function Proprietes() {
  const editor = useEditor();
  const node = editor.selected === null ? undefined : findNode(editor.tree, editor.selected);
  const filter = editor.document.filters.find((one) => one.id === editor.selected);
  return <aside className="sb-props" aria-labelledby={PROPS_TITLE_ID}>
    <h2 id={PROPS_TITLE_ID} tabIndex={-1} className="sb-props__title">Propriétés · {filter === undefined ? (node === undefined ? "Dashboard" : node.label) : `Filtre · ${filter.label}`}</h2>
    <fieldset className="sb-props__fields" disabled={editor.readOnly}>
      <legend className="sb-visually-hidden">Propriétés modifiables</legend>
      {filter !== undefined ? <FiltreForm key={JSON.stringify(filter)} filter={filter} /> : node === undefined ? <DashboardFields /> : <NodeFields id={node.id} />}
    </fieldset>
  </aside>;
}

const withoutKey = <T extends object>(value: T, key: keyof T): T => Object.fromEntries(Object.entries(value).filter(([name]) => name !== key)) as T;

function DashboardFields() {
  const editor = useEditor();
  const { document } = editor;
  const set = (property: "name" | "description" | "visibility" | "defaults", value: unknown, done: string): void => { editor.run({ type: "update", id: null, property, value }, done); };
  const preference = <K extends keyof Defaults, V extends NonNullable<Defaults[K]>>(key: K, label: string, values: readonly V[], labels: Readonly<Record<V, string>>) => <Choice
    label={label}
    value={(document.defaults[key] ?? "") as V | ""}
    options={[{ value: "", label: "Aucun défaut : valeur du thème ou de l'analyse" }, ...values.map((value) => ({ value, label: labels[value] }))]}
    disabled={editor.readOnly}
    onChange={(value) => { set("defaults", value === "" ? withoutKey(document.defaults, key) : { ...document.defaults, [key]: value }, `${label} par défaut ${value === "" ? "retiré" : "modifié"}.`); }}
  />;
  return <>
    <CommitField label="Nom du dashboard" value={document.name} maxLength={120} onCommit={(text) => { set("name", text, "Nom modifié."); }} />
    <CommitField label="Description" value={document.description} multiline maxLength={2000} onCommit={(text) => { set("description", text, "Description modifiée."); }} />
    <fieldset className="sb-props__choice"><legend>Visibilité</legend>
      {VISIBILITIES.map((item) => <label key={item} className="sb-props__radio"><input type="radio" name="visibilite-edition" value={item} checked={document.visibility === item} onChange={() => { set("visibility", item satisfies Visibility, `Visibilité : ${VISIBILITY_LABELS[item]}.`); }} /> {VISIBILITY_LABELS[item]}</label>)}
      <small className="sb-field__hint">Un dashboard partagé ne peut épingler que des analyses partagées : le serveur refuse l'enregistrement sinon.</small>
    </fieldset>
    <fieldset className="sb-props__choice"><legend>Présentation par défaut des visuels et des KPI</legend>
      {preference("legend", "Légende", LEGENDS, LEGEND_LABELS)}
      {preference("number_format", "Format des nombres", NUMBER_FORMATS, NUMBER_FORMAT_LABELS)}
      {preference("tooltip", "Infobulle", TOOLTIPS, TOOLTIP_LABELS)}
    </fieldset>
  </>;
}

function NodeFields({ id }: { id: string }) {
  const editor = useEditor();
  const node = findNode(editor.tree, id) as NonNullable<ReturnType<typeof findNode>>;
  if (node.kind === "section") return <SectionFields section={editor.document.layout.sections.find((item) => item.id === id) as Section} />;
  if (node.kind === "column") {
    return <CommitField label="Largeur (douzièmes, de 1 à 12)" type="number" value={String(node.span)} onCommit={(text) => {
      const span = Number(text);
      if (!Number.isInteger(span)) { editor.say("La largeur est un nombre entier de douzièmes, de 1 à 12.", true); return; }
      editor.run({ type: "resize", id, span }, (tree) => `${node.name} : largeur ${String(findNode(tree, id)?.span)} douzièmes sur 12.`);
    }} />;
  }
  if (node.kind === "text") return <BlocksEditor id={id} />;
  if (node.kind === "analysis" || node.kind === "kpi") return <PresentationFields component={findLayoutNode(editor.document, id) as ExecutableComponent} />;
  return <p className="sb-field__hint">{KIND_LABELS[node.kind]} : aucune propriété. Il se place, se déplace et se supprime depuis la mise en page.</p>;
}

function SectionFields({ section }: { section: Section }) {
  const editor = useEditor();
  return <CommitField label="Titre de la section" value={section.title ?? ""} maxLength={120} hint="Un titre vide retire le titre de la section." onCommit={(text) => {
    editor.run({ type: "update", id: section.id, property: "title", value: text.trim() === "" ? undefined : text }, text.trim() === "" ? "Titre de la section retiré." : "Titre de la section modifié.");
  }} />;
}

function OriginNote({ origin, label, onRemove }: { origin: Origin; label: string; onRemove: () => void }) {
  const editor = useEditor();
  return <span className="sb-props__origin"><Badge tone="neutral">Origine : {ORIGIN_LABELS[origin]}</Badge>
    {origin === "component" ? <button type="button" className="sb-button" disabled={editor.readOnly} onClick={onRemove}>Retirer la surcharge : {label}</button> : null}
  </span>;
}

function ThresholdFields({ threshold, origin, disabled, onApply, onRemove }: { threshold: Threshold | undefined; origin: Origin; disabled: boolean; onApply: (value: Threshold) => void; onRemove: () => void }) {
  const editor = useEditor();
  const [value, setValue] = useState(threshold === undefined ? "" : String(threshold.value));
  const [label, setLabel] = useState(threshold?.label ?? "");
  const apply = (): void => {
    const number = Number(value);
    if (value.trim() === "" || !Number.isFinite(number)) { editor.say("Le seuil demande une valeur numérique.", true); return; }
    if (label.trim() === "") { editor.say("Le seuil demande un libellé.", true); return; }
    onApply({ value: number, label });
  };
  return <fieldset className="sb-props__choice"><legend>Seuil</legend>
    <label className="sb-field">Valeur du seuil<input type="number" value={value} disabled={disabled} onChange={(event) => { setValue(event.target.value); }} /></label>
    <label className="sb-field">Libellé du seuil<input value={label} maxLength={80} disabled={disabled} onChange={(event) => { setLabel(event.target.value); }} /></label>
    <button type="button" className="sb-button" disabled={disabled} onClick={apply}>Appliquer le seuil</button>
    {threshold === undefined ? <small className="sb-field__hint">Aucun seuil : ni l'analyse ni le dashboard n'en portent.</small> : <OriginNote origin={origin} label="seuil" onRemove={onRemove} />}
  </fieldset>;
}

function PresentationFields({ component }: { component: ExecutableComponent }) {
  const editor = useEditor();
  const pinned = editor.analyses[component.id]?.pinned;
  if (pinned === undefined) {
    return <Banner tone="warning">L'analyse épinglée n'est pas lue : sa présentation ne se modifie pas tant qu'elle n'est pas connue. Aucune valeur n'est devinée.</Banner>;
  }
  const found = effective(component, pinned, editor.document.defaults);
  const dimensions = pinned.analysis.query.dimensions.length;
  const presentation = component.presentation;
  const write = (next: typeof presentation, done: string): void => { editor.run({ type: "update", id: component.id, property: "presentation", value: next }, done); };
  const set = (field: Parameters<typeof withField>[1], value: unknown, label: string): void => { write(withField(presentation, field, value), `${label} modifié.`); };
  const remove = (field: Parameters<typeof withField>[1], label: string): void => { write(withoutField(presentation, field), `Surcharge retirée : ${label}.`); };
  const { fields } = found;
  const chart = found.type === "analysis" ? found.fields.chart : undefined;
  const chosen = chart?.value;
  const charts = compatibleCharts(dimensions);
  return <>
    <p className="sb-field__hint">Analyse épinglée : {pinned.analysis.name} · révision {String(component.reference.revision)}. La présentation ne change jamais la requête soumise.</p>
    <CommitField label="Titre" value={titleOf(found)} maxLength={120} onCommit={(text) => { if (text.trim() === "") remove("title", "titre"); else set("title", text, "Titre"); }} />
    <OriginNote origin={fields.title.origin} label="titre" onRemove={() => { remove("title", "titre"); }} />
    {chart === undefined || chosen === undefined ? null : <>
      <Choice
        label="Type de graphique"
        value={chosen}
        options={[...(charts.includes(chosen) ? [] : [{ value: chosen, label: `${CHART_LABELS[chosen]} (incompatible)` }]), ...charts.map((kind) => ({ value: kind, label: CHART_LABELS[kind] }))]}
        note={`Seuls les types compatibles avec les ${String(dimensions)} dimension${dimensions > 1 ? "s" : ""} de l'analyse sont proposés.`}
        onChange={(value) => { set("chart", value, "Type de graphique"); }}
      />
      <OriginNote origin={chart.origin} label="type de graphique" onRemove={() => { remove("chart", "type de graphique"); }} />
    </>}
    {found.type === "analysis" ? <>
      <Choice label="Légende" value={found.fields.legend.value as (typeof LEGENDS)[number]} options={LEGENDS.map((value) => ({ value, label: LEGEND_LABELS[value] }))} onChange={(value) => { set("legend", value, "Légende"); }} />
      <OriginNote origin={found.fields.legend.origin} label="légende" onRemove={() => { remove("legend", "légende"); }} />
    </> : null}
    <Choice label="Format des nombres" value={fields.number_format.value as (typeof NUMBER_FORMATS)[number]} options={NUMBER_FORMATS.map((value) => ({ value, label: NUMBER_FORMAT_LABELS[value] }))} onChange={(value) => { set("number_format", value, "Format des nombres"); }} />
    <OriginNote origin={fields.number_format.origin} label="format des nombres" onRemove={() => { remove("number_format", "format des nombres"); }} />
    <Choice label="Infobulle" value={fields.tooltip.value as (typeof TOOLTIPS)[number]} options={TOOLTIPS.map((value) => ({ value, label: TOOLTIP_LABELS[value] }))} onChange={(value) => { set("tooltip", value, "Infobulle"); }} />
    <OriginNote origin={fields.tooltip.origin} label="infobulle" onRemove={() => { remove("tooltip", "infobulle"); }} />
    <ThresholdFields key={JSON.stringify(fields.threshold.value)} threshold={fields.threshold.value} origin={fields.threshold.origin} disabled={editor.readOnly} onApply={(value) => { set("threshold", value, "Seuil"); }} onRemove={() => { remove("threshold", "seuil"); }} />
  </>;
}
