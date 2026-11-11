import { useEffect, useMemo, useRef, useState } from "react";

import { fetchAnalysisRevision } from "../../analyses/client";
import type { Failed } from "../../analyses/Failure";
import type { AnalysisRevision } from "../../analyses/model";
import { cancelExecution, fetchExecution, fetchResult, submitExecution } from "../../executions/client";
import type { ExplorerModel } from "../../explorer/model";
import { validateExecutionFilters } from "../../explorer/filters";
import type { Environment } from "../../shell/sections";
import type { AdminOutcome } from "../../spaces/admin";
import type { Fetch } from "../../spaces/api";
import { executables, type DashboardDraft } from "../document";
import type { Tile } from "../model";
import { composeExecution, type ComposedExecution } from "./execution";
import { incompatibleTargets, type KnownAnalyses } from "./problems";
import { schedule, type ScheduledState, type Scheduler, type SchedulerClients } from "./scheduler";

/**
 * Exécution des tuiles de l'éditeur (plan 19, 19.5a) : lit l'analyse épinglée de chaque composant exécutable, compose sa
 * soumission avec les filtres communs qui le ciblent (`composeExecution`), puis la confie au planificateur (`schedule`, quatre
 * exécutions au plus en même temps), branché sur les clients d'exécution existants. Ce que la présentation change n'entre pas
 * dans la soumission : la clé du plan ne dépend que des requêtes composées, donc modifier une présentation ne relance rien.
 *
 * Une requête, pas une tuile : le planificateur reçoit une tâche par requête composée distincte (sa signature). Deux tuiles dont
 * la requête est identique partagent la même soumission, donc la même décision ; il n'y a jamais deux décisions pour une même
 * signature dans un même contexte. Une décision DENY ou REQUIRE_HUMAN gardée n'est jamais remplacée par un succès pour cette
 * signature et ce contexte : la première réponse tranchée reste, retirer une tuile ne la change pas. Annuler une tuile ne termine
 * pas une requête partagée tant qu’une autre tuile la demande ; seule la tuile annulée change d’état.
 *
 * Avant d'être soumise, une tuile ciblée par un filtre commun doit être établie compatible avec le catalogue, selon la règle des
 * problèmes de l'éditeur (`incompatibleTargets`) : elle est sinon indisponible (`filter_incompatible`), y compris si le serveur la
 * disait prête pour une version antérieure du document. Sans catalogue lu, elle attend ; si le catalogue est illisible, elle le dit.
 *
 * Le contexte (espace, identité, environnement, dashboard) est la durée de vie de tout ce que le hook a lu ou exécuté : quand il
 * change, les lectures et les exécutions sont abandonnées, les données et états associés effacés, puis tout est relu sous le
 * nouveau contexte. Dans un même contexte, le résultat d'une soumission, refus DENY et REQUIRE_HUMAN compris, est gardé : une
 * requête identique n'est jamais resoumise (déplacer une tuile, annuler une modification ou en retirer une autre ne relance rien).
 * Une modification du canevas ne touche pas aux soumissions en cours dont la requête est inchangée : seules les requêtes retirées
 * ou changées sont abandonnées, les nouvelles sont soumises. Une erreur n'est pas gardée, elle ne dit rien de la requête.
 */

/** Un échec rendu par le serveur ou le réseau, porté jusqu'à l'écran par le planificateur. */
export class OutcomeError extends Error {
  readonly outcome: Failed;
  constructor(outcome: Failed) {
    super(outcome.status === "refused" ? outcome.code : outcome.message);
    this.outcome = outcome;
  }
}

/** Ce qu'une tuile peut montrer : l'état du planificateur, la lecture de l'analyse épinglée, ou son échec. */
export type TileState = ScheduledState | { status: "reading"; source?: "catalog" } | { status: "unreadable"; outcome: Failed; source?: "catalog" };

const unwrap = <T,>(outcome: AdminOutcome<T>): T => {
  if (outcome.status !== "ok") throw new OutcomeError(outcome);
  return outcome.value;
};

