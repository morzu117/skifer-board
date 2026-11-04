import { expect, type Page } from "@playwright/test";
import espace from "../../../contracts/espaces/espace.json" with { type: "json" };
import introuvable from "../../../contracts/espaces/introuvable.json" with { type: "json" };
import liste from "../../../contracts/espaces/liste.json" with { type: "json" };
import local from "../../../contracts/identite/me-local.json" with { type: "json" };

export const titresGraphiques = [
  "CA net par région",
  "Réalisé contre budget · CA net",
  "Du CA T2 au CA T3",
  "CA net par région et par mois",
] as const;

export const themes = [
  { nom: "Skifer clair", capture: "prototype-clair.png" },
  { nom: "Skifer ardoise", capture: "prototype-ardoise.png" },
] as const;

export async function attendreGraphiques(page: Page): Promise<void> {
  await page.evaluate(async () => { await document.fonts.ready; });
  for (const titre of titresGraphiques) {
    // Les marques ECharts n'ont pas de rôle propre : seul leur conteneur est une image.
    const svg = page.getByRole("region", { name: titre, exact: true }).getByRole("img").locator("svg");
    await expect(svg).toBeVisible();
    await expect(svg.locator("path").first()).toBeAttached();
  }
}

export async function choisirTheme(page: Page, nom: string): Promise<void> {
  const groupe = page.getByRole("group", { name: "Thème", exact: true });
  await groupe.getByRole("button", { name: nom, exact: true }).click();
  await expect(groupe.getByRole("button", { pressed: true })).toHaveText(nom);
  await expect(groupe.getByRole("button", { pressed: false })).toHaveCount(1);
}

/** L'identité n'est pas servie par vite preview : exemple réel du backend, sans réseau. */
export async function simulerIdentite(page: Page, exemple: { status: number; body: unknown } = local): Promise<void> {
  await page.route("**/api/me", async (route) => {
    await route.fulfill({ status: exemple.status, json: exemple.body });
  });
}


export interface Exemple {
  status: number;
  body: unknown;
}

/** Espace « rh » de la liste, tel que le serveur le confirme : lecteur. */
export const espaceRh: Exemple = { status: 200, body: { ...espace.body, id: "rh", name: "Ressources humaines", role: "reader" } };

/**
 * Espaces simulés à partir des exemples du serveur réel (contracts/espaces). Une adresse d'espace
 * absente de la table répond comme le serveur pour un espace inconnu ou refusé : 404 space_not_found.
 * Les routes sous un espace (`/api/spaces/<id>/…`) ne sont pas servies ici.
 */
export async function simulerEspaces(page: Page, table: Readonly<Record<string, Exemple>> = {}): Promise<void> {
  const routes: Readonly<Record<string, Exemple>> = { "/api/spaces": liste, "/api/spaces/finance": espace, "/api/spaces/rh": espaceRh, ...table };
  await page.route((url) => /^\/api\/spaces(\/[^/]*)?$/.test(url.pathname), async (route) => {
    const exemple = routes[new URL(route.request().url()).pathname] ?? introuvable;
    await route.fulfill({ status: exemple.status, json: exemple.body });
  });
}

/** Chemins des lectures `/api/…` émises par la page, dans l'ordre. */
export function enregistrerLectures(page: Page): string[] {
  const chemins: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/")) chemins.push(`${url.pathname}${url.search}`);
  });
  return chemins;
}

/** Aucune lecture du catalogue hors espace : `/api/catalog…` a disparu (plan 08, E9). */
export function catalogueHorsEspace(chemins: readonly string[]): string[] {
  return chemins.filter((chemin) => chemin.startsWith("/api/catalog"));
}
