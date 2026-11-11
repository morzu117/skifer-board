import { render } from "@testing-library/react";
import { tableFromArrays, tableToIPC } from "apache-arrow";
import { createElement } from "react";
import { vi, type Mock } from "vitest";

import refusedExample from "../../../../../contracts/analyses/routes/derniere-execution-refusee.json";
import executionExample from "../../../../../contracts/executions/contextuel-detail.json";
import type { Fetch } from "../../spaces/api";
import espace from "../../../../../contracts/espaces/espace.json";
import { decodeSpace } from "../../spaces/model";
import { DashboardEditorPage } from "../DashboardEditorPage";
import { decodeDashboardDraft, executables, type DashboardDraft } from "../document";
import { CATALOG, ID, route as analysisRoute } from "../../analyses/testing";
import { route as dashboardRoute } from "../testing";

/** Aides des tests de l'éditeur de dashboards (plan 19, 19.5a) : un document, des analyses épinglées et un faux serveur. */
export const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

/** Identifiants du document d'exemple. */
export const N = {
  s1: uuid(1), r1: uuid(2), c1: uuid(3), c2: uuid(4), visual: uuid(5), text: uuid(6), kpi: uuid(7), rule: uuid(8), box: uuid(9),
  r2: uuid(10), c3: uuid(11), c4: uuid(14), s2: uuid(12), filter: uuid(13), bars: uuid(21), total: uuid(22),
} as const;
export const ROOT = "/api/spaces/finance";

/**
 * Le document d'exemple : une section « Ventes » avec une rangée de trois colonnes (un visuel et un texte ; un KPI et un séparateur ;
 * un conteneur qui porte une rangée et une colonne vides), une seconde section sans titre, et un filtre sur le visuel.
 */
export function sampleDraft(): DashboardDraft {
  return decodeDashboardDraft({
    name: "Pilotage",
    description: "Suivi.",
    visibility: "shared",
    defaults: {},
    filters: [{ id: N.filter, label: "Région", dimension: "region", operator: "eq", targets: [N.visual] }],
    layout: { sections: [
      { id: N.s1, title: "Ventes", rows: [{ id: N.r1, columns: [
        { id: N.c1, span: 4, children: [
          { id: N.visual, type: "analysis", reference: { analysis_id: N.bars, revision: 1 }, presentation: {} },
          { id: N.text, type: "text", blocks: [{ type: "paragraph", content: [{ text: "Bonjour" }] }] },
        ] },
        { id: N.c2, span: 4, children: [
          { id: N.kpi, type: "kpi", reference: { analysis_id: N.total, revision: 1 }, presentation: {} },
          { id: N.rule, type: "separator" },
        ] },
        { id: N.c3, span: 4, children: [
          { id: N.box, type: "container", rows: [{ id: N.r2, columns: [{ id: N.c4, span: 12, children: [] }] }] },
        ] },
      ] }] },
      { id: N.s2, rows: [] },
    ] },
  });
}

export type TileInfo = { id: string; state: "ready" } | { id: string; state: "unverified" } | { id: string; state: "unavailable"; reason: string };

/** Corps de la lecture d'un dashboard : l'exemple `lire` du serveur, avec le document, les tuiles et les droits voulus. */
export function dashboardBody(draft: DashboardDraft, options: { revise?: boolean; tiles?: readonly TileInfo[]; state?: string; revision?: number } = {}) {
  const body = structuredClone(dashboardRoute("lire").body) as Record<string, unknown>;
  const revision = options.revision ?? 1;
  return {
    ...body,
    revision,
    current_revision: revision,
    state: options.state ?? "ready",
    components: options.tiles ?? [{ id: N.visual, state: "ready" }, { id: N.kpi, state: "ready" }],
    permissions: { owner: options.revise ?? true, revise: options.revise ?? true, delete: options.revise ?? true, duplicate: options.revise ?? true },
    dashboard: { api_version: "board.dashboard/v1", id: ID, owner: { issuer: "https://id.example.invalid", subject: "cora" }, ...structuredClone(draft) },
  };
}

type Query = { connection: string; model: string; metrics: string[]; dimensions: string[]; filters: { column: string; operator: string; value: unknown }[] };
export interface AnalysisSpec {
  name: string;
  query: Query;
  chart: string;
  /** Dernière révision connue (par défaut 1, celle qui est épinglée). */
  current?: number;
  state?: string;
  visibility?: "personal" | "shared";
}

export const ANALYSES: Readonly<Record<string, AnalysisSpec>> = {
  [N.bars]: { name: "Chiffre d'affaires par région", chart: "bars", query: { connection: "finance", model: "sales", metrics: ["revenue"], dimensions: ["region"], filters: [{ column: "region", operator: "in", value: ["Nord", "Sud"] }] } },
  [N.total]: { name: "Total", chart: "value", query: { connection: "finance", model: "sales", metrics: ["revenue"], dimensions: [], filters: [] } },
};

