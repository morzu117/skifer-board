import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import liste from "../../../../contracts/catalogue/liste.json";
import ancienne from "../../../../contracts/catalogue/liste-ancienne.json";
import revenu from "../../../../contracts/catalogue/fiche-revenu-net.json";
import invalide from "../../../../contracts/catalogue/fiche-invalide.json";
import commande from "../../../../contracts/catalogue/fiche-commande.json";
import indisponible from "../../../../contracts/catalogue/indisponible.json";
import inconnue from "../../../../contracts/catalogue/fiche-inconnue.json";
import { CataloguePage } from "./CataloguePage";
import { DocumentPanel } from "./DocumentPanel";
import type { Fetch } from "./api";
import { decodeCatalogPage, decodeDocumentPage } from "./model";

const now = () => new Date("2026-11-01T12:30:00Z");
const response = (sample: { body: unknown; status: number }) => Response.json(sample.body, { status: sample.status });
/** Résout une promesse simulée, puis laisse React appliquer les mises à jour qui en découlent. */
async function settle(resolve: () => void) {
  await act(async () => {
    resolve();
    await Promise.resolve();
  });
}
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}
function serve(document = revenu) {
  return vi.fn<Fetch>().mockImplementation((url) => Promise.resolve(response(url === "/api/catalog" ? liste : document)));
}
async function open(label = "Revenu net") {
  const button = await screen.findByRole("button", { name: label });
  await userEvent.click(button);
  const heading = await screen.findByRole("heading", { name: label, level: 2 });
  await waitFor(() => { expect(heading).toHaveFocus(); });
  return { button, panel: screen.getByRole("complementary", { name: label }) };
}

