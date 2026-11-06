import { vi, type Mock } from "vitest";
import type { ExplorerModel } from "../explorer/model";
import type { Fetch } from "../spaces/api";

/** Aides des tests des analyses : contrats d'exemple du serveur réel et fixtures du format. */
export const ID = "5f1d7c52-3b0e-4d36-9a54-0c7a3e1b9d20";
export const OTHER_ID = "0b9e4a77-1c3d-4e58-b2f6-7a8d9c0e1f23";
export const COMMIT = "0123456789abcdef0123456789abcdef01234567";

export interface Exemple {
  status: number;
  body: unknown;
}

const routes = import.meta.glob<Exemple>("../../../../contracts/analyses/routes/*.json", { eager: true, import: "default" });
const texts = import.meta.glob<string>("../../../../contracts/analyses/fixtures/**/*.yaml", { eager: true, import: "default", query: "?raw" });

/** Noms des exemples de `contracts/analyses/routes/`, sans extension. */
export const ROUTE_NAMES = Object.keys(routes).map((path) => /\/([^/]+)\.json$/.exec(path)?.[1] ?? "").sort();

/**
 * Un exemple du serveur. Les identifiants et empreintes y sont masqués (`<uuid>`, `<commit>`) :
 * ils sont remplacés par des valeurs fixes, le reste est repris tel quel.
 */
export function route(name: string, replacements: readonly (readonly [string, string])[] = []): Exemple {
  const found = routes[`../../../../contracts/analyses/routes/${name}.json`];
  if (found === undefined) throw new Error(`exemple ${name} absent`);
  let text = JSON.stringify(found).replaceAll("<uuid>", ID).replaceAll("<commit>", COMMIT);
  for (const [from, to] of replacements) text = text.replaceAll(from, to);
  return JSON.parse(text) as Exemple;
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

/** Réponse HTTP d'un exemple (corps absent pour 204). */
export function reply(example: Exemple): Response {
  return example.body === null ? new Response(null, { status: example.status }) : Response.json(example.body, { status: example.status });
}

type Json = Record<string, unknown>;

/** Copie de `value` où le champ `path` (points, indices) vaut `to` ; `undefined` retire le champ. */
export function changed<T>(value: T, path: string, to: unknown): T {
  const copy = structuredClone(value);
  const keys = path.split(".");
  let at: Json = copy as Json;
  for (const key of keys.slice(0, -1)) at = at[key] as Json;
  const last = keys.at(-1) ?? "";
  if (to === undefined) {
    if (Array.isArray(at)) at.splice(Number(last), 1);
    else Reflect.deleteProperty(at, last);
  } else {
    at[last] = to;
  }
  return copy;
}

const expected = import.meta.glob<{ code: string; layer: string; violations: { path: string; rule: string }[] }>("../../../../contracts/analyses/fixtures/invalid/*.expected.json", { eager: true, import: "default" });

/** Ce que le serveur répond d'une fixture invalide (`<nom>.expected.json`). */
export function expectation(name: string) {
  return expected[`../../../../contracts/analyses/fixtures/invalid/${name}.expected.json`];
}

/** Ce que dit le message du décodeur (`<fin de chemin> : <attendu> attendu`) pour chaque règle du serveur. */
const REASON: Record<string, RegExp> = {
  unknown_field: /^champs /, missing_field: /^champs /, field_not_allowed: /^champs /,
  value_not_allowed: /(?: \| |^board\.analysis\/v1$)/, bad_format: /^(?:UUID|nom de connexion|identifiant|texte conforme)/,
  out_of_bounds: /^(?:deux bornes|liste de|texte conforme)/, wrong_type: /^(?:texte|liste|objet)$/, unsupported_value: /^texte$/,
  duplicate_item: /^valeurs distinctes$/, invalid_filter: /^(?:valeur de filtre|valeurs distinctes)/,
  metric_not_in_query: /^métrique de la requête$/, group_by_not_in_query: /^dimensions de la requête$/, reserved_name: /^nom autre que share$/,
};

/**
 * La violation du serveur que le message du décodeur explique : son chemin est celui de la violation, un
 * de ses ancêtres (le décodeur s'arrête à l'objet ou à la liste) ou un de ses descendants (la valeur d'un filtre), et sa raison est celle de la règle. Un refus
 * pour une autre raison que celle de la fixture ne passe donc pas.
 */
export function explained(message: string, violations: readonly { path: string; rule: string }[]) {
  const found = /^analyse((?:\.[a-z_]+|\[\d+\])*) : (.*) attendu$/.exec(message);
  if (found === null) return undefined;
  const at = [...(found[1] ?? "").matchAll(/\.([a-z_]+)|\[(\d+)\]/g)].map((part) => part[1] ?? part[2] ?? "");
  return violations.find((violation) => {
    const target = violation.path === "" ? [] : violation.path.slice(1).split("/");
    return at.every((segment, index) => index >= target.length || target[index] === segment) && (REASON[violation.rule]?.test(found[2] ?? "") ?? false);
  });
}

/** Corps (texte JSON) du `n`-ième appel d'un faux `fetch`. */
export function bodyOf(fetcher: Mock<Fetch>, call = 0): string {
  const body = fetcher.mock.calls[call]?.[1]?.body;
  if (typeof body !== "string") throw new Error("corps attendu");
  return body;
}

/** Ce que le navigateur envoie pour créer ou réviser : le document sans les champs que le serveur pose. */
export function draftOf(document: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(document).filter(([key]) => !["api_version", "id", "owner"].includes(key)));
}