/** Lecture d'une révision d'analyse : l'exemple `lire` des analyses, avec l'identifiant, le nom, la requête et le type voulus. */
export function analysisBody(id: string, spec: AnalysisSpec, revision = 1) {
  const body = analysisRoute("lire", [[ID, id]]).body as { analysis: Record<string, unknown> } & Record<string, unknown>;
  return {
    ...body, revision, current_revision: spec.current ?? revision, state: spec.state ?? "ready",
    ...(spec.visibility === "personal" ? { permissions: { owner: true, revise: true, delete: true, duplicate: true } } : {}),
    analysis: { ...body.analysis, name: spec.name, visibility: spec.visibility ?? "shared", query: spec.query, contextual: [], presentation: { chart: spec.chart } },
  };
}

export const MODELS = CATALOG.models;

const BYTES_OF = (query: { metrics: string[]; dimensions: string[] }): Uint8Array => {
  const columns: Record<string, string[] | number[]> = {};
  const labels = query.dimensions.length === 0 ? [null] : ["Nord", "Sud"];
  for (const dimension of query.dimensions) columns[dimension] = labels.map(String);
  for (const metric of query.metrics) columns[metric] = labels.map((_, index) => 12 - index * 7);
  return tableToIPC(tableFromArrays(columns), "stream");
};

/** Ce que le faux serveur sait faire d'une exécution demandée : un succès (défaut), un refus du moteur, une table vide, une panne. */
export type Outcome = "succeeded" | "deny" | "require_human" | "empty" | "failed" | "no_proof" | "wide";

export interface ServerOptions {
  draft?: DashboardDraft;
  revise?: boolean;
  tiles?: readonly TileInfo[];
  state?: string;
  analyses?: Readonly<Record<string, AnalysisSpec>>;
  /** Issue des exécutions, par identifiant d'analyse ; `succeeded` sinon. */
  outcomes?: Readonly<Record<string, Outcome>>;
  /** Issue de la Nième soumission (à partir de 0) d'une analyse, avant `outcomes` : des réponses contradictoires pour une même requête. */
  sequence?: Readonly<Record<string, readonly Outcome[]>>;
  /** Réponses imposées, par `"METHOD url"`. */
  overrides?: Readonly<Record<string, Response | ((init: RequestInit | undefined) => Response | Promise<Response>)>>;
}

export interface EditorServer {
  fetcher: Mock<Fetch>;
  /** Corps des exécutions soumises, dans l'ordre. */
  submitted: () => Query[];
  /** Corps des enregistrements. */
  saved: () => Record<string, unknown>[];
}

const hash = (text: string): string => {
  let sum = 7;
  for (let index = 0; index < text.length; index += 1) sum = (sum * 31 + text.charCodeAt(index)) % 1_000_000_007;
  return `sha256:v1:${sum.toString(16).padStart(64, "0")}`;
};

