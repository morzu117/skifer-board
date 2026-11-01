import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import liste from "../../../../contracts/catalogue/liste.json";
import revenu from "../../../../contracts/catalogue/fiche-revenu-net.json";
import commande from "../../../../contracts/catalogue/fiche-commande.json";
import invalide from "../../../../contracts/catalogue/fiche-invalide.json";
import inconnue from "../../../../contracts/catalogue/fiche-inconnue.json";
import versions from "../../../../contracts/catalogue/versions-revenu-net.json";
import versionsConcept from "../../../../contracts/catalogue/versions-concept.json";
import historiqueIndisponible from "../../../../contracts/catalogue/versions-indisponible.json";
import ecart from "../../../../contracts/catalogue/ecart-revenu-net.json";
import identique from "../../../../contracts/catalogue/ecart-identique.json";
import versionInconnue from "../../../../contracts/catalogue/ecart-version-inconnue.json";
import ecartConcept from "../../../../contracts/catalogue/ecart-concept.json";
import irresoluble from "../../../../contracts/catalogue/ecart-irresoluble.json";
import parametreInvalide from "../../../../contracts/catalogue/ecart-parametre-invalide.json";
import indisponible from "../../../../contracts/catalogue/indisponible.json";
import { CataloguePage } from "./CataloguePage";
import { DocumentPanel } from "./DocumentPanel";
import { VersionsSection } from "./VersionsSection";
import type { Fetch } from "./api";

