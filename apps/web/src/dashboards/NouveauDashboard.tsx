import { useEffect, useRef, useState } from "react";

import { VISIBILITIES, type Visibility } from "../analyses/document";
import type { Failed } from "../analyses/Failure";
import { navigate } from "../shell/route";
import type { Fetch } from "../spaces/api";
import { Banner } from "../ui/Banner";
import { Dialog } from "../ui/Dialog";
import { refusalText } from "../themes/labels";
import { fetchPageTemplateRevision } from "../page-templates/client";
import type { DashboardDraft } from "./document";
import { instantiateTemplate } from "./edition/template";
import { ChoixNouveau, type Selection } from "./ChoixNouveau";
import { createDashboard } from "./client";
import { dashboardRefusalText } from "./Failure";
import { VISIBILITY_LABELS } from "./labels";

interface Props {
  space: string;
  fetcher: Fetch;
  onClose: () => void;
  identity?: string;
  onLocal?: (draft: DashboardDraft) => void;
}

/**
 * Un dashboard vide est créé directement ; un modèle est lu puis instancié en brouillon local avant toute création serveur.
 * Les choix de contenu sont versionnés et revalidés lorsque la visibilité change ; les refus restent visibles.
 */
export function NouveauDashboard({ space, fetcher, onClose, identity = "", onLocal }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("personal");
  const [template, setTemplate] = useState<Selection | null>(null);
  const [theme, setTheme] = useState<Selection | null>(null);
  const invalid = visibility === "shared" && (template?.draft === true || theme?.draft === true);
  const [busy, setBusy] = useState(false);
  const [templateFailure, setTemplateFailure] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failed | null>(null);
  // Un second envoi pendant la création ne la double jamais : le verrou est posé avant tout rendu.
  const inflight = useRef(false);
  const closed = useRef(false);
  useEffect(() => { closed.current = false; return () => { closed.current = true; }; }, []);
  const close = () => { closed.current = true; onClose(); };
  const create = () => {
    if (inflight.current || name.trim() === "" || invalid) return;
    inflight.current = true;
    setBusy(true);
    setFailure(null); setTemplateFailure(null);
    if (template !== null) {
      const controller = new AbortController();
      void fetchPageTemplateRevision(space, template.id, template.revision, controller.signal, fetcher).then((outcome) => {
        inflight.current = false;
        if (closed.current) return;
        if (outcome.status !== "ok") { setBusy(false); setTemplateFailure(outcome.status === "error" ? outcome.message : refusalText(outcome)); return; }
        const draft = instantiateTemplate(outcome.value, { name, visibility, ...(theme ? { theme: { theme_id: theme.id, revision: theme.revision } } : {}) });
        onLocal?.({ ...draft, description });
      });
      return;
    }
    void createDashboard(space, { name, description, visibility, defaults: {}, filters: [], layout: { sections: [] }, ...(theme ? { theme: { theme_id: theme.id, revision: theme.revision } } : {}) }, fetcher).then((outcome) => {
      inflight.current = false;
      if (closed.current) return;
      if (outcome.status === "ok") {
        navigate({ page: "dashboard", space, id: outcome.value.id });
        return;
      }
      setBusy(false);
      setFailure(outcome);
    });
  };
  return <Dialog title="Nouveau dashboard" onClose={close}>
    <form className="sb-dashboards__nouveau" onSubmit={(event) => { event.preventDefault(); create(); }}>
      <label className="sb-field">Nom du dashboard<input data-autofocus disabled={busy} value={name} maxLength={120} required onChange={(event) => { setName(event.target.value); }} /></label>
      <label className="sb-field">Description<textarea disabled={busy} value={description} rows={3} maxLength={2000} onChange={(event) => { setDescription(event.target.value); }} /></label>
      <fieldset className="sb-dashboards__visibility"><legend>Visibilité</legend>
        {VISIBILITIES.map((item) => <label key={item} className="sb-dashboards__choice"><input type="radio" name="visibilite-dashboard" disabled={busy} value={item} checked={visibility === item} onChange={() => { setVisibility(item); }} /> {VISIBILITY_LABELS[item]}</label>)}
        <small>{visibility === "shared" ? "Partagé : lisible par les membres de l'espace. Il ne peut épingler que des analyses partagées." : "Personnel : visible de vous seul."}</small>
      </fieldset>
      <ChoixNouveau kind="modele" space={space} identity={identity} visibility={visibility} fetcher={fetcher} disabled={busy} value={template} onChange={setTemplate} />
      {template === null ? null : <p className="sb-field__hint">Le dashboard sera créé au premier enregistrement, une fois les emplacements remplis.</p>}
      <ChoixNouveau kind="theme" space={space} identity={identity} visibility={visibility} fetcher={fetcher} disabled={busy} value={theme} onChange={setTheme} />
      {templateFailure === null ? null : <Banner tone="danger">{templateFailure}</Banner>}
      {failure === null ? null : <Banner tone="danger">{failure.status === "refused" ? dashboardRefusalText(failure) : `Création non confirmée : ${failure.message} Rien ne dit que le dashboard existe ; relisez la liste avant de recommencer.`}</Banner>}
      <div className="sb-dashboards__buttons">
        <button type="submit" className="sb-button sb-button--primary" disabled={busy || invalid || name.trim() === ""}>{busy ? template === null ? "Création…" : "Lecture du modèle…" : template === null ? "Créer et ouvrir" : "Ouvrir le brouillon"}</button>
        <button type="button" className="sb-button" onClick={close}>Annuler</button>
      </div>
    </form>
  </Dialog>;
}