/** Clients du planificateur sur les routes d'exécution de l'espace ; `poll` est l'attente entre deux lectures d'une exécution. */
export function executionClients(space: string, fetcher: Fetch, poll: number): SchedulerClients {
  return {
    submit: async (input) => unwrap(await submitExecution(space, input, fetcher)),
    read: async (execution, signal) => unwrap(await fetchExecution(space, execution.id, signal, fetcher)),
    result: async (execution, signal) => unwrap(await fetchResult(space, execution, signal, fetcher)),
    cancel: async (execution) => { unwrap(await cancelExecution(space, execution.id, fetcher)); },
    wait: (signal) => new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, poll);
      signal.addEventListener("abort", () => { window.clearTimeout(timer); resolve(); }, { once: true });
    }),
  };
}

/** Le catalogue des modèles, tel que l'éditeur l'a lu : en cours, rendu, ou refusé. */
export type TileCatalog = { status: "loading" } | AdminOutcome<{ models: readonly ExplorerModel[] }>;

export interface TileSources {
  space: string;
  dashboard: string;
  /** Qui lit : la clé stable de la session (`identityKey`), jamais le nom affiché. Un changement de personne recommence tout. */
  identity: string;
  environment: Environment;
  document: DashboardDraft;
  /** États des tuiles rendus par le serveur pour la révision enregistrée. */
  tiles: readonly Tile[];
  /** Les modèles pour établir qu'un filtre commun convient à une tuile avant de la soumettre. */
  catalog: TileCatalog;
  fetcher: Fetch;
  poll: number;
  /** Valeurs de travail, absentes du document enregistré ; null désactive le filtre. */
  values?: Readonly<Record<string, unknown>>;
}

export interface Tiles {
  states: ReadonlyMap<string, TileState>;
  /** Analyses épinglées lues, par composant, pour les problèmes et les propriétés. */
  analyses: KnownAnalyses;
  /** Les lectures d'analyses épinglées sont-elles toutes terminées ? */
  settled: boolean;
  cancel: (id: string) => void;
  retry: (id: string) => void;
  restart: (id: string) => void;
  overlaps: ReadonlyMap<string, readonly string[]>;
}

const keyOf = (reference: { analysis_id: string; revision: number }): string => `${reference.analysis_id}:${String(reference.revision)}`;

/** Ce que le hook a gardé pour un contexte : rien n'en survit à un autre contexte. */
interface Scoped<T> { context: string; value: T }
const NO_READS: ReadonlyMap<string, AdminOutcome<AnalysisRevision>> = new Map();
const NO_VALUES: Readonly<Record<string, unknown>> = {};
const NO_RESULTS: ReadonlyMap<string, ScheduledState> = new Map();
/** Les états dont la requête est tranchée : un résultat, une table vide ou la décision du moteur. */
const KEPT = new Set<ScheduledState["status"]>(["success", "empty", "denied"]);

type ReadyComposed = Extract<ComposedExecution, { status: "ready" }>;
/** Une tuile : sa composition, ou l'état qui en tient lieu tant qu'elle ne peut pas être composée. */
interface Composed { id: string; composed: ComposedExecution | null; waiting?: TileState; signature?: string }