interface Sample {
  status: number;
  body: unknown;
}
const now = () => new Date("2026-11-01T12:30:00Z");
const response = (sample: Sample) => Response.json(sample.body, { status: sample.status });
const ECART_V4 = "/api/catalog/revenu-net/diff?base=4&other=5";
const ECART_V3 = "/api/catalog/revenu-net/diff?base=3&other=5";
/** Les exemples versionnés, par URL ; toute autre URL reçoit le 404 du vrai serveur. */
const ROUTES: Readonly<Record<string, Sample>> = {
  "/api/catalog": liste,
  "/api/catalog/revenu-net": revenu,
  "/api/catalog/commande": commande,
  "/api/catalog/invalide": invalide,
  "/api/catalog/revenu-net/versions": versions,
  "/api/catalog/commande/versions": versionsConcept,
  "/api/catalog/invalide/versions": { status: 200, body: { ...versionsConcept.body, id: "invalide", current_version: 1 } },
  [ECART_V4]: ecart,
  [ECART_V3]: irresoluble,
};
function routeur(overrides: Readonly<Record<string, Sample>> = {}) {
  const table = { ...ROUTES, ...overrides };
  return vi.fn<Fetch>().mockImplementation((url) => Promise.resolve(response(table[url] ?? inconnue)));
}
/** Réponse simulée retenue jusqu'à ce que le test la libère. */
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}
/** Résout une promesse simulée, puis laisse React appliquer les mises à jour qui en découlent. */
async function settle(resolve: () => void) {
  await act(async () => {
    resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}
/** Exemple de versions modifié sur une copie, l'exemple versionné restant intact. */
function versionsWith(change: Partial<typeof versions.body>): Sample {
  return { status: 200, body: { ...structuredClone(versions.body), ...change } };
}
const section = () => screen.getByRole("region", { name: /^Versions/ });
const items = () => within(section()).getAllByRole("listitem").filter((item) => item.parentElement?.closest("li") === null);
const compare = (version: number) => {
  const item = items().find((candidate) => candidate.textContent.startsWith(`v${String(version)}`));
  if (item === undefined) throw new Error(`version v${String(version)} absente`);
  return within(item).getByRole("button", { name: "Écart avec la v5" });
};
const signalOf = (fetcher: ReturnType<typeof vi.fn<Fetch>>, url: string) => fetcher.mock.calls.find(([called]) => called === url)?.[1]?.signal;
async function versionsKpi(fetcher = routeur()) {
  render(<VersionsSection id="revenu-net" kind="kpi" fetcher={fetcher} />);
  await screen.findByRole("heading", { name: "Versions · 3" });
  return fetcher;
}
async function ouvrirFiche(fetcher: Fetch, label = "Revenu net") {
  render(<CataloguePage fetcher={fetcher} now={now} />);
  await userEvent.click(await screen.findByRole("button", { name: label }));
  await screen.findByRole("heading", { name: label, level: 2 });
  return screen.getByRole("complementary", { name: label });
}

describe("Historique d'un KPI (plan 05, 5.3)", () => {
  it("liste les versions de la plus récente à la plus ancienne avec numéro, auteur, date, commit et message", async () => {
    const panel = await ouvrirFiche(routeur());
    const titre = await within(panel).findByRole("heading", { name: "Versions · 3", level: 3 });
    expect(titre).toBeInTheDocument();
    expect(items().map((item) => item.textContent.slice(0, 2))).toEqual(["v5", "v4", "v3"]);
    const [v5, v4, v3] = items();
    expect(v5).toHaveTextContent("v5 Courante · Revenu net v5");
    expect(v5).toHaveTextContent("Tests catalogue · 01/11/2026 21:38 UTC · commit e4f30c9");
    expect(v4).toHaveTextContent("v4 · Revenu net v4");
    expect(v4).toHaveTextContent("Tests catalogue · 01/11/2026 21:38 UTC · commit 46ab2af");
    expect(v3).toHaveTextContent("v3 · Revenu net v3");
    expect(v3).toHaveTextContent("commit 0a6d698");
    expect(within(section()).getAllByText("Courante")).toHaveLength(1);
    expect(v4).not.toHaveTextContent("Courante");
    expect(v3).not.toHaveTextContent("Courante");
    expect(section()).toHaveTextContent("Versions lues dans le clone au commit e4f30c9, le 01/11/2026 10:30 UTC.");
    expect(section()).not.toHaveTextContent("n'est pas taguée");
    expect(panel).toHaveTextContent("Index Atlas du commit d7eba96");
  });
  it("lit l'historique une fois à l'ouverture, sans demander d'écart", async () => {
    const fetcher = routeur();
    await ouvrirFiche(fetcher);
    await screen.findByRole("heading", { name: "Versions · 3" });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["/api/catalog", "/api/catalog/revenu-net", "/api/catalog/revenu-net/versions"]);
  });
  it("propose l'écart avec la v5 pour chaque version antérieure, jamais pour la dernière", async () => {
    await versionsKpi();
    const [v5, v4, v3] = items();
    expect(within(v5 as HTMLElement).queryByRole("button")).not.toBeInTheDocument();
    for (const item of [v4, v3] as HTMLElement[]) {
      const button = within(item).getByRole("button", { name: "Écart avec la v5" });
      expect(button).toHaveAttribute("aria-expanded", "false");
      expect(button).not.toHaveAttribute("aria-controls");
    }
    expect(within(section()).getAllByRole("button")).toHaveLength(2);
  });
  it("ouvre un seul écart à la fois, le lie à son panneau et le referme au second clic", async () => {
    const fetcher = await versionsKpi();
    await userEvent.click(compare(4));
    expect(compare(4)).toHaveAttribute("aria-expanded", "true");
    const controlled = compare(4).getAttribute("aria-controls");
    expect(controlled).not.toBeNull();
    const panneau = document.getElementById(controlled ?? "");
    expect(panneau).not.toBeNull();
    expect(panneau?.closest("li")).toBe(items()[1]);
    expect(fetcher).toHaveBeenLastCalledWith(ECART_V4, expect.objectContaining({ signal: expect.any(AbortSignal) as AbortSignal }));
    await within(panneau as HTMLElement).findByText(/2 écarts entre la v4 et la v5/);

    await userEvent.click(compare(3));
    expect(compare(4)).toHaveAttribute("aria-expanded", "false");
    expect(compare(4)).not.toHaveAttribute("aria-controls");
    expect(document.getElementById(controlled ?? "")).toBeNull();
    expect(compare(3)).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(compare(3).getAttribute("aria-controls") ?? "")).not.toBeNull();
    expect(fetcher).toHaveBeenLastCalledWith(ECART_V3, expect.anything());
    expect(within(section()).queryByText(/2 écarts/)).not.toBeInTheDocument();

    await userEvent.click(compare(3));
    expect(compare(3)).toHaveAttribute("aria-expanded", "false");
    expect(compare(3)).not.toHaveAttribute("aria-controls");
    expect(within(section()).queryByText(/Écart indisponible/)).not.toBeInTheDocument();
  });
  it("affiche le rapport d'Atlas : résumé par sévérité, sévérité en mot, message, champs avant et après, empreintes", async () => {
    await versionsKpi();
    await userEvent.click(compare(4));
    const resume = await screen.findByText(/écarts entre/);
    expect(resume).toHaveTextContent(/^2 écarts entre la v4 et la v5 · Critique 0 · Attention 1 · Information 1$/);
    const rapport = resume.parentElement as HTMLElement;
    const ecarts = Array.from(rapport.querySelectorAll<HTMLElement>(":scope > ul > li"));
    expect(ecarts).toHaveLength(2);
    const [cosmetique, aVerifier] = ecarts as [HTMLElement, HTMLElement];
    const badge = (item: HTMLElement) => item.querySelector(".sb-badge");
    expect(badge(cosmetique)).toHaveTextContent(/^Information$/);
    expect(badge(cosmetique)).toHaveClass("sb-badge--neutral");
    expect(cosmetique).toHaveTextContent("Filtre « Factures validées » : label modifié(s). Sans effet sur le résultat.");
    expect(within(cosmetique).getByRole("listitem")).toHaveTextContent(/^label : Factures validées → Factures émises$/);
    expect(badge(aVerifier)).toHaveTextContent(/^Attention$/);
    expect(badge(aVerifier)).toHaveClass("sb-badge--warning");
    expect(aVerifier).toHaveTextContent("Équivalence des expressions non démontrée : à vérifier.");
    expect(within(aVerifier).getByRole("listitem")).toHaveTextContent(/^expr : montant_ttc - montant_taxes - avoirs → montant_ttc - montant_taxes$/);
    expect(rapport).toHaveTextContent(
      "Empreintes Atlas : v4 sha256:atlas1:a248faeaf50b9381ef5d81e931d9e31ab40ba46d0156769b591350d2a7f2fb58 · v5 sha256:atlas1:3a3300e7570e8f000d269988e814d8a48fa26b4d497386e859d6b30fc10c44e6",
    );
  });
  it("écrit « 1 écart » au singulier et n'affiche pas de liste vide pour un écart sans champ modifié", async () => {
    const page = structuredClone(ecart.body);
    const [premier] = page.diff.differences;
    if (premier === undefined) throw new Error("écart attendu dans l'exemple");
    page.diff.differences = [{ ...premier, severity: "critical", classification: "critical", kind: "removed", other_node: null as unknown as string, changes: [], message: "Nœud retiré." }];
    page.diff.by_severity = { info: 0, warn: 0, critical: 1 };
    await versionsKpi(routeur({ [ECART_V4]: { status: 200, body: page } }));
    await userEvent.click(compare(4));
    const resume = await screen.findByText(/écart entre/);
    expect(resume).toHaveTextContent(/^1 écart entre la v4 et la v5 · Critique 1 · Attention 0 · Information 0$/);
    const rapport = resume.parentElement as HTMLElement;
    const [seul, ...autres] = within(rapport).getAllByRole("listitem");
    expect(autres).toEqual([]);
    expect(seul).toHaveTextContent(/^Critique Nœud retiré\.$/);
    expect(seul?.querySelector(".sb-badge--danger")).toHaveTextContent("Critique");
    expect(within(seul as HTMLElement).queryByRole("list")).not.toBeInTheDocument();
  });
  it("écrit les valeurs non textuelles d'un champ et l'absence d'une valeur, pour un nœud ajouté", async () => {
    const page = structuredClone(ecart.body) as unknown as { diff: { differences: { kind: string; base_node: string | null; changes: { field: string; before: unknown; after: unknown }[] }[] } };
    const [premier] = page.diff.differences;
    if (premier === undefined) throw new Error("écart attendu dans l'exemple");
    Object.assign(premier, { kind: "added", base_node: null });
    premier.changes = [{ field: "filters", before: null, after: [{ op: "eq", value: 1 }] }, { field: "limit", before: 10, after: true }];
    await versionsKpi(routeur({ [ECART_V4]: { status: 200, body: page } }));
    await userEvent.click(compare(4));
    expect(await screen.findByText("filters")).toBeInTheDocument();
    const lignes = within(section()).getAllByRole("listitem").filter((item) => item.textContent.startsWith("filters") || item.textContent.startsWith("limit"));
    expect(lignes.map((item) => item.textContent)).toEqual(['filters : absent → [{"op":"eq","value":1}]', "limit : 10 → true"]);
  });
  it("dit « Aucun écart » pour deux versions identiques, sans liste d'écarts", async () => {
    await versionsKpi(routeur({ [ECART_V4]: identique }));
    await userEvent.click(compare(4));
    const phrase = await screen.findByText("Aucun écart : la v5 et la v5 ont la même définition.");
    const rapport = phrase.parentElement as HTMLElement;
    expect(within(rapport).queryByRole("list")).not.toBeInTheDocument();
    expect(rapport).not.toHaveTextContent("Critique");
    expect(rapport).toHaveTextContent("Empreintes Atlas : v5 sha256:atlas1:3a33");
  });
});