/** Faux `fetch` d'un éditeur : lecture et enregistrement du dashboard, analyses épinglées, catalogue et exécutions ; toute autre demande reçoit une erreur 500. */
export function editorServer(options: ServerOptions = {}): EditorServer {
  const draft = options.draft ?? sampleDraft();
  const analyses = options.analyses ?? ANALYSES;
  const posts: Query[] = [];
  const bodies: Record<string, unknown>[] = [];
  const queries = new Map<string, Uint8Array>();
  const counts = new Map<string, number>();
  let revision = 1;
  const execution = (id: string, query: Query, outcome: Outcome, bytes: Uint8Array) => {
    const base = executionExample.body;
    // Un refus du moteur n'a ni résultat, ni preuve, ni exécution du connecteur (exemple du serveur réel).
    if (outcome === "deny" || outcome === "require_human") return { ...refusedExample.body.execution, id, connection: query.connection, error_code: outcome };
    const proof = { ...base.evidence, sql_hash: hash(JSON.stringify(query)), evidence_id: `preuve-${id.slice(-4)}`, model_keys: [query.model], execution_status: outcome === "failed" ? "failed" : "succeeded" };
    return {
      ...base, id, state: outcome === "failed" ? "failed" : "succeeded", error_code: outcome === "failed" ? "execution_failed" : null,
      rows: outcome === "empty" ? 0 : query.dimensions.length === 0 ? 1 : 2, size: bytes.byteLength, can_cancel: false,
      evidence: outcome === "no_proof" ? null : proof, connection: query.connection,
    };
  };
  const fetcher = vi.fn<Fetch>().mockImplementation(async (url, init) => {
    const method = init?.method ?? "GET";
    const key = `${method} ${url}`;
    const forced = options.overrides?.[key];
    if (forced !== undefined) return (typeof forced === "function" ? await forced(init) : forced).clone();
    if (key === `GET ${ROOT}/dashboards/${ID}`) return Response.json(dashboardBody(draft, { ...(options.revise === undefined ? {} : { revise: options.revise }), ...(options.tiles === undefined ? {} : { tiles: options.tiles }), ...(options.state === undefined ? {} : { state: options.state }), revision }));
    if (key === `POST ${ROOT}/dashboards/${ID}/revisions`) {
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      bodies.push(body);
      const { expected_revision: expected, ...sent } = body;
      revision = (expected as number) + 1;
      const saved = decodeDashboardDraft(sent);
      return Response.json(dashboardBody(saved, { tiles: executables(saved).map((item) => ({ id: item.id, state: "ready" as const })), revision }), { status: 201 });
    }
    if (key === `GET ${ROOT}/analyses`) {
      const example = analysisRoute("lister").body as { analyses: Record<string, unknown>[] };
      return Response.json({ analyses: Object.entries(analyses).map(([id, spec]) => ({ ...example.analyses[0], id, name: spec.name, visibility: spec.visibility ?? "shared", is_owner: spec.visibility === "personal", model: spec.query.model, metrics: spec.query.metrics, revision: spec.current ?? 1 })), unreadable: 0 });
    }
    const history = /^GET \/api\/spaces\/finance\/analyses\/([^/]+)\/revisions$/.exec(key);
    if (history?.[1] !== undefined && analyses[history[1]] !== undefined) {
      const current = analyses[history[1]]?.current ?? 1;
      const example = analysisRoute("historique", [[ID, history[1]]]).body as { revisions: Record<string, unknown>[] };
      return Response.json({ ...example, current_revision: current, revisions: Array.from({ length: current }, (_, i) => ({ ...example.revisions[0], revision: i + 1 })) });
    }
    const read = /^GET \/api\/spaces\/finance\/analyses\/([^/]+)\/revisions\/(\d+)$/.exec(key);
    if (read?.[1] !== undefined && analyses[read[1]] !== undefined) return Response.json(analysisBody(read[1], analyses[read[1]] as AnalysisSpec, Number(read[2])));
    if (key === `GET ${ROOT}/explorer/fields`) return Response.json({ models: MODELS });
    if (key === `POST ${ROOT}/executions`) {
      const body = JSON.parse(init?.body as string) as Query & { analysis: { id: string } };
      posts.push(body);
      const id = uuid(100 + posts.length);
      const query = { connection: body.connection, model: body.model, metrics: body.metrics, dimensions: options.outcomes?.[body.analysis.id] === "wide" ? [...body.dimensions, "channel"] : body.dimensions, filters: body.filters };
      const asked = counts.get(body.analysis.id) ?? 0;
      counts.set(body.analysis.id, asked + 1);
      const outcome = options.sequence?.[body.analysis.id]?.[asked] ?? options.outcomes?.[body.analysis.id] ?? "succeeded";
      // Les octets sont calculés une fois : deux encodages successifs de la même table n'ont pas la même taille.
      const bytes = outcome === "empty" ? tableToIPC(tableFromArrays({ [query.metrics[0] as string]: [] as number[] }), "stream") : BYTES_OF(query);
      queries.set(id, bytes);
      return Response.json(execution(id, query, outcome, bytes));
    }
    const result = new RegExp(`^GET ${ROOT}/executions/([^/]+)/result$`).exec(key);
    if (result?.[1] !== undefined && queries.has(result[1])) {
      return new Response((queries.get(result[1]) as Uint8Array).slice().buffer, { headers: { "content-type": "application/vnd.apache.arrow.stream" } });
    }
    return Response.json({}, { status: 500 });
  });
  return { fetcher, submitted: () => posts, saved: () => bodies };
}

const space = decodeSpace(espace.body, "espace");

/** Ouvre la page de l'éditeur sur un faux serveur ; l'attente entre deux lectures d'exécution est d'une milliseconde. */
export function openEditor(options: ServerOptions = {}) {
  const server = editorServer(options);
  const view = render(createElement(DashboardEditorPage, { space, id: ID, fetcher: server.fetcher, environment: "DEV", identity: "cora", poll: 1 }));
  return { server, ...view };
}

/** Réponse d'un enregistrement qui rend ce qui a été envoyé, à la révision `revision` (`status` 200 : contenu identique à la courante). */
export const echo = (init: RequestInit | undefined, revision: number, status = 201, tiles?: readonly TileInfo[]): Response => {
  const sent = JSON.parse(init?.body as string) as Record<string, unknown>;
  delete sent.expected_revision;
  return Response.json(dashboardBody(decodeDashboardDraft(sent), { revision, ...(tiles === undefined ? {} : { tiles }) }), { status });
};
