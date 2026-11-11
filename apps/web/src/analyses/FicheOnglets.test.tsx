import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { expectAccessible } from "../test/a11y";
import { decodeAnalysis, type AnalysisDocument } from "./document";
import { OngletCalculs, OngletPresentation, OngletRequete } from "./FicheOnglets";
import { route } from "./testing";

const base = decodeAnalysis((route("lire").body as { analysis: unknown }).analysis);
const withQuery = (patch: Partial<AnalysisDocument["query"]>): AnalysisDocument => ({ ...base, query: { ...base.query, ...patch } });

it("lit la requête enregistrée : connexion, modèle, métriques, dimensions et filtres", async () => {
  const { container } = render(<OngletRequete analysis={base} unresolved={[]} />);
  expect(screen.getByText("Connexion").nextElementSibling).toHaveTextContent("finance");
  expect(screen.getByText("Modèle").nextElementSibling).toHaveTextContent("sales");
  expect(screen.getByText("Métriques").nextElementSibling).toHaveTextContent("revenue");
  expect(screen.getByText("Dimensions").nextElementSibling).toHaveTextContent("region");
  expect(screen.getByText("Filtres").nextElementSibling).toHaveTextContent("region parmi Nord, Sud");
  expect(screen.getByText(/Aucun SQL n'est enregistré/)).toBeInTheDocument();
  expect(screen.queryByText("Introuvable dans le catalogue")).not.toBeInTheDocument();
  await expectAccessible(container);
});

it("dit l'absence de dimension et de filtre, et lit les valeurs scalaires et les bornes", () => {
  const { rerender } = render(<OngletRequete analysis={withQuery({ dimensions: [], filters: [] })} unresolved={[]} />);
  expect(screen.getByText("Aucune dimension.")).toBeInTheDocument();
  expect(screen.getByText("Aucun filtre d'exploration.")).toBeInTheDocument();
  rerender(<OngletRequete analysis={withQuery({ filters: [{ column: "region", operator: "between", value: [1, 9] }, { column: "actif", operator: "eq", value: true }, { column: "prix", operator: "gte", value: 2.5 }] })} unresolved={[]} />);
  expect(screen.getByText("Filtres").nextElementSibling).toHaveTextContent("region entre 1 et 9");
  expect(screen.getByText("Filtres").nextElementSibling).toHaveTextContent("actif égal à true");
  expect(screen.getByText("Filtres").nextElementSibling).toHaveTextContent("prix supérieur ou égal à 2.5");
});

it("signale à sa place chaque référence que le catalogue ne confirme pas, avec sa propre règle, sans toucher aux autres", () => {
  const analysis = withQuery({ metrics: ["revenue", "cost"], dimensions: ["region", "ville"], filters: [{ column: "region", operator: "eq", value: "Nord" }, { column: "ville", operator: "gt", value: "Lille" }] });
  render(<OngletRequete analysis={analysis} unresolved={[
    { path: "/query/connection", rule: "unknown_connection" }, { path: "/query/model", rule: "unknown_model" }, { path: "/query/metrics/1", rule: "unknown_metric" },
    { path: "/query/dimensions/1", rule: "unknown_dimension" }, { path: "/query/filters/1", rule: "filter_not_allowed" },
  ]} />);
  expect(screen.getAllByText(/introuvable dans le catalogue|Filtre non permis/i)).toHaveLength(5);
  expect(screen.getByText("Connexion").nextElementSibling).toHaveTextContent("Connexion introuvable dans le catalogue");
  expect(screen.getByText("Modèle").nextElementSibling).toHaveTextContent("Modèle introuvable dans le catalogue");
  expect(screen.getByText("cost", { selector: "li" })).toHaveTextContent("Métrique introuvable dans le catalogue");
  expect(screen.getByText("revenue", { selector: "li" })).not.toHaveTextContent("introuvable");
  expect(screen.getByText("ville", { selector: "li > .sb-mono" }).parentElement).toHaveTextContent("Filtre non permis (colonne, opérateur ou valeur)");
  expect(screen.getByText("ville", { selector: "li > .sb-mono" }).parentElement).not.toHaveTextContent("introuvable");
  expect(screen.getByText("region", { selector: "li > .sb-mono" }).parentElement).not.toHaveTextContent("Filtre non permis");
  expect(screen.getByText("ville", { selector: "li.sb-mono" })).toHaveTextContent("Dimension introuvable dans le catalogue");
});

it("un chemin qui porte deux règles les dit toutes les deux", () => {
  render(<OngletRequete analysis={base} unresolved={[{ path: "/query/filters/0", rule: "unknown_dimension" }, { path: "/query/filters/0", rule: "filter_not_allowed" }]} />);
  const filters = screen.getByText("Filtres").nextElementSibling;
  expect(filters).toHaveTextContent("Dimension introuvable dans le catalogue");
  expect(filters).toHaveTextContent("Filtre non permis (colonne, opérateur ou valeur)");
});

it("décrit les calculs contextuels dans leur ordre, avec périmètre et dénominateur", async () => {
  const analysis: AnalysisDocument = { ...base, contextual: [
    { operation: "aggregate", metric: "revenue", group_by: ["region"], scope: null },
    { operation: "aggregate", metric: "revenue", group_by: [], scope: "filtered_perimeter" },
    { operation: "share", metric: "revenue", group_by: ["region"], denominator: "loaded_result" },
    { operation: "share", metric: "revenue", group_by: [], denominator: "filtered_perimeter" },
  ] };
  const { container } = render(<OngletCalculs analysis={analysis} />);
  const items = screen.getAllByRole("listitem").map((node) => node.textContent);
  expect(items).toEqual([
    "Agrégat de revenue par region · périmètre : sélection courante",
    "Agrégat de revenue par sans regroupement · périmètre : périmètre filtré",
    "Part de revenue par region · dénominateur : résultat chargé",
    "Part de revenue par sans regroupement · dénominateur : périmètre filtré",
  ]);
  expect(screen.getByText(/dans l'ordre de la liste/)).toBeInTheDocument();
  await expectAccessible(container);
});

it("dit qu'il n'y a aucun calcul contextuel", () => {
  render(<OngletCalculs analysis={{ ...base, contextual: [] }} />);
  expect(screen.getByText("Aucun calcul contextuel.")).toBeInTheDocument();
  expect(screen.queryByRole("list")).not.toBeInTheDocument();
});

it.each([["value", "Valeur"], ["bars", "Barres"], ["line", "Ligne"], ["grouped_bars", "Barres groupées"]] as const)("la présentation %s se lit « %s » avec son nom de schéma", (chart, label) => {
  render(<OngletPresentation analysis={{ ...base, presentation: { chart } }} />);
  expect(screen.getByText("Type de graphique").nextElementSibling).toHaveTextContent(`${label} (${chart})`);
});

it("un filtre sur une colonne inconnue du modèle est dit « non permis » sans présumer de la cause", () => {
  render(<OngletRequete analysis={withQuery({ filters: [{ column: "inconnue", operator: "eq", value: "x" }] })} unresolved={[{ path: "/query/filters/0", rule: "filter_not_allowed" }]} />);
  const filters = screen.getByText("Filtres").nextElementSibling;
  expect(filters).toHaveTextContent("inconnue égal à x");
  expect(filters).toHaveTextContent("Filtre non permis (colonne, opérateur ou valeur)");
  expect(filters).not.toHaveTextContent(/introuvable|n'existe/);
});