describe("États d'un écart", () => {
  it("annonce le calcul en cours dans une région de statut", async () => {
    const pending = deferred();
    const fetcher = routeur();
    await versionsKpi(fetcher);
    fetcher.mockReturnValueOnce(pending.promise);
    await userEvent.click(compare(4));
    expect(within(section()).getByRole("status")).toHaveTextContent("Calcul de l'écart par Atlas…");
    await settle(() => { pending.resolve(response(ecart)); });
    expect(within(section()).queryByRole("status")).not.toBeInTheDocument();
    expect(section()).toHaveTextContent("2 écarts entre la v4 et la v5");
  });
  it.each<[string, Sample, string, "alert" | "status"]>([
    ["version inconnue", versionInconnue, "Écart indisponible : Version 9 de « revenu-net » introuvable.", "status"],
    ["version irrésoluble", irresoluble, "Écart indisponible : La version 3 de « revenu-net » n'est pas un document valide.", "status"],
    ["concept", ecartConcept, "Écart indisponible : Un concept n'a pas de graphe : ses versions ne se comparent pas.", "status"],
    ["historique indisponible", historiqueIndisponible, "Historique indisponible : le clone de l'espace est introuvable.", "status"],
    ["document disparu", inconnue, "La définition n'est plus dans l'index Atlas.", "status"],
    ["paramètre invalide", parametreInvalide, "L'écart n'a pas pu être lu. Réponse inattendue du serveur (HTTP 400).", "alert"],
    ["erreur serveur", { status: 500, body: { error: { code: "internal_error" } } }, "L'écart n'a pas pu être lu. Réponse inattendue du serveur (HTTP 500).", "alert"],
    ["503 du catalogue", indisponible, "L'écart n'a pas pu être lu. Réponse du serveur hors contrat : réponse.error.code", "alert"],
  ])("affiche l'état %s sans rapport", async (_label, sample, message, role) => {
    await versionsKpi(routeur({ [ECART_V4]: sample }));
    await userEvent.click(compare(4));
    const banner = await within(section()).findByRole(role);
    expect(banner).toHaveTextContent(message);
    expect(section()).not.toHaveTextContent("Empreintes Atlas");
    expect(compare(4)).toHaveAttribute("aria-expanded", "true");
  });
  it("signale un serveur qui ne répond pas", async () => {
    const fetcher = routeur();
    await versionsKpi(fetcher);
    fetcher.mockRejectedValueOnce(new TypeError("réseau"));
    await userEvent.click(compare(4));
    expect(await within(section()).findByRole("alert")).toHaveTextContent("L'écart n'a pas pu être lu. Le serveur Board ne répond pas.");
  });
});