describe("Liste du catalogue", () => {
  it("annonce le chargement puis une ligne par entrée, les mots et la provenance", async () => {
    const pending = deferred();
    render(<CataloguePage fetcher={() => pending.promise} now={now} />);
    expect(screen.getByRole("status")).toHaveTextContent("Chargement du catalogue");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    await settle(() => { pending.resolve(response(liste)); });
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows).toHaveLength(liste.body.entries.length + 1);
    for (const entry of liste.body.entries) {
      const button = screen.getByRole("button", { name: entry.label });
      expect(button).toHaveAttribute("aria-expanded", "false");
      expect(button).not.toHaveAttribute("aria-controls");
      expect(button.closest("tr")).toHaveTextContent(entry.kind === "concept" ? "Sans objet" : "Non résolue");
      expect(button.closest("tr")).toHaveTextContent(entry.status === "draft" ? "Brouillon" : entry.status === "invalid" ? "Invalide" : "Validé");
    }
    expect(screen.getByRole("status")).toHaveTextContent("7 définitions");
    expect(screen.getByText(/Index Atlas du commit/)).toHaveTextContent("d7eba96 · clone lu le 01/11/2026 10:30 UTC (il y a 2 h)");
    expect(screen.queryByText("Exécutable", { exact: true })).not.toBeInTheDocument();
  });
  it.each([0, 1])("affiche le compteur pour %i entrée et distingue le vide", async (count) => {
    render(<CataloguePage fetcher={vi.fn<Fetch>().mockResolvedValue(Response.json({ ...liste.body, entries: liste.body.entries.slice(0, count) }))} now={now} />);
    expect(await screen.findByText(count === 1 ? "1 définition" : "0 définitions")).toBeInTheDocument();
    if (count === 0) {
      expect(screen.getByText("Aucune définition ne correspond à ces critères.")).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
    }
  });
  it.each([
    ["Rechercher", "  CA & été  ", "q=CA+%26+%C3%A9t%C3%A9"],
    ["Domaine", "finance", "domain=finance"], ["Propriétaire", "claire.m", "owner=claire.m"],
    ["Statut Atlas", "validated", "status=validated"], ["Type", "kpi", "kind=kpi"],
  ])("requête et remise à zéro du filtre %s", async (label, value, search) => {
    const fetcher = vi.fn<Fetch>().mockImplementation(() => Promise.resolve(response(liste)));
    render(<CataloguePage fetcher={fetcher} now={now} />);
    await screen.findByRole("table");
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    await waitFor(() => { expect(fetcher).toHaveBeenLastCalledWith(`/api/catalog?${search}`, expect.anything()); });
    await screen.findByRole("table");
    fireEvent.change(screen.getByLabelText(label), { target: { value: "" } });
    await waitFor(() => { expect(fetcher).toHaveBeenLastCalledWith("/api/catalog", expect.anything()); });
    await screen.findByRole("table");
    const form = screen.getByLabelText("Rechercher").closest("form");
    expect(form).not.toBeNull();
    expect(fireEvent.submit(form as HTMLFormElement)).toBe(false);
  });
  it("ne montre jamais la réponse dépassée même si le fetcher ignore l'abandon", async () => {
    const first = deferred(); const second = deferred();
    const fetcher = vi.fn<Fetch>().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<CataloguePage fetcher={fetcher} now={now} />);
    fireEvent.change(screen.getByLabelText("Rechercher"), { target: { value: "nouvelle" } });
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    await settle(() => { first.resolve(response(liste)); });
    expect(screen.queryByRole("button", { name: "Revenu net" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Chargement");
    await settle(() => { second.resolve(Response.json({ ...liste.body, entries: [] })); });
    expect(screen.getByText("0 définitions")).toBeInTheDocument();
  });
  it("une ancienne réponse ne doit pas effacer la liste plus récente déjà affichée", async () => {
    const first = deferred(); const second = deferred();
    const fetcher = vi.fn<Fetch>().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<CataloguePage fetcher={fetcher} now={now} />);
    fireEvent.change(screen.getByLabelText("Rechercher"), { target: { value: "nouvelle" } });
    await settle(() => { second.resolve(Response.json({ ...liste.body, entries: [] })); });
    expect(screen.getByText("0 définitions")).toBeInTheDocument();
    await settle(() => { first.resolve(response(liste)); });
    expect(screen.getByText("0 définitions")).toBeInTheDocument();
  });
  it.each(["Domaine", "Propriétaire"])("conserve les facettes en chargement et la valeur absente : %s", async (label) => {
    const pending = deferred();
    const fetcher = vi.fn<Fetch>().mockResolvedValueOnce(response(liste)).mockReturnValueOnce(pending.promise);
    render(<CataloguePage fetcher={fetcher} now={now} />);
    await screen.findByRole("table");
    const select = screen.getByLabelText(label);
    const value = label === "Domaine" ? "finance" : "claire.m";
    fireEvent.change(select, { target: { value } });
    expect(within(select).getAllByRole("option")).toHaveLength(3);
    expect(screen.getByRole("status")).toHaveTextContent("Chargement");
    await settle(() => { pending.resolve(Response.json({ ...liste.body, facets: { ...liste.body.facets, domain: [], owner: [] } })); });
    expect(select).toHaveValue(value);
    expect(within(select).getByRole("option", { name: value })).toBeInTheDocument();
  });
  it.each(["Type", "Statut Atlas"])("conserve la sélection absente des nouvelles facettes : %s", async (label) => {
    // Les facettes du serveur peuvent changer entre deux lectures du clone.
    const pending = deferred();
    const fetcher = vi.fn<Fetch>().mockResolvedValueOnce(response(liste)).mockReturnValueOnce(pending.promise);
    render(<CataloguePage fetcher={fetcher} now={now} />);
    await screen.findByRole("table");
    const select = screen.getByLabelText(label);
    const value = label === "Type" ? "kpi" : "validated";
    fireEvent.change(select, { target: { value } });
    await settle(() => { pending.resolve(Response.json({ ...liste.body, facets: { ...liste.body.facets, kind: [], status: [] } })); });
    expect(select).toHaveValue(value);
  });
  it("relance après une erreur via Réessayer", async () => {
    const fetcher = vi.fn<Fetch>().mockRejectedValueOnce(new Error("hors ligne")).mockResolvedValueOnce(response(liste));
    render(<CataloguePage fetcher={fetcher} now={now} />);
    await userEvent.click(await screen.findByRole("button", { name: "Réessayer" }));
    await screen.findByRole("table");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([[inconnue, "Le service du catalogue est introuvable"], [indisponible, "Atlas est indisponible"]] as const)("distingue une liste indisponible ou absente : %j", async (sample, message) => {
    render(<CataloguePage fetcher={vi.fn<Fetch>().mockResolvedValue(response(sample))} now={now} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
  it.each([false, true])("sert l'index ancien avec âge, commit et détail, provenance incomplète : %s", async (fallback) => {
    const page = decodeCatalogPage(ancienne.body);
    if (fallback) { page.provenance.problem = null; page.provenance.detail = null; }
    render(<CataloguePage fetcher={vi.fn<Fetch>().mockResolvedValue(Response.json(page))} now={now} />);
    await screen.findByRole("table");
    expect(screen.getByText("Atlas indisponible").parentElement).toHaveTextContent("il y a 2 h (commit d7eba96)");
    expect(screen.getByText("Atlas indisponible").parentElement).toHaveTextContent(fallback ? "n'a pas pu être relu" : ancienne.body.provenance.detail);
    expect(screen.getAllByText("Non résolue")).toHaveLength(5);
  });
  it("abandonne une lecture au démontage sans afficher d'erreur", async () => {
    let reject!: (reason: Error) => void;
    const fetcher = vi.fn<Fetch>().mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    const { unmount } = render(<CataloguePage fetcher={fetcher} />);
    unmount();
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    await settle(() => { reject(new Error("abandon")); });
  });
});

describe("Fiche depuis la liste", () => {
  it("ouvre le KPI, lie la ligne au panneau et affiche toutes ses informations", async () => {
    render(<CataloguePage fetcher={serve()} now={now} />);
    const { button, panel } = await open();
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAttribute("aria-controls", panel.id);
    for (const text of [revenu.body.document.entry.description, "claire.m", revenu.body.document.fingerprint,
      "CA net, net revenue, recettes consolidées", "Déclinaisons · 2", "nordis-es", "Définition propre", "nordis-fr", "Surcharge",
      "Références · 2", "Commande", "Date de référence", "Utilisée par · 3", "Marge brute", "Impact : 3 documents en dépendent",
      "Non disponible : Atlas ne définit pas encore", "Index Atlas du commit"]) {
      expect(panel).toHaveTextContent(text);
    }
    fireEvent.keyDown(screen.getByRole("heading", { level: 2, name: "Revenu net" }), { key: "a" });
    expect(panel).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(panel).not.toBeInTheDocument();
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("aria-expanded", "false");
  });
  it("ferme par le bouton et rend le focus", async () => {
    render(<CataloguePage fetcher={serve()} now={now} />);
    const { button, panel } = await open();
    await userEvent.click(within(panel).getByRole("button", { name: "Fermer la fiche" }));
    expect(panel).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });
  it("affiche diagnostics, empreinte non calculée et référence non résolue", async () => {
    render(<CataloguePage fetcher={vi.fn<Fetch>().mockImplementation((url) => Promise.resolve(response(url === "/api/catalog" ? liste : invalide)))} now={now} />);
    const { panel } = await open("Invalide");
    for (const text of ["Diagnostics Atlas · 1", "Erreur", "id_mismatch", invalide.body.document.issues[0]?.message ?? "diagnostic attendu",
      "/data_product/id", "Non calculée : définition non valide.", "revenu-absent", "Non résolue", "Aucune déclinaison", "Aucun document Atlas", "Impact : 0 documents"]) expect(panel).toHaveTextContent(text);
  });
  it("change de ligne et recharge le concept sans disponibilité ni déclinaisons", async () => {
    const fetcher = vi.fn<Fetch>().mockImplementation((url) => Promise.resolve(response(url === "/api/catalog" ? liste : url.endsWith("commande") ? commande : revenu)));
    render(<CataloguePage fetcher={fetcher} now={now} />);
    await open();
    const { panel } = await open("Commande");
    expect(fetcher).toHaveBeenLastCalledWith("/api/catalog/commande", expect.anything());
    expect(within(panel).queryByText("Disponibilité")).not.toBeInTheDocument();
    expect(within(panel).queryByRole("heading", { name: /Déclinaisons|Correspondance/ })).not.toBeInTheDocument();
    expect(panel).toHaveTextContent("Aucune référence.");
    expect(panel).toHaveTextContent("Impact : 6 documents");
  });
  it.each([[inconnue, "n'est plus dans l'index Atlas"], [indisponible, "Atlas est indisponible"], [{ status: 500, body: {} }, "La fiche n'a pas pu être lue"]] as const)("affiche l'état de fiche HTTP %j", async (sample, message) => {
    const pending = deferred();
    const fetcher = vi.fn<Fetch>().mockResolvedValueOnce(response(liste)).mockReturnValueOnce(pending.promise);
    render(<CataloguePage fetcher={fetcher} now={now} />);
    await userEvent.click(await screen.findByRole("button", { name: "Revenu net" }));
    expect(screen.getByText("Chargement de la fiche…")).toBeInTheDocument();
    await settle(() => { pending.resolve(response(sample)); });
    expect(screen.getByRole("complementary")).toHaveTextContent(message);
  });
  it("abandonne la fiche fermée en cours de chargement", async () => {
    let reject!: (reason: Error) => void;
    const fetcher = vi.fn<Fetch>().mockResolvedValueOnce(response(liste)).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    render(<CataloguePage fetcher={fetcher} now={now} />);
    await userEvent.click(await screen.findByRole("button", { name: "Revenu net" }));
    await userEvent.click(screen.getByRole("button", { name: "Fermer la fiche" }));
    expect(fetcher.mock.calls[1]?.[1]?.signal?.aborted).toBe(true);
    await settle(() => { reject(new Error("abandon")); });
  });
  it("ne montre jamais la fiche précédente arrivée après en avoir ouvert une autre", async () => {
    const late = deferred();
    const fetcher = vi.fn<Fetch>().mockReturnValueOnce(late.promise).mockResolvedValueOnce(response(commande));
    const { rerender } = render(<DocumentPanel id="revenu_net" fetcher={fetcher} now={now} onClose={vi.fn()} />);
    rerender(<DocumentPanel id="commande" fetcher={fetcher} now={now} onClose={vi.fn()} />);
    const label = commande.body.document.entry.label;
    await screen.findByRole("heading", { name: label, level: 2 });
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    await settle(() => { late.resolve(response(revenu)); });
    expect(screen.getByRole("complementary", { name: label })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Revenu net" })).not.toBeInTheDocument();
  });
  it("rend les données optionnelles, un avertissement, un mode futur et l'impact singulier", async () => {
    const page = decodeDocumentPage(revenu.body);
    Object.assign(page.document.entry, { domain: null, owner: null, description: null, synonyms: [], version: null, availability: { state: "executable", reason: null } });
    page.document.impact = 1;
    page.document.issues = [{ path: "", node_id: null, code: "attention", severity: "warning", message: "À vérifier" }];
    const [variante] = page.document.variants;
    if (variante === undefined) throw new Error("déclinaison attendue dans l'exemple");
    page.document.variants = [{ ...variante, mode: "mode futur" }];
    const catalog = decodeCatalogPage(liste.body);
    catalog.entries = [page.document.entry];
    const fetcher = vi.fn<Fetch>().mockImplementation((url) => Promise.resolve(Response.json(url === "/api/catalog" ? catalog : page)));
    render(<CataloguePage fetcher={fetcher} now={now} />);
    const { panel } = await open();
    expect(panel).toHaveTextContent("Impact : 1 document en dépend");
    expect(panel).toHaveTextContent("mode futur");
    expect(panel).toHaveTextContent("Avertissement");
    expect(panel).toHaveTextContent("À vérifier");
    expect(panel).toHaveTextContent("Exécutable");
    expect(panel).not.toHaveTextContent("Référence non résolue");
  });
});
