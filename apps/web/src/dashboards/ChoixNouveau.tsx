import { useEffect, useState } from "react";
import { fetchPageTemplates } from "../page-templates/client";
import type { Fetch } from "../spaces/api";
import { fetchThemes } from "../themes/client";
import { refusalText } from "../themes/ContentListPage";
import type { ThemeListItem } from "../themes/model";
import { Banner } from "../ui/Banner";
import { choices } from "./edition/ChoixContenus";

export type Selection = { id: string; revision: number; name: string; draft: boolean };
type Result = { status: "idle" | "loading" } | { status: "ok"; items: readonly ThemeListItem[]; unreadable: number } | { status: "error"; message: string } | { status: "refused"; code: string; reason?: string; required?: string; field?: string; parameter?: string; detail?: string };
export function ChoixNouveau({ kind, space, identity, visibility, fetcher, value, onChange, disabled = false }: { kind: "theme" | "modele"; space: string; identity: string; visibility: "personal" | "shared"; fetcher: Fetch; value: Selection | null; onChange: (value: Selection | null) => void; disabled?: boolean }) {
  const [active, setActive] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Result>({ status: "idle" });
  useEffect(() => {
    if (!active) return;
    const abort = new AbortController();
    const load = async () => {
      const result = kind === "theme" ? await fetchThemes(space, abort.signal, fetcher) : await fetchPageTemplates(space, abort.signal, fetcher);
      if (abort.signal.aborted) return;
      if (result.status !== "ok") { setState(result); return; }
      const list = result.value; setState({ status: "ok", items: "themes" in list ? list.themes : list.pageTemplates, unreadable: list.unreadable });
    };
    void load(); return () => { abort.abort(); };
  }, [active, kind, space, fetcher, attempt]);
  const options = state.status === "ok" ? choices(state.items, visibility === "personal", identity) : [];
  const key = (entry: Selection) => `${entry.id}:${String(entry.revision)}`;
  const chosen = value ? key(value) : "";
  const invalid = value !== null && value.draft && visibility === "shared";
  return <><label className="sb-field">{kind === "theme" ? "Thème" : "Modèle de page"}<select value={chosen} disabled={disabled} onFocus={() => { if (!active) { setState({ status: "loading" }); setActive(true); } }} onChange={(event) => { onChange(options.find((item) => key(item) === event.target.value) ?? null); }} aria-invalid={invalid}>
    <option value="">{kind === "theme" ? "Skifer clair (par défaut, sans thème)" : "Aucun (dashboard vide)"}</option>
    {value && !options.some((item) => key(item) === chosen) ? <option value={chosen}>{value.name} · r{value.revision}{value.draft ? visibility === "shared" ? " (brouillon : interdit pour un dashboard partagé)" : " (brouillon)" : state.status === "ok" ? " (ancienne révision approuvée)" : ""}</option> : null}
    {options.map((item) => <option key={key(item)} value={key(item)}>{item.name} · r{item.revision}{item.draft ? " · brouillon" : ""}</option>)}
  </select></label>
    {state.status === "loading" ? <p>Lecture {kind === "theme" ? "des thèmes" : "des modèles"}…</p> : state.status === "error" || state.status === "refused" ? <Banner tone="danger">{kind === "theme" ? "Thèmes" : "Modèles"} indisponibles : {state.status === "error" ? state.message : refusalText(state)} <button type="button" className="sb-button" onClick={() => { setState({ status: "loading" }); setAttempt((value) => value + 1); }}>Réessayer</button></Banner> : state.status === "ok" && state.unreadable > 0 ? <Banner tone="warning">Certains contenus sont illisibles.</Banner> : null}
    {invalid ? <p role="alert">Un brouillon ne peut pas être choisi pour un dashboard partagé. Choisissez une autre référence.</p> : null}
  </>;
}