describe("États de l'historique", () => {
  it("annonce la lecture en cours puis la liste", async () => {
    const pending = deferred();
    render(<VersionsSection id="revenu-net" kind="kpi" fetcher={() => pending.promise} />);
    expect(screen.getByRole("heading", { name: "Versions", level: 3 })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Lecture des versions dans le clone…");
    await settle(() => { pending.resolve(response(versions)); });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Versions · 3" })).toBeInTheDocument();
  });
  it("dit l'historique indisponible avec sa raison et son détail, la fiche restant affichée", async () => {
    const panel = await ouvrirFiche(routeur({ "/api/catalog/revenu-net/versions": historiqueIndisponible }));
    const banner = await within(panel).findByText(/Historique indisponible/);
    expect(banner.closest("[role=status]")).toHaveTextContent(
      "Historique indisponible : le clone de l'espace est introuvable. Les versions ne sont lues que dans un clone relu.Le clone de l'espace Atlas est introuvable à l'emplacement configuré.",
    );
    expect(within(panel).getByRole("heading", { name: "Versions", level: 3 })).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: /Écart avec/ })).not.toBeInTheDocument();
    expect(panel).not.toHaveTextContent("Versions lues dans le clone");
    for (const text of [revenu.body.document.entry.description, revenu.body.document.fingerprint, "Déclinaisons · 2", "Index Atlas du commit d7eba96"]) {
      expect(panel).toHaveTextContent(text);
    }
  });
  it.each<[string, Sample | Error, string, "alert" | "status"]>([
    ["document disparu", inconnue, "La définition n'est plus dans l'index Atlas : son historique n'est pas lisible.", "status"],
    ["erreur serveur", { status: 500, body: {} }, "L'historique n'a pas pu être lu. Réponse inattendue du serveur (HTTP 500).", "alert"],
    ["corps hors contrat", { status: 200, body: { ...versions.body, versions: null } }, "L'historique n'a pas pu être lu. Réponse du serveur hors contrat : versions.versions : liste attendu.", "alert"],
    ["503 du catalogue", indisponible, "L'historique n'a pas pu être lu. Réponse du serveur hors contrat", "alert"],
    ["réseau", new TypeError("réseau"), "L'historique n'a pas pu être lu. Le serveur Board ne répond pas.", "alert"],
  ])("affiche l'état %s", async (_label, sample, message, role) => {
    const fetcher = sample instanceof Error ? vi.fn<Fetch>().mockRejectedValue(sample) : vi.fn<Fetch>().mockResolvedValue(response(sample));
    render(<VersionsSection id="revenu-net" kind="kpi" fetcher={fetcher} />);
    await waitFor(() => { expect(screen.getByRole(role)).toHaveTextContent(message); });
    expect(screen.getByRole("heading", { name: "Versions", level: 3 })).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});

