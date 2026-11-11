import { useEffect, useRef, useState, type ReactNode } from "react";

import { LIMITS, type Column, type LayoutNode, type Row } from "../document";
import { BlocksView } from "./Blocs";
import { useEditor } from "./EditorContext";
import { PREVIEW_WIDTHS, responsiveLayout, type EffectiveColumn, type EffectiveRow } from "./responsive";
import { Tuile } from "./Tuile";

type Size = keyof typeof PREVIEW_WIDTHS;
const SIZES: readonly { id: Size; label: string }[] = [
  { id: "desktop", label: "Bureau · 1 280 px" },
  { id: "tablet", label: "Tablette · 768 px" },
  { id: "phone", label: "Téléphone · 390 px" },
];

/** Présentation lecteur : elle réutilise les états déjà calculés sans soumettre de nouvelles requêtes. */
export function Apercu({ onClose }: { onClose: () => void }) {
  const editor = useEditor();
  const [size, setSize] = useState<Size>("desktop");
  const [scale, setScale] = useState(1);
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = frame.current as HTMLDivElement;
    const measure = (): void => { setScale(Math.min(1, (element.clientWidth || PREVIEW_WIDTHS[size]) / PREVIEW_WIDTHS[size])); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => { observer.disconnect(); };
  }, [size]);
  const layout = responsiveLayout(editor.document, PREVIEW_WIDTHS[size]);
  const leaf = (child: LayoutNode, effective: EffectiveColumn["children"][number]): ReactNode => {
    if (child.type === "container") return <div key={child.id} className="sb-preview__container">{rows(child.rows, effective.rows as readonly EffectiveRow[])}</div>;
    if (child.type === "text") return <BlocksView key={child.id} blocks={child.blocks} />;
    if (child.type === "separator") return <hr key={child.id} className="sb-node__rule" />;
    return <div key={child.id} data-narrow={effective.narrow} className="sb-preview__tile"><Tuile component={child} state={editor.states.get(child.id)} pinned={editor.analyses[child.id]?.pinned} defaults={editor.document.defaults} catalog={editor.catalog} theme={editor.theme} onCancel={() => { editor.cancelTile(child.id); }} onRetry={() => { editor.retryTile(child.id); }} onRestart={() => { editor.restartTile(child.id); }} /></div>;
  };
  const column = (item: Column, effective: EffectiveRow["columns"][number]): ReactNode => <div key={item.id} className="sb-preview__column" data-column={item.id} style={{ gridColumn: `span ${String(effective.fraction * LIMITS.grid)}` }}>{item.children.map((child, index) => leaf(child, effective.children[index] as EffectiveColumn["children"][number]))}</div>;
  const rows = (items: readonly Row[], effective: readonly EffectiveRow[]): ReactNode => items.map((row, index) => {
    const resolved = effective[index] as EffectiveRow;
    return <div key={row.id} className="sb-preview__row" data-stacked={resolved.stacked}>{row.columns.map((item, at) => column(item, resolved.columns[at] as EffectiveRow["columns"][number]))}</div>;
  });
  return <section className="sb-preview" aria-label="Aperçu lecteur">
    <h1>Aperçu lecteur · {editor.document.name}</h1>
    <div className="sb-dashboards__buttons"><button type="button" className="sb-button" onClick={onClose}>Retour à l'éditeur</button></div>
    <p className="sb-banner sb-banner--warning">Aperçu lecteur : les données restent celles de l'éditeur.</p>
    <fieldset className="sb-preview__sizes"><legend>Largeur de l'aperçu</legend>{SIZES.map((option) => <label key={option.id}><input type="radio" name="preview-size" checked={size === option.id} onChange={() => { setSize(option.id); }} /> {option.label}</label>)}</fieldset>
    <div ref={frame} className="sb-preview__frame"><div className="sb-preview__viewport" style={{ width: PREVIEW_WIDTHS[size], zoom: scale }}>
      {editor.document.layout.sections.map((section, index) => <section key={section.id} className="sb-preview__section">{section.title === undefined ? null : <h2>{section.title}</h2>}{rows(section.rows, (layout[index] as (typeof layout)[number]).rows)}</section>)}
    </div></div>
  </section>;
}
