import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import espace from "../../../../contracts/espaces/espace.json";
import modele from "../../../../contracts/page_templates/routes/lire.json";
import composant from "../../../../contracts/components/routes/lire.json";
import historique from "../../../../contracts/components/routes/historique.json";
import diff from "../../../../contracts/components/routes/diff.json";
import { decodeSpace } from "../spaces/model";
import type { Fetch } from "../spaces/api";
import { navigate } from "../shell/route";
import { ContentPage, HistoryEntries } from "./ContentPage";

const id = "00000000-0000-4000-8000-000000000001";
const expand = (value: unknown) => JSON.parse(JSON.stringify(value).replaceAll("<uuid>", id).replaceAll("<commit>", "a".repeat(40))) as Record<string, unknown>;
const space = decodeSpace(espace.body, "espace");
afterEach(() => { window.history.replaceState(null, "", "/"); });
function setup(kind: "modele" | "composant", options: { history?: boolean; historical?: number; admin?: boolean; fail?: boolean; used?: boolean; previous?: boolean; corrupt?: boolean; saveFail?: boolean; approvalFail?: boolean; diffFail?: boolean; historyFail?: boolean; emptyDiff?: boolean; approved?: boolean; kpi?: boolean; rich?: boolean; emptyFilters?: boolean; approvalBad?: boolean; approvalDeny?: boolean; noOthers?: boolean; fancyDiff?: boolean; noDefault?: boolean; numericDiff?: boolean; twoSections?: boolean } = {}) {
  const body = expand(kind === "modele" ? modele.body : composant.body);
  const document = body[kind === "modele" ? "page_template" : "component"] as Record<string, unknown>;
  if (kind === "modele") { let counter = 1; const unique = (v: unknown): void => { if (Array.isArray(v)) { v.forEach(unique); return; } if (typeof v !== "object" || v === null) return; const o = v as Record<string, unknown>; if (typeof o.id === "string") o.id = `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`; Object.values(o).forEach(unique); }; unique(document.filters); unique(document.layout); }
  if (options.emptyFilters && kind === "modele") document.filters = [];
  if (options.noDefault && kind === "modele") document.filters = [{ id: "00000000-0000-4000-8000-000000000099", label: "Zone", dimension: "zone", operator: "eq" }];
  if (options.rich && kind === "modele") {
    const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    document.filters = [{ id: uid(20), label: "Zone", dimension: "zone", operator: "in", default: ["nord"], allowed: ["nord", "sud"] }];
    document.layout = { sections: [{ id: uid(21), title: "Synthèse", rows: [{ id: uid(22), columns: [{ id: uid(23), span: 6, children: [{ id: uid(24), type: "slot", expected: "kpi", label: "Total" }, { id: uid(25), type: "text", blocks: [{ type: "paragraph", content: [{ text: "Introduction" }] }, { type: "list", ordered: false, items: [[{ text: "Premier" }]] }] }] }, { id: uid(26), span: 6, children: [{ id: uid(27), type: "container", rows: [{ id: uid(28), columns: [{ id: uid(29), span: 12, children: [{ id: uid(30), type: "separator" }] }] }] }] }] }] }] };
  }
  if (options.twoSections && kind === "modele") {
    document.description = "Pour les ventes";
    const layout = document.layout as { sections: Record<string, unknown>[] };
    layout.sections.push({ id: "00000000-0000-4000-8000-000000000098", title: "Autre", rows: [] });
  }
  if (options.kpi && kind === "composant") { document.kind = "kpi"; document.presentation = { title: "Total", number_format: "integer", tooltip: "value", threshold: { value: 10, label: "Cible" } }; }
  if (options.approved) { body.state = "approved"; body.approved_revision = 1; }
  if (options.previous) { body.revision = 2; body.approved_revision = 1; }
  const fetcher = vi.fn<Fetch>().mockImplementation((url, init) => {
    if (options.fail) return Promise.resolve(Response.json({ error: { code: "forbidden", required: "creator" } }, { status: 403 }));
    if ((url.includes("/history") && options.historyFail) || (url.includes("/diff") && options.diffFail) || (url.includes("/approvals") && options.approvalFail) || (init?.method === "PUT" && options.saveFail)) return Promise.resolve(Response.json({ error: { code: "revision_conflict", reason: "stale" } }, { status: 409 }));
    if (url.includes("/history")) return Promise.resolve(Response.json(expand(historique.body)));
    if (url.includes("/diff") && options.numericDiff) return Promise.resolve(Response.json({ id, base: 1, other: 2, changes: [{ path: "/layout/sections/0/title", kind: "added", node: null, id: null, before: null, after: "Synthèse" }] }));
    if (url.includes("/diff") && options.fancyDiff) return Promise.resolve(Response.json({ id, base: 1, other: 2, changes: [{ path: "/presentation/threshold", kind: "added", node: null, id: null, before: null, after: { value: 10, label: "Cible" } }] }));
    if (url.includes("/diff")) return Promise.resolve(Response.json(options.emptyDiff ? { id, base: 1, other: 2, changes: [] } : expand(diff.body)));
    if (url.includes("/approvals") && options.approvalDeny) return Promise.resolve(Response.json({ error: { code: "forbidden", required: "admin" } }, { status: 403 }));
    if (url.includes("/approvals")) return Promise.resolve(Response.json({ id, state: "approved", approved_revision: options.approvalBad ? 1 : body.revision, diff: null, index_state: "indexed" }, { status: 201 }));
    if (init?.method === "DELETE") return Promise.resolve(options.used && kind === "composant" ? Response.json({ error: { code: "content_in_use", consumers: [{ kind: "dashboard", id }], others: options.noOthers ? 0 : 2 } }, { status: 409 }) : new Response(null, { status: 204 }));
    if (init?.method === "PUT") { const sent = JSON.parse(init.body as string) as { name: string; description: string }; document.name = sent.name; document.description = sent.description; body.revision = Number(body.revision) + 1; body.approved_revision = 1; return Promise.resolve(Response.json(body, { status: 201, headers: { ETag: `"${String(body.commit)}"` } })); }
    return Promise.resolve(Response.json(options.corrupt ? {} : body, { headers: { ETag: `"${String(body.commit)}"` } }));
  });
  render(<ContentPage space={{ ...space, role: options.admin === false ? "creator" : "admin" }} id={id} kind={kind} fetcher={fetcher} {...(options.history ? { view: "history" as const } : {})} {...(options.historical ? { historical: options.historical } : {})} />);
  return fetcher;
}
for (const kind of ["modele", "composant"] as const) {
  it(`lit et révise le ${kind}`, async () => {
    const fetcher = setup(kind);
    const name = await screen.findByRole("textbox", { name: "Nom" });
    expect(screen.getByText("Première approbation")).toBeInTheDocument();
    await userEvent.clear(name); await userEvent.type(name, "Révisé");
    expect(screen.getByRole("button", { name: "Approuver" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await screen.findByText(/Révision r2 enregistrée/);
    await waitFor(() => { expect(fetcher.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true); });
  });
  it(`affiche l'historique du ${kind}`, async () => {
    setup(kind, { history: true });
    expect(await screen.findByRole("link", { name: "Lire la révision 1" })).toBeInTheDocument();
  });
  it(`affiche le refus du ${kind}`, async () => {
    setup(kind, { fail: true }); expect(await screen.findByText(/Accès refusé/)).toBeInTheDocument();
  });
  it(`affiche le diff du ${kind}`, async () => {
    setup(kind, { previous: true }); expect(await screen.findByRole("table")).toHaveTextContent("Nom");
  });
  it(`affiche les consommateurs du ${kind}`, async () => {
    setup(kind, { admin: false, used: true });
    await userEvent.click(await screen.findByRole("button", { name: /Supprimer le/ }));
    await userEvent.click(screen.getByRole("button", { name: "Confirmer la suppression" }));
    if (kind === "modele") await waitFor(() => { expect(window.location.hash).toContain("/modeles"); });
    else expect(await screen.findByText(/autres dashboards/)).toBeInTheDocument();
  });
}

for (const kind of ["modele", "composant"] as const) {
  it(`${kind} : illisible, sans substitut`, async () => {
    setup(kind, { corrupt: true });
    expect(await screen.findByText(/Réponse du serveur hors contrat/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Nom" })).not.toBeInTheDocument();
  });
  it(`${kind} : conserve le brouillon après conflit et recharge`, async () => {
    const fetcher = setup(kind, { saveFail: true, admin: false });
    const name = await screen.findByRole("textbox", { name: "Nom" });
    await userEvent.clear(name); await userEvent.type(name, "Conflit");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByText(/Rien n'a été écrasé/)).toBeInTheDocument();
    expect(name).toHaveValue("Conflit");
    await userEvent.click(screen.getByRole("button", { name: "Recharger" }));
    await waitFor(() => { expect(screen.getByRole("textbox", { name: "Nom" })).toHaveValue("Exemple"); });
    expect(fetcher.mock.calls.filter(([url]) => !url.includes("/diff")).length).toBeGreaterThan(1);
  });
  it(`${kind} : historique refusé`, async () => {
    setup(kind, { history: true, historyFail: true });
    expect(await screen.findByText(/Historique indisponible.*Conflit/)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Historique des révisions" })).not.toBeInTheDocument();
  });
  it(`${kind} : révision ancienne en lecture seule`, async () => {
    setup(kind, { historical: 1 });
    expect(await screen.findByText(/Révision r1 en lecture seule/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Nom" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Enregistrer" })).not.toBeInTheDocument();
  });
  it(`${kind} : diff indisponible bloque l'approbation`, async () => {
    setup(kind, { previous: true, diffFail: true });
    expect(await screen.findByText(/Diff indisponible/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approuver" })).toBeDisabled();
  });
  it(`${kind} : approbation refusée invalide le diff`, async () => {
    setup(kind, { previous: true, approvalFail: true });
    await screen.findByRole("table"); await userEvent.click(screen.getByRole("button", { name: "Approuver" }));
    expect(await screen.findByText(/diff n'est plus valable/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approuver" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Recharger" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });
  it(`${kind} : approbation réussie`, async () => {
    const fetcher = setup(kind);
    await screen.findByText("Première approbation");
    await waitFor(() => { expect(screen.getByRole("button", { name: "Approuver" })).toBeEnabled(); });
    await userEvent.click(screen.getByRole("button", { name: "Approuver" }));
    await waitFor(() => { expect(fetcher.mock.calls.some(([url]) => url.includes("/approvals"))).toBe(true); });
    expect(await screen.findByRole("textbox", { name: "Nom" })).toHaveValue("Exemple");
  });
  it(`${kind} : annule puis confirme la suppression`, async () => {
    const fetcher = setup(kind, { admin: false });
    await userEvent.click(await screen.findByRole("button", { name: /Supprimer le/ }));
    await userEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Supprimer le/ }));
    await userEvent.click(screen.getByRole("button", { name: "Confirmer la suppression" }));
    await waitFor(() => { expect(fetcher.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true); });
    await waitFor(() => { expect(window.location.hash).toContain(kind === "modele" ? "/modeles" : "/composants"); });
  });
  it(`${kind} : aucune différence et révision approuvée`, async () => {
    setup(kind, { previous: true, emptyDiff: true });
    expect(await screen.findByText("Aucune différence structurelle.")).toBeInTheDocument();
  });
  it(`${kind} : aucune approbation pour un état approuvé`, async () => {
    setup(kind, { approved: true });
    expect(await screen.findByText("Approuvé r1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approuver" })).not.toBeInTheDocument();
  });
}
it("résume un KPI et sa présentation", async () => {
  setup("composant", { kpi: true });
  expect(await screen.findByText("Genre : KPI")).toBeInTheDocument();
  expect(screen.getByText("Cible : 10")).toBeInTheDocument();
  expect(screen.getByText("Entier")).toBeInTheDocument();
});

it("montre le squelette, les contenus et les filtres sans cibles", async () => {
  setup("modele", { rich: true, admin: false });
  expect(await screen.findByRole("heading", { name: "Synthèse" })).toBeInTheDocument();
  expect(screen.getByText("Total")).toBeInTheDocument(); expect(screen.getByText("KPI")).toBeInTheDocument();
  expect(screen.getByText("Introduction")).toBeInTheDocument(); expect(screen.getByText("Premier")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Conteneur" })).toBeInTheDocument();
  expect(screen.getByText(/Valeurs autorisées : nord, sud/)).toBeInTheDocument();
});
it("indique l'absence de filtres communs", async () => {
  setup("modele", { emptyFilters: true }); expect(await screen.findByText("Aucun filtre commun.")).toBeInTheDocument();
});

it("présente le seuil ajouté dans le diff du composant", async () => {
  setup("composant", { previous: true, fancyDiff: true });
  const table = await screen.findByRole("table");
  expect(table).toHaveTextContent("Présentation · Seuil"); expect(table).toHaveTextContent("Ajouté"); expect(table).toHaveTextContent("Valeur : 10"); expect(table).toHaveTextContent("—");
});
it("rend un refus d'approbation sans invalider le diff", async () => {
  setup("composant", { previous: true, approvalDeny: true }); await screen.findByRole("table");
  await userEvent.click(screen.getByRole("button", { name: "Approuver" }));
  expect(await screen.findByText(/Accès refusé/)).toBeInTheDocument(); expect(screen.getByRole("table")).toBeInTheDocument();
});
it("refuse une réponse d'approbation incohérente", async () => {
  setup("composant", { previous: true, approvalBad: true }); await screen.findByRole("table");
  await userEvent.click(screen.getByRole("button", { name: "Approuver" }));
  expect(await screen.findByText(/incohérente/)).toBeInTheDocument(); expect(screen.getByText(/diff n'est plus valable/)).toBeInTheDocument();
});
it("liste les consommateurs visibles sans inventer d'autres dashboards", async () => {
  setup("composant", { used: true, noOthers: true, admin: false });
  await userEvent.click(await screen.findByRole("button", { name: /Supprimer le/ })); await userEvent.click(screen.getByRole("button", { name: "Confirmer la suppression" }));
  expect(await screen.findByRole("link", { name: `Dashboard ${id}` })).toHaveAttribute("href", `#/espaces/finance/dashboards/${id}`);
  expect(screen.queryByText(/autres dashboards/)).not.toBeInTheDocument();
});
it("protège les modifications non enregistrées à la navigation", async () => {
  setup("modele", { admin: false }); const name = await screen.findByRole("textbox", { name: "Nom" }); await userEvent.type(name, "x");
  navigate({ page: "themes", space: "finance" });
  expect(await screen.findByRole("dialog", { name: "Quitter sans enregistrer ?" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Rester" })); expect(name).toHaveValue("Exemplex");
  navigate({ page: "themes", space: "finance" }); await userEvent.click(await screen.findByRole("button", { name: "Quitter sans enregistrer" }));
  expect(window.location.hash).toBe("#/espaces/finance/themes");
});
it("l'historique distingue une suppression d'une révision lisible", () => {
  render(<HistoryEntries history={{ id, currentRevision: null, deleted: true, revisions: [{ revision: 1, commit: "a".repeat(40), committedAt: new Date("2026-01-01T00:00:00Z"), actor: { issuer: "a", subject: "cora" }, action: "delete" }] }} link={() => "#/"} />);
  expect(screen.getByRole("list", { name: "Historique des révisions" })).toHaveTextContent("cora"); expect(screen.queryByRole("link", { name: /Lire la révision/ })).not.toBeInTheDocument();
});
it("ne soumet qu'une seule révision lors de deux clics rapides", async () => {
  const fetcher = setup("modele", { admin: false }); const name = await screen.findByRole("textbox", { name: "Nom" }); await userEvent.type(name, "x");
  const button = screen.getByRole("button", { name: "Enregistrer" }); act(() => { fireEvent.click(button); fireEvent.click(button); });
  await screen.findByText(/Révision r2 enregistrée/); expect(fetcher.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
});

it("rend un filtre sans valeur par défaut", async () => {
  setup("modele", { noDefault: true }); expect(await screen.findByText(/Dimension : zone/)).toBeInTheDocument(); expect(screen.queryByText(/Valeur par défaut/)).not.toBeInTheDocument();
});
it("nomme les éléments numérotés du diff", async () => {
  setup("modele", { previous: true, numericDiff: true }); expect(await screen.findByRole("table")).toHaveTextContent("Structure · Sections · 1 · Titre");
});
it("ne soumet pas deux suppressions lors de clics simultanés", async () => {
  const fetcher = setup("composant", { admin: false }); await userEvent.click(await screen.findByRole("button", { name: /Supprimer le/ }));
  const button = screen.getByRole("button", { name: "Confirmer la suppression" }); act(() => { fireEvent.click(button); fireEvent.click(button); });
  await waitFor(() => { expect(fetcher.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1); });
});
it("ne soumet pas deux approbations lors de clics simultanés", async () => {
  const fetcher = setup("composant"); await screen.findByText("Première approbation"); await waitFor(() => { expect(screen.getByRole("button", { name: "Approuver" })).toBeEnabled(); });
  const button = screen.getByRole("button", { name: "Approuver" }); act(() => { fireEvent.click(button); fireEvent.click(button); });
  await waitFor(() => { expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/approvals"))).toHaveLength(1); });
});
it("modifie la description puis ferme la confirmation au clavier", async () => {
  setup("modele", { admin: false });
  const description = await screen.findByRole("textbox", { name: "Description" });
  await userEvent.type(description, "Une description");
  expect(screen.getByText("Modifié")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /Supprimer le/ }));
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(description).toHaveValue("Une description");
});
it("présente la première approbation et les actions sans séparateur orphelin", async () => {
  setup("modele");
  expect(await screen.findByRole("heading", { name: "Première approbation" })).toBeInTheDocument();
  expect(screen.getByText("1 section")).toBeInTheDocument();
  expect(screen.getByRole("separator", { name: "Séparateur" })).toHaveTextContent("Séparateur");
  expect(screen.getByText("Révision r1")).toBeInTheDocument();
  const actions = screen.getByRole("button", { name: "Enregistrer" }).parentElement;
  expect(actions).toContainElement(screen.getByRole("button", { name: "Supprimer le modèle de page" }));
});
it("présente l'analyse épinglée avec un lien lisible et son identifiant", async () => {
  setup("composant");
  const link = await screen.findByRole("link", { name: "Lire l’analyse · révision r1" });
  expect(link).toHaveAttribute("href", `#/espaces/finance/analyses/${id}/revisions/1`);
  expect(screen.getByText(id)).toHaveClass("sb-mono");
  expect(screen.getByRole("heading", { name: "Présentation sémantique", level: 3 })).toBeInTheDocument();
});

it("résume une description et plusieurs sections à la première approbation", async () => {
  setup("modele", { twoSections: true });
  const approval = await screen.findByRole("region", { name: "Approbation du modèle de page" });
  expect(approval).toHaveTextContent("Pour les ventes"); expect(approval).toHaveTextContent("2 sections");
});