export function useTiles({ space, dashboard, identity, environment, document, tiles, catalog, fetcher, poll, values = NO_VALUES }: TileSources): Tiles {
  const context = JSON.stringify([space, identity, environment, dashboard]);
  const components = useMemo(() => executables(document), [document]);
  // Un composant que la réponse du serveur ne connaît pas (retiré puis rétabli par « Annuler » après un enregistrement, ou ajouté
  // depuis) n'a pas d'état de tuile : sa lecture est la seule vérification, et l'analyse épinglée dit ce qu'elle vaut
  // (`composeExecution` refuse une analyse non vérifiée ou à référence non résolue). Rien n'est exécuté avant cette lecture.
  const tileOf = (component: { id: string }): Tile => tiles.find((one) => one.id === component.id) ?? { id: component.id, state: "ready" };
  // Une tuile que le serveur dit indisponible n'a rien à lire : sa raison est la sienne, l'analyse épinglée n'est pas redemandée.
  const wanted = useMemo(() => components.filter((component) => tiles.find((one) => one.id === component.id)?.state !== "unavailable"), [components, tiles]);
  const [retryCount, setRetryCount] = useState(0);
  const [cancelledState, setCancelled] = useState<Scoped<ReadonlySet<string>>>({ context, value: new Set() });
  if (cancelledState.context !== context) setCancelled({ context, value: new Set() });
  const cancelled = cancelledState.context === context ? cancelledState.value : new Set<string>();
  const [readState, setReads] = useState<Scoped<ReadonlyMap<string, AdminOutcome<AnalysisRevision>>>>({ context, value: NO_READS });
  const [doneState, setDone] = useState<Scoped<ReadonlyMap<string, ScheduledState>>>({ context, value: NO_RESULTS });
  // Un autre contexte efface aussitôt ce qui a été lu et gardé sous le précédent.
  if (readState.context !== context) setReads({ context, value: NO_READS });
  if (doneState.context !== context) setDone({ context, value: NO_RESULTS });
  const reads = readState.context === context ? readState.value : NO_READS;
  const done = doneState.context === context ? doneState.value : NO_RESULTS;
  const life = useRef<{ controller: AbortController; asked: Set<string>; enqueue: (work: () => Promise<void>) => void } | null>(null);
  // La durée de vie des lectures est celle du contexte : en changer, ou quitter l'éditeur, les abandonne (et un rejeu des effets les relance).
  useEffect(() => {
    const controller = new AbortController();
    const queue: (() => Promise<void>)[] = [];
    let active = 0;
    const pump = (): void => {
      while (!controller.signal.aborted && active < 40 && queue.length > 0) {
        const work = queue.shift() as () => Promise<void>;
        active += 1;
        void work().finally(() => { active -= 1; pump(); });
      }
    };
    const own = { controller, asked: new Set<string>(), enqueue: (work: () => Promise<void>) => { queue.push(work); pump(); } };
    life.current = own;
    return () => { controller.abort(); queue.length = 0; };
  }, [context]);
  // Une lecture par analyse épinglée, jamais deux : les lectures d'un composant retiré puis rétabli restent connues.
  useEffect(() => {
    const { controller, asked, enqueue } = life.current as NonNullable<typeof life.current>;
    for (const component of wanted) {
      const key = keyOf(component.reference);
      if (asked.has(key)) continue;
      asked.add(key);
      enqueue(async () => {
        await fetchAnalysisRevision(space, component.reference.analysis_id, component.reference.revision, controller.signal, fetcher).then(
          (outcome) => { if (!controller.signal.aborted) setReads((previous) => ({ context, value: new Map(previous.value).set(key, outcome) })); },
          () => undefined,
        );
      });
    }
  }, [wanted, space, context, fetcher, retryCount]);
  const settled = wanted.every((component) => reads.has(keyOf(component.reference)));
  const analyses = useMemo(() => {
    const known: Record<string, { pinned: AnalysisRevision; current: number | null } | undefined> = {};
    for (const component of components) {
      const read = reads.get(keyOf(component.reference));
      if (read?.status === "ok") known[component.id] = { pinned: read.value, current: read.value.currentRevision };
    }
    return known;
  }, [components, reads]);
  // Les composants que la règle de compatibilité des filtres écarte : le catalogue la rend ou, tant qu'il manque, rien n'est conclu.
  const incompatible = useMemo(() => {
    if (catalog.status !== "ok") return new Set<string>();
    return new Set(document.filters.flatMap((filter) => incompatibleTargets(filter, analyses, catalog.value.models).map((index) => filter.targets[index] as string)));
  }, [document.filters, analyses, catalog]);
  const composed = useMemo(() => components.map((component): Composed => {
    const tile = tileOf(component);
    if (tile.state === "unavailable") return { id: component.id, composed: { status: "unavailable", reason: tile.reason } };
    const read = reads.get(keyOf(component.reference));
    if (read === undefined) return { id: component.id, composed: null, waiting: { status: "reading" } };
    if (read.status !== "ok") return { id: component.id, composed: null, waiting: { status: "unreadable", outcome: read } };
    const one = composeExecution(component, read.value, document.filters, values, tile, environment);
    if (one.status !== "ready") return { id: component.id, composed: one };
    // Une tuile ciblée par un filtre n'est ni soumise ni montrée prête avant d'avoir établi que le filtre lui convient.
    if (document.filters.some((filter) => filter.targets.includes(component.id))) {
      if (catalog.status === "loading") return { id: component.id, composed: null, waiting: { status: "reading", source: "catalog" } };
      if (catalog.status !== "ok") return { id: component.id, composed: null, waiting: { status: "unreadable", outcome: catalog, source: "catalog" } };
      if (incompatible.has(component.id)) return { id: component.id, composed: { status: "unavailable", reason: "filter_incompatible" } };
      // La règle incompatibleTargets a déjà établi que ce modèle existe.
      const model = catalog.value.models.find((item) => item.name === read.value.analysis.query.model) as ExplorerModel;
      try {
        validateExecutionFilters(one.input.filters, model);
      } catch {
        return { id: component.id, composed: { status: "unavailable", reason: "invalid_filter_value" } };
      }
    }
    return { id: component.id, composed: one, signature: JSON.stringify(one.input) };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `tileOf` ne dépend que de `tiles`
  }), [components, reads, tiles, document.filters, environment, catalog, incompatible, values]);
  // Une tâche par requête distincte, dans l'ordre du document : les tuiles de même signature partagent sa soumission et sa décision.
  const requests = new Map<string, ReadyComposed>();
  for (const item of composed) {
    if (!cancelled.has(item.id) && item.signature !== undefined && item.composed?.status === "ready" && !requests.has(item.signature)) requests.set(item.signature, item.composed);
  }
  // La clé ne porte que les requêtes composées, sans l'ordre : déplacer une tuile ou modifier une présentation ne relance rien.
  const planKey = JSON.stringify([context, [...requests.keys()].sort()]);
  const latest = useRef({ requests, done });
  useEffect(() => { latest.current = { requests, done }; });
  const [running, setRunning] = useState<Scoped<ReadonlyMap<string, ScheduledState>> | null>(null);
  const scheduler = useRef<Scheduler | null>(null);
  // Un planificateur par contexte : le quitter, ou changer de client, abandonne tout ce qui est en cours.
  useEffect(() => {
    let live = true;
    const own = schedule([], { space, identity, environment, dashboard }, executionClients(space, fetcher, poll), (states) => {
      if (!live) return;
      setRunning({ context, value: states });
      const fresh = [...states].filter(([, state]) => KEPT.has(state.status));
      if (fresh.length === 0) return;
      // La première décision tranchée d'une signature reste : un succès ne remplace jamais un DENY ou un REQUIRE_HUMAN gardé.
      setDone((previous) => ({ context, value: new Map([...fresh, ...previous.value]) }));
    });
    scheduler.current = own;
    return () => { live = false; own.cancel(); scheduler.current = null; };
  }, [space, identity, environment, dashboard, context, fetcher, poll]);
  // Le plan change : les requêtes déjà tranchées ne repartent pas, celles en cours et inchangées continuent, les autres sont reprises.
  useEffect(() => {
    const { requests: wantedRequests, done: kept } = latest.current;
    // L’effet de création ci-dessus est exécuté avant cet effet et possède cette durée de vie.
    const own = scheduler.current as Scheduler;
    const existing = own.snapshot();
    own.update([...wantedRequests].filter(([signature]) => !kept.has(signature) && (settled || existing.has(signature))).map(([signature, one]) => ({ id: signature, composed: one })));
  }, [planKey, settled, space, identity, environment, dashboard, context, fetcher, poll]);
  const current = running?.context === context ? running.value : null;
  const states = new Map<string, TileState>();
  for (const item of composed) {
    if (cancelled.has(item.id)) states.set(item.id, { status: "cancelled" });
    else if (item.composed?.status === "unavailable") states.set(item.id, { status: "unavailable", reason: item.composed.reason });
    else if (item.signature !== undefined) states.set(item.id, done.get(item.signature) ?? current?.get(item.signature) ?? (settled ? { status: "waiting" } : { status: "reading" }));
    else states.set(item.id, item.waiting as TileState);
  }
  const cancel = (id: string) => { setCancelled((previous) => ({ context, value: new Set([...previous.value, id]) })); };
  const restart = (id: string) => {
    if (states.get(id)?.status !== "cancelled") return;
    const signature = composed.find((item) => item.id === id)?.signature;
    if (signature !== undefined && !done.has(signature)) scheduler.current?.restart(signature);
    setCancelled((previous) => { const value = new Set(previous.value); value.delete(id); return { context, value }; });
  };
  const retry = (id: string) => {
    const component = components.find((one) => one.id === id);
    if (component === undefined) return;
    const key = keyOf(component.reference);
    const read = reads.get(key);
    if (read === undefined || read.status === "ok") return;
    life.current?.asked.delete(key);
    setReads((previous) => { const value = new Map(previous.value); value.delete(key); return { context, value }; });
    setRetryCount((value) => value + 1);
  };
  const overlaps = new Map(composed.flatMap((item) => item.composed?.status === "ready" ? [[item.id, item.composed.overlaps] as const] : []));
  return { states, analyses, settled, cancel, retry, restart, overlaps };
}
