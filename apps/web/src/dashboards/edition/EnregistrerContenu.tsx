import { useEffect, useId, useRef, useState } from "react";
import { VIOLATION_LABELS } from "../../analyses/labels";
import { createComponent, type ComponentDraft } from "../../components-lib/client";
import { createPageTemplate } from "../../page-templates/client";
import { routeHash } from "../../shell/route";
import type { Fetch } from "../../spaces/api";
import { refusalText } from "../../themes/ContentListPage";
import { Banner } from "../../ui/Banner";
import { Dialog } from "../../ui/Dialog";
import type { DashboardDocument, ExecutableComponent } from "../document";
import { extractTemplate, type ResolvedComponents } from "./extractTemplate";

type Props = { space: string; fetcher: Fetch; reason: string | null } & (
  | { kind: "modele"; dashboard: DashboardDocument; components: ResolvedComponents }
  | { kind: "composant"; node: ExecutableComponent; analysisName: string }
);
type Failure = { status: "error"; message: string } | { status: "refused"; code: string; reason?: string; required?: string; field?: string; parameter?: string; detail?: string; violations?: readonly { path: string; rule: string }[]; components?: readonly string[] };

const RULE_LABELS: Readonly<Record<string, string>> = { ...VIOLATION_LABELS, stale: "révision périmée", duplicate_id: "identifiant répété", row_overflow: "largeur de rangée dépassée", too_deep: "structure trop profonde", container_not_alone: "conteneur non isolé", filter_without_target: "filtre sans cible", unknown_target: "cible introuvable", target_not_executable: "cible non exécutable", default_not_allowed: "valeur par défaut non autorisée" };
const PATH_LABELS: Readonly<Record<string, string>> = { name: "Nom", description: "Description", analysis: "Analyse", analysis_id: "Identifiant de l’analyse", revision: "Révision", kind: "Genre", presentation: "Présentation", layout: "Structure", sections: "Sections", rows: "Rangées", columns: "Colonnes", children: "Contenu", filters: "Filtres", defaults: "Valeurs par défaut", id: "Identifiant", title: "Titre", type: "Genre", expected: "Genre attendu", label: "Libellé", dimension: "Dimension", operator: "Opérateur", default: "Valeur par défaut", allowed: "Valeurs autorisées", span: "Largeur", blocks: "Blocs", content: "Contenu", text: "Texte", items: "Éléments", chart: "Graphique", legend: "Légende", number_format: "Format des nombres", tooltip: "Infobulle", threshold: "Seuil", value: "Valeur" };
const pathText = (path: string) => path.split("/").slice(1).map((part) => /^\d+$/.test(part) ? String(Number(part) + 1) : PATH_LABELS[part] ?? part).join(" · ");
const readableRefusal = (failure: Extract<Failure, { status: "refused" }>) => refusalText({ ...failure, ...(failure.reason === undefined ? {} : { reason: RULE_LABELS[failure.reason] as string }) });

/** Crée un contenu indépendant, sans modifier le dashboard ou son nœud. */
export function EnregistrerContenu(props: Props) {
  const reasonId = useId();
  const model = props.kind === "modele";
  const noun = model ? "modèle" : "composant";
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const [failure, setFailure] = useState<Failure | string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  useEffect(() => { if (failure !== null && !busy) nameInput.current?.focus(); }, [failure, busy]);
  const start = () => {
    setName(props.kind === "modele" ? props.dashboard.name : props.node.presentation.title ?? props.analysisName);
    setDescription(""); setFailure(null); setCreated(null); setOpen(true);
  };
  const close = () => { if (!lock.current) setOpen(false); };
  const submit = () => {
    if (lock.current || props.reason !== null || name.trim() === "") return;
    setFailure(null);
    let request: ReturnType<typeof createPageTemplate> | ReturnType<typeof createComponent>;
    if (props.kind === "modele") {
      const result = extractTemplate(props.dashboard, props.components);
      if (!result.ok) { setFailure(result.reason === "unresolved_component" ? "Un composant référencé est indisponible : le modèle ne peut pas être extrait." : result.reason === "component_id_mismatch" ? "Un composant lu ne correspond pas à la référence : le modèle ne peut pas être extrait." : `Le modèle extrait est invalide : ${result.detail}`); return; }
      request = createPageTemplate(props.space, { ...result.draft, name, description }, props.fetcher);
    } else {
      const draft: ComponentDraft = { name, description, kind: props.node.type === "analysis" ? "visual" : "kpi", analysis: structuredClone(props.node.reference), presentation: structuredClone(props.node.presentation) };
      request = createComponent(props.space, draft, props.fetcher);
    }
    lock.current = true; setBusy(true);
    void request.then((result) => { lock.current = false; setBusy(false); if (result.status !== "ok") { setFailure(result); return; } setCreated(result.value.id); setOpen(false); });
  };
  return <><span className="sb-content-save"><button type="button" className="sb-button" aria-describedby={props.reason === null ? undefined : reasonId} disabled={props.reason !== null} onClick={start}>Enregistrer comme {noun}</button>{props.reason === null ? null : <small id={reasonId} className="sb-field__hint">{props.reason}</small>}</span>
    {created === null ? null : <Banner tone="neutral">{model ? "Modèle" : "Composant"} créé en brouillon. <a href={routeHash({ page: props.kind, space: props.space, id: created })}>Ouvrir la fiche du {noun}</a></Banner>}
    {open ? <Dialog title={`Enregistrer comme ${noun}`} onClose={close}><p>Ce {noun} sera créé en brouillon.</p><label className="sb-field">Nom <input ref={nameInput} data-autofocus maxLength={120} value={name} disabled={busy} onChange={(event) => { setName(event.target.value); }} /></label><label className="sb-field">Description <textarea maxLength={2000} value={description} disabled={busy} onChange={(event) => { setDescription(event.target.value); }} /></label>{failure === null ? null : <Banner tone="danger">{typeof failure === "string" ? failure : failure.status === "error" ? failure.message : <>{readableRefusal(failure)}{failure.violations === undefined ? null : <ul>{failure.violations.map((violation) => <li key={`${violation.path}:${violation.rule}`}>{pathText(violation.path)} : {RULE_LABELS[violation.rule]}</li>)}</ul>}{failure.components === undefined ? null : <p>Références concernées : {failure.components.join(", ")}.</p>}</>}</Banner>}<div className="sb-dashboards__buttons"><button type="button" className="sb-button" disabled={busy} onClick={close}>Annuler</button><button type="button" className="sb-button sb-button--primary" disabled={busy || name.trim() === "" || props.reason !== null} onClick={submit}>{busy ? "Enregistrement…" : "Créer"}</button></div></Dialog> : null}
  </>;
}