describe("Version courante et versions taguées (plan 05, V3)", () => {
  it("dit la version courante non taguée d'un KPI et ne propose aucun écart avec elle", async () => {
    render(<VersionsSection id="revenu-net" kind="kpi" fetcher={routeur({ "/api/catalog/revenu-net/versions": versionsWith({ current_version: 6 }) })} />);
    await screen.findByRole("heading", { name: "Versions · 3" });
    expect(section()).toHaveTextContent("La version courante v6 n'est pas taguée dans Atlas : aucun écart n'est proposé avec elle.");
    expect(within(section()).queryByText("Courante")).not.toBeInTheDocument();
    expect(within(section()).queryByRole("button", { name: /v6/ })).not.toBeInTheDocument();
    expect(within(section()).getAllByRole("button", { name: "Écart avec la v5" })).toHaveLength(2);
  });
  it("dit la version courante non taguée d'un concept sans parler d'écart et ne propose aucun écart", async () => {
    const fetcher = routeur({ "/api/catalog/commande/versions": versionsWith({ id: "commande", current_version: 6 }) });
    render(<VersionsSection id="commande" kind="concept" fetcher={fetcher} />);
    await screen.findByRole("heading", { name: "Versions · 3" });
    expect(section()).toHaveTextContent("La version courante v6 n'est pas taguée dans Atlas.");
    expect(section()).not.toHaveTextContent("aucun écart");
    expect(within(section()).queryByRole("button")).not.toBeInTheDocument();
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["/api/catalog/commande/versions"]);
  });
  it("signale la version courante d'un concept tagué sans proposer d'écart", async () => {
    render(<VersionsSection id="commande" kind="concept" fetcher={routeur({ "/api/catalog/commande/versions": versionsWith({ id: "commande" }) })} />);
    await screen.findByRole("heading", { name: "Versions · 3" });
    expect(items()[0]).toHaveTextContent("v5 Courante");
    expect(within(section()).queryByRole("button")).not.toBeInTheDocument();
  });
  it("dit qu'aucune version n'est taguée", async () => {
    render(<VersionsSection id="commande" kind="concept" fetcher={routeur()} />);
    await screen.findByRole("heading", { name: "Versions · 0" });
    expect(section()).toHaveTextContent("Aucune version taguée dans Atlas.");
    expect(section()).toHaveTextContent("La version courante v5 n'est pas taguée dans Atlas.");
    expect(within(section()).queryByRole("list")).not.toBeInTheDocument();
    expect(section()).toHaveTextContent("Versions lues dans le clone au commit e4f30c9");
  });
  it("ne dit rien d'une version courante absente", async () => {
    render(<VersionsSection id="revenu-net" kind="kpi" fetcher={routeur({ "/api/catalog/revenu-net/versions": versionsWith({ current_version: null as unknown as number }) })} />);
    await screen.findByRole("heading", { name: "Versions · 3" });
    expect(section()).not.toHaveTextContent("n'est pas taguée");
    expect(within(section()).queryByText("Courante")).not.toBeInTheDocument();
  });
  it("ne propose aucun écart pour une seule version taguée", async () => {
    const [, , seule] = versions.body.versions;
    render(<VersionsSection id="revenu-net" kind="kpi" fetcher={routeur({ "/api/catalog/revenu-net/versions": versionsWith({ versions: [seule as (typeof versions.body.versions)[number]] }) })} />);
    await screen.findByRole("heading", { name: "Versions · 1" });
    expect(within(section()).queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("Abandon des lectures dépassées", () => {
  it("abandonne l'historique d'une fiche remplacée et n'affiche jamais sa réponse tardive", async () => {
    const late = deferred(); const current = deferred();
    const fetcher = vi.fn<Fetch>().mockReturnValueOnce(late.promise).mockReturnValueOnce(current.promise);
    const { rerender } = render(<VersionsSection id="revenu-net" kind="kpi" fetcher={fetcher} />);
    rerender(<VersionsSection id="commande" kind="concept" fetcher={fetcher} />);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["/api/catalog/revenu-net/versions", "/api/catalog/commande/versions"]);
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(fetcher.mock.calls[1]?.[1]?.signal?.aborted).toBe(false);
    await settle(() => { late.resolve(response(versions)); });
    expect(screen.getByRole("status")).toHaveTextContent("Lecture des versions");
    expect(screen.queryByText(/Revenu net v/)).not.toBeInTheDocument();
    await settle(() => { current.resolve(response(versionsConcept)); });
    expect(screen.getByRole("heading", { name: "Versions · 0" })).toBeInTheDocument();
    expect(screen.queryByText(/Revenu net v/)).not.toBeInTheDocument();
  });
  it("ignore une réponse tardive même si elle revient au même identifiant", async () => {
    const first = deferred(); const second = deferred(); const third = deferred();
    const fetcher = vi.fn<Fetch>().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
    const { rerender } = render(<VersionsSection id="revenu-net" kind="kpi" fetcher={fetcher} />);
    rerender(<VersionsSection id="commande" kind="concept" fetcher={fetcher} />);
    rerender(<VersionsSection id="revenu-net" kind="kpi" fetcher={fetcher} />);
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(fetcher.mock.calls[1]?.[1]?.signal?.aborted).toBe(true);
    await settle(() => { first.resolve(response(versionsWith({ current_version: 6 }))); });
    expect(screen.getByRole("status")).toHaveTextContent("Lecture des versions");
    await settle(() => { third.resolve(response(versions)); });
    expect(screen.getByRole("heading", { name: "Versions · 3" })).toBeInTheDocument();
    expect(screen.queryByText(/n'est pas taguée/)).not.toBeInTheDocument();
  });
  it("abandonne l'écart en cours quand la fiche change et n'affiche jamais sa réponse tardive", async () => {
    const pending = deferred();
    const fetcher = routeur();
    const { rerender } = render(<VersionsSection id="revenu-net" kind="kpi" fetcher={fetcher} />);
    await screen.findByRole("heading", { name: "Versions · 3" });
    fetcher.mockReturnValueOnce(pending.promise);
    await userEvent.click(compare(4));
    rerender(<VersionsSection id="commande" kind="concept" fetcher={fetcher} />);
    expect(signalOf(fetcher, ECART_V4)?.aborted).toBe(true);
    await screen.findByRole("heading", { name: "Versions · 0" });
    await settle(() => { pending.resolve(response(ecart)); });
    expect(screen.queryByText(/écarts entre/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Calcul de l'écart/)).not.toBeInTheDocument();
  });
  it("abandonne l'écart d'une autre version et n'affiche jamais sa réponse tardive, même au retour sur cette version", async () => {
    const first = deferred(); const second = deferred(); const third = deferred();
    const fetcher = routeur();
    await versionsKpi(fetcher);
    fetcher.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
    await userEvent.click(compare(4));
    await userEvent.click(compare(3));
    expect(fetcher.mock.calls.at(-2)?.[1]?.signal?.aborted).toBe(true);
    expect(fetcher.mock.calls.at(-1)?.[1]?.signal?.aborted).toBe(false);
    await userEvent.click(compare(4));
    expect(fetcher.mock.calls.at(-2)?.[1]?.signal?.aborted).toBe(true);
    await settle(() => { first.resolve(response(ecart)); second.resolve(response(irresoluble)); });
    expect(within(section()).getByRole("status")).toHaveTextContent("Calcul de l'écart par Atlas…");
    expect(section()).not.toHaveTextContent("2 écarts");
    expect(section()).not.toHaveTextContent("Écart indisponible");
    await settle(() => { third.resolve(response(identique)); });
    expect(section()).toHaveTextContent("Aucun écart : la v5 et la v5 ont la même définition.");
    expect(section()).not.toHaveTextContent("2 écarts");
  });
  it("abandonne l'écart refermé", async () => {
    const pending = deferred();
    const fetcher = routeur();
    await versionsKpi(fetcher);
    fetcher.mockReturnValueOnce(pending.promise);
    await userEvent.click(compare(4));
    await userEvent.click(compare(4));
    expect(signalOf(fetcher, ECART_V4)?.aborted).toBe(true);
    await settle(() => { pending.resolve(response(ecart)); });
    expect(section()).not.toHaveTextContent("écarts entre");
  });
  it("abandonne l'historique et l'écart au démontage, sans erreur sur la réponse rejetée", async () => {
    let reject!: (reason: Error) => void;
    const fetcher = vi.fn<Fetch>().mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    const { unmount } = render(<VersionsSection id="revenu-net" kind="kpi" fetcher={fetcher} />);
    unmount();
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    await settle(() => { reject(new DOMException("Abandonné", "AbortError")); });
  });
  // Défaut corrigé en 5.3 : l'écart ouvert survivait au changement d'identifiant et était demandé sans action
  // de la personne (plan 05, V4 ; §5). Trouvé par l'agent de test.
  it("ne demande aucun écart à la lecture d'une autre fiche, même si un écart était ouvert", async () => {
    const autre = versionsWith({ id: "marge-brute" });
    const fetcher = routeur({ "/api/catalog/marge-brute/versions": autre, "/api/catalog/marge-brute/diff?base=4&other=5": ecart });
    const { rerender } = render(<VersionsSection id="revenu-net" kind="kpi" fetcher={fetcher} />);
    await screen.findByRole("heading", { name: "Versions · 3" });
    await userEvent.click(compare(4));
    await screen.findByText(/2 écarts/);
    rerender(<VersionsSection id="marge-brute" kind="kpi" fetcher={fetcher} />);
    await waitFor(() => { expect(fetcher).toHaveBeenCalledWith("/api/catalog/marge-brute/versions", expect.anything()); });
    await screen.findByRole("heading", { name: "Versions · 3" });
    await settle(() => undefined);
    expect(fetcher).not.toHaveBeenCalledWith("/api/catalog/marge-brute/diff?base=4&other=5", expect.anything());
    expect(compare(4)).toHaveAttribute("aria-expanded", "false");
  });
});

describe("Fiche et historique dans le catalogue", () => {
  it("abandonne l'historique quand la fiche est fermée pendant sa lecture", async () => {
    const pending = deferred();
    const fetcher = routeur();
    fetcher.mockImplementation((url) => url.endsWith("/versions") ? pending.promise : Promise.resolve(response(ROUTES[url] ?? inconnue)));
    const panel = await ouvrirFiche(fetcher);
    expect(within(panel).getByRole("status")).toHaveTextContent("Lecture des versions dans le clone…");
    await userEvent.click(within(panel).getByRole("button", { name: "Fermer la fiche" }));
    expect(signalOf(fetcher, "/api/catalog/revenu-net/versions")?.aborted).toBe(true);
    await settle(() => { pending.resolve(response(versions)); });
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(screen.queryByText(/Versions ·/)).not.toBeInTheDocument();
  });
  it("abandonne l'historique quand une autre fiche est ouverte et n'en affiche jamais la réponse tardive", async () => {
    const pending = deferred();
    const fetcher = routeur();
    fetcher.mockImplementation((url) => url === "/api/catalog/revenu-net/versions" ? pending.promise : Promise.resolve(response(ROUTES[url] ?? inconnue)));
    await ouvrirFiche(fetcher);
    await userEvent.click(screen.getByRole("button", { name: "Commande" }));
    const panel = await screen.findByRole("complementary", { name: "Commande" });
    expect(signalOf(fetcher, "/api/catalog/revenu-net/versions")?.aborted).toBe(true);
    await within(panel).findByRole("heading", { name: "Versions · 0" });
    await settle(() => { pending.resolve(response(versions)); });
    expect(panel).not.toHaveTextContent("Revenu net v");
    expect(within(panel).queryByRole("button", { name: /Écart avec/ })).not.toBeInTheDocument();
  });
  it("abandonne l'écart quand une autre fiche est ouverte", async () => {
    const pending = deferred();
    const fetcher = routeur();
    fetcher.mockImplementation((url) => url === ECART_V4 ? pending.promise : Promise.resolve(response(ROUTES[url] ?? inconnue)));
    await ouvrirFiche(fetcher);
    await screen.findByRole("heading", { name: "Versions · 3" });
    await userEvent.click(compare(4));
    await userEvent.click(screen.getByRole("button", { name: "Commande" }));
    const panel = await screen.findByRole("complementary", { name: "Commande" });
    expect(signalOf(fetcher, ECART_V4)?.aborted).toBe(true);
    await settle(() => { pending.resolve(response(ecart)); });
    expect(panel).not.toHaveTextContent("écarts entre");
  });
  it("abandonne l'écart quand la fiche est fermée", async () => {
    const pending = deferred();
    const fetcher = routeur();
    fetcher.mockImplementation((url) => url === ECART_V4 ? pending.promise : Promise.resolve(response(ROUTES[url] ?? inconnue)));
    const panel = await ouvrirFiche(fetcher);
    await screen.findByRole("heading", { name: "Versions · 3" });
    await userEvent.click(compare(4));
    await userEvent.click(within(panel).getByRole("button", { name: "Fermer la fiche" }));
    expect(signalOf(fetcher, ECART_V4)?.aborted).toBe(true);
    await settle(() => { pending.resolve(response(ecart)); });
    expect(screen.queryByText(/écarts entre/)).not.toBeInTheDocument();
  });
  it("ne propose aucun écart dans la fiche d'un concept et dit son empreinte sans objet", async () => {
    const fetcher = routeur({ "/api/catalog/commande/versions": versionsWith({ id: "commande" }) });
    const panel = await ouvrirFiche(fetcher, "Commande");
    await within(panel).findByRole("heading", { name: "Versions · 3" });
    expect(within(panel).queryByRole("button", { name: /Écart avec/ })).not.toBeInTheDocument();
    expect(panel).toHaveTextContent("Sans objet : un concept n'a pas de graphe.");
    expect(panel).not.toHaveTextContent("Non calculée");
    expect(fetcher.mock.calls.some(([url]) => url.includes("/diff"))).toBe(false);
  });
  it("dit l'empreinte non calculée d'un KPI invalide, pas « sans objet »", async () => {
    const panel = await ouvrirFiche(routeur(), "Invalide");
    await within(panel).findByRole("heading", { name: "Versions · 0" });
    expect(panel).toHaveTextContent("Non calculée : définition non valide.");
    expect(panel).not.toHaveTextContent("Sans objet");
    expect(panel).toHaveTextContent("La version courante v1 n'est pas taguée dans Atlas : aucun écart n'est proposé avec elle.");
  });
  // Défaut corrigé en 5.3 : DocumentPanel montait l'historique du nouvel identifiant sous la fiche précédente,
  // avec le type de l'ancienne (plan 05, V4). Trouvé par l'agent de test.
  it("n'affiche jamais l'historique d'une autre définition sous la fiche affichée", async () => {
    const pending = deferred();
    const historique = versionsWith({ id: "commande", versions: versions.body.versions.map((version) => ({ ...version, message: `Commande v${String(version.version)}` })) });
    const table: Readonly<Record<string, Sample>> = { ...ROUTES, "/api/catalog/commande/versions": historique };
    const fetcher = vi.fn<Fetch>().mockImplementation((url) => url === "/api/catalog/commande" ? pending.promise : Promise.resolve(response(table[url] ?? inconnue)));
    const { rerender } = render(<DocumentPanel id="revenu-net" fetcher={fetcher} now={now} onClose={vi.fn()} />);
    await screen.findByRole("heading", { name: "Versions · 3" });
    rerender(<DocumentPanel id="commande" fetcher={fetcher} now={now} onClose={vi.fn()} />);
    await settle(() => undefined);
    // Pendant la lecture de la nouvelle fiche, rien de l'ancienne ni historique de la nouvelle.
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("commande");
    expect(screen.getByRole("status")).toHaveTextContent("Chargement de la fiche");
    expect(screen.queryByRole("heading", { name: /^Versions/ })).toBeNull();
    expect(fetcher).not.toHaveBeenCalledWith("/api/catalog/commande/versions", expect.anything());
    // La fiche du concept arrivée, son historique s'affiche sans écart proposé.
    await settle(() => { pending.resolve(response(commande)); });
    await screen.findByText(/Commande v5/);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Commande");
    expect(screen.queryByRole("button", { name: /Écart avec/ })).toBeNull();
  });
});
