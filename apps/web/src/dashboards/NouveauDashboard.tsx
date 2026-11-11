import { useEffect, useRef, useState } from "react";

import { VISIBILITIES, type Visibility } from "../analyses/document";
import type { Failed } from "../analyses/Failure";
import { navigate } from "../shell/route";
import type { Fetch } from "../spaces/api";
import { Banner } from "../ui/Banner";
import { Dialog } from "../ui/Dialog";
import { createDashboard } from "./client";
import { dashboardRefusalText } from "./Failure";
import { VISIBILITY_LABELS } from "./labels";

interface Props {
  space: string;
  fetcher: Fetch;
  onClose: () => void;
}

/**
 * « Nouveau dashboard » (plan 19, 19.5a) : nom, description et visibilité, puis création par l'API et ouverture de l'éditeur.
 * Le dashboard naît vide (aucune section, aucun filtre) : tout ce qu'il contiendra se compose dans l'éditeur. Le serveur reste
 * juge ; son refus ou l'échec se lit tel quel, et rien n'est créé tant qu'il n'a pas répondu.
 */
export function NouveauDashboard({ space, fetcher, onClose }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("personal");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failed | null>(null);
  // Un second envoi pendant la création ne la double jamais : le verrou est posé avant tout rendu.
  const inflight = useRef(false);
  const closed = useRef(false);
  useEffect(() => { closed.current = false; return () => { closed.current = true; }; }, []);
  const close = () => { closed.current = true; onClose(); };
  const create = () => {
    if (inflight.current || name.trim() === "") return;
    inflight.current = true;
    setBusy(true);
    setFailure(null);
    void createDashboard(space, { name, description, visibility, defaults: {}, filters: [], layout: { sections: [] } }, fetcher).then((outcome) => {
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
      <label className="sb-field">Nom du dashboard<input data-autofocus value={name} maxLength={120} required onChange={(event) => { setName(event.target.value); }} /></label>
      <label className="sb-field">Description<textarea value={description} rows={3} maxLength={2000} onChange={(event) => { setDescription(event.target.value); }} /></label>
      <fieldset className="sb-dashboards__visibility"><legend>Visibilité</legend>
        {VISIBILITIES.map((item) => <label key={item} className="sb-dashboards__choice"><input type="radio" name="visibilite-dashboard" value={item} checked={visibility === item} onChange={() => { setVisibility(item); }} /> {VISIBILITY_LABELS[item]}</label>)}
        <small>{visibility === "shared" ? "Partagé : lisible par les membres de l'espace. Il ne peut épingler que des analyses partagées." : "Personnel : visible de vous seul."}</small>
      </fieldset>
      {failure === null ? null : <Banner tone="danger">{failure.status === "refused" ? dashboardRefusalText(failure) : `Création non confirmée : ${failure.message} Rien ne dit que le dashboard existe ; relisez la liste avant de recommencer.`}</Banner>}
      <div className="sb-dashboards__buttons">
        <button type="submit" className="sb-button sb-button--primary" disabled={busy || name.trim() === ""}>{busy ? "Création…" : "Créer et ouvrir"}</button>
        <button type="button" className="sb-button" onClick={close}>Annuler</button>
      </div>
    </form>
  </Dialog>;
}
