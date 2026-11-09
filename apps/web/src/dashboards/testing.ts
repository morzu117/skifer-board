import { ID, COMMIT, analysesServer, bodyOf, changed, draftOf, reply, type Exemple } from "../analyses/testing";

/** Aides des tests des dashboards : exemples du serveur réel, fixtures du format et faux serveur. */
export { ID, COMMIT, bodyOf, changed, draftOf, reply, type Exemple };
export const OTHER_ID = "0b9e4a77-1c3d-4e58-b2f6-7a8d9c0e1f23";

/** Racine des routes de dashboards de l'espace `finance` (celui de `contracts/espaces/espace.json`). */
export const ROOT = "/api/spaces/finance/dashboards";

/** Faux `fetch` : `"METHOD url"` donne l'exemple répondu ; toute autre demande reçoit une erreur 500. */
export const dashboardsServer = analysesServer;

const routes = import.meta.glob<Exemple>("../../../../contracts/dashboards/routes/*.json", { eager: true, import: "default" });
const texts = import.meta.glob<string>("../../../../contracts/dashboards/fixtures/**/*.yaml", { eager: true, import: "default", query: "?raw" });
const expected = import.meta.glob<{ code: string; layer: string; violations: { path: string; rule: string }[] }>("../../../../contracts/dashboards/fixtures/invalid/*.expected.json", { eager: true, import: "default" });

/** Noms des exemples de `contracts/dashboards/routes/`, sans extension. */
export const ROUTE_NAMES = Object.keys(routes).map((path) => /\/([^/]+)\.json$/.exec(path)?.[1] ?? "").sort();

type Json = Record<string, unknown>;

/** Identifiants des composants exécutables (visuels et KPI) d'une mise en page, dans l'ordre du document. */
function executableIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(executableIds);
  if (typeof value !== "object" || value === null) return [];
  const found = value as Json;
  const own = found.type === "analysis" || found.type === "kpi" ? [found.id as string] : [];
  return [...own, ...Object.values(found).flatMap(executableIds)];
}

/** Remplace chaque `<uuid>` par un identifiant propre (les masques de l'exemple ne disent pas lesquels sont les mêmes). */
function unmask(value: unknown, next: () => string): unknown {
  if (value === "<uuid>") return next();
  if (value === "<commit>") return COMMIT;
  if (Array.isArray(value)) return value.map((item) => unmask(item, next));
  if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unmask(item, next)]));
  return value;
}

/**
 * Un exemple du serveur. Les exemples masquent tous les identifiants (`<uuid>`) et empreintes (`<commit>`) : chaque
 * `<uuid>` reçoit un identifiant distinct, puis les liens que le serveur garantit sont rétablis (ceux du scénario de
 * `test_routes_dashboards_contrats.py`) : le dashboard est `ID`, chaque tuile porte l'identifiant du composant exécutable de
 * même rang, et un filtre cible le dernier composant exécutable.
 */
export function route(name: string): Exemple {
  const found = routes[`../../../../contracts/dashboards/routes/${name}.json`];
  if (found === undefined) throw new Error(`exemple ${name} absent`);
  let counter = 0;
  const copy = unmask(found, () => `00000000-0000-4000-8000-${(counter += 1).toString(16).padStart(12, "0")}`) as { status: number; body: Json | null };
  const body = copy.body;
  if (body !== null && typeof body.id === "string") body.id = ID;
  const document = body?.dashboard as Json | undefined;
  if (body !== null && document !== undefined) {
    document.id = ID;
    const pinned = executableIds(document.layout);
    body.components = (body.components as Json[]).map((tile, index) => ({ ...tile, id: pinned[index] }));
    for (const one of document.filters as Json[]) one.targets = [pinned.at(-1)];
  }
  return copy;
}

export interface Fixture {
  name: string;
  text: string;
}

/** Fixtures YAML du dossier `valid`, `invalid` ou `equivalent`. */
export function fixtures(folder: "valid" | "invalid" | "equivalent"): Fixture[] {
  return Object.entries(texts)
    .filter(([path]) => path.includes(`/fixtures/${folder}/`))
    .map(([path, text]) => ({ name: /\/([^/]+)\.yaml$/.exec(path)?.[1] ?? "", text }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Ce que le serveur répond d'une fixture invalide (`<nom>.expected.json`). */
export function expectation(name: string) {
  return expected[`../../../../contracts/dashboards/fixtures/invalid/${name}.expected.json`];
}

/** Noms des verdicts attendus, sans extension : chacun doit avoir sa fixture. */
export const EXPECTED_NAMES = Object.keys(expected).map((path) => /\/([^/]+)\.expected\.json$/.exec(path)?.[1] ?? "").sort();

/** Ce que dit le message du décodeur (`<fin de chemin> : <attendu> attendu`) pour chaque règle du serveur. */
const REASON: Record<string, RegExp> = {
  unknown_field: /^champs /, missing_field: /^champs /,
  value_not_allowed: /(?: \| |^board\.dashboard\/v1$|^true$)/,
  bad_format: /^(?:UUID|identifiant|texte conforme)/,
  out_of_bounds: /^(?:liste de|entier de|nombre de|texte conforme|au plus)/,
  wrong_type: /^(?:texte|liste|objet|entier|nombre|booléen|texte, nombre ou booléen)$/,
  duplicate_item: /^valeurs distinctes$/,
  invalid_filter: /^(?:valeur de filtre|valeurs distinctes|deux bornes|bornes)/,
  duplicate_id: /^identifiant unique$/,
  container_not_alone: /^conteneur seul/,
  row_overflow: /^largeurs de colonnes/,
  too_deep: /^3 niveaux de rangées/,
  filter_without_target: /^au moins une cible$/,
  unknown_target: /^composant du document$/,
  target_not_executable: /^composant exécutable/,
  default_not_allowed: /^valeur par défaut parmi/,
};

/**
 * La violation du serveur que le message du décodeur explique : son chemin est celui de la violation, un de ses
 * ancêtres (le décodeur s'arrête à l'objet ou à la liste) ou un de ses descendants (la valeur d'un filtre), et sa
 * raison est celle de la règle. Un refus pour une autre raison que celle de la fixture ne passe donc pas.
 */
export function explained(message: string, violations: readonly { path: string; rule: string }[]) {
  const found = /^dashboard((?:\.[a-z_]+|\[\d+\])*) : (.*) attendu$/.exec(message);
  if (found === null) return undefined;
  const at = [...(found[1] ?? "").matchAll(/\.([a-z_]+)|\[(\d+)\]/g)].map((part) => part[1] ?? part[2] ?? "");
  return violations.find((violation) => {
    const target = violation.path === "" ? [] : violation.path.slice(1).split("/");
    return at.every((segment, index) => index >= target.length || target[index] === segment) && (REASON[violation.rule]?.test(found[2] ?? "") ?? false);
  });
}