/** Racine des routes d'analyses de l'espace `finance` (celui de `contracts/espaces/espace.json`). */
export const ROOT = "/api/spaces/finance/analyses";

/**
 * Faux `fetch` de l'écran : `"METHOD url"` donne l'exemple répondu (ou une fonction qui le calcule) ; toute
 * autre demande reçoit une erreur 500, ce qui fait échouer un test qui sortirait de son scénario.
 */
export function analysesServer(routes: Record<string, Exemple | (() => Exemple)>) {
  return vi.fn<Fetch>().mockImplementation((url, init) => {
    const found = routes[`${init?.method ?? "GET"} ${url}`];
    return Promise.resolve(found === undefined ? Response.json({}, { status: 500 }) : reply(typeof found === "function" ? found() : found));
  });
}

/**
 * Catalogue de l'Explorateur des tests des analyses : les modèles `sales` et `sales_orders` des fixtures de
 * `contracts/analyses/`, avec des dimensions de chaque type (texte, nombre, booléen, date).
 */
export const CATALOG: { connections: readonly string[]; models: readonly ExplorerModel[] } = {
  connections: ["finance"],
  models: [
    {
      name: "sales", label: "Ventes", description: "Ventes",
      metrics: [{ name: "revenue", label: "Chiffre d'affaires", description: "Montant", aggregation: "sum", additivity: "additive" }],
      dimensions: [{ name: "order_month", label: "Mois", description: "Mois de commande", type: "date", is_time: true }, { name: "region", label: "Région", description: "Région", type: "string", is_time: false }],
    },
    {
      name: "sales_orders", label: "Commandes", description: "Commandes",
      metrics: [
        { name: "revenue", label: "Chiffre d'affaires", description: "Montant", aggregation: "sum", additivity: "additive" },
        { name: "orders", label: "Commandes", description: "Nombre", aggregation: "count", additivity: "additive" },
      ],
      dimensions: [
        { name: "region", label: "Région", description: "Région", type: "string", is_time: false },
        { name: "channel", label: "Canal", description: "Canal", type: "string", is_time: false },
        { name: "revenue_band", label: "Tranche", description: "Tranche", type: "number", is_time: false },
        { name: "orders", label: "Nombre de commandes", description: "Nombre", type: "number", is_time: false },
        { name: "is_active", label: "Actif", description: "Actif", type: "boolean", is_time: false },
        { name: "day", label: "Jour", description: "Jour", type: "date", is_time: true },
      ],
    },
  ],
};
