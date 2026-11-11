import type { Table } from "apache-arrow";
import type { ExecutionInput } from "../../executions/client";
import type { Execution } from "../../executions/model";
import type { ComposedExecution, ExecutionRefusal } from "./execution";

/** État observable d'une tuile, avec la preuve fournie par l'exécution réussie. */
export type ScheduledState =
  | { status: "waiting" | "running" | "cancelled" }
  | { status: "unavailable"; reason: ExecutionRefusal }
  | { status: "denied"; decision: "DENY" | "REQUIRE_HUMAN"; execution: Execution }
  | { status: "error"; error: unknown; execution?: Execution }
  | { status: "success" | "empty"; result: Table; execution: Execution };

/** Une tuile dans l'ordre du document et sa soumission déjà composée. */
export interface ScheduledTile { id: string; composed: ComposedExecution }
/** Clients injectés : soumettre, suivre, lire, annuler et temporiser. */
export interface SchedulerClients {
  submit: (input: ExecutionInput) => Promise<Execution>;
  read: (execution: Execution, signal: AbortSignal) => Promise<Execution>;
  result: (execution: Execution, signal: AbortSignal) => Promise<Table>;
  cancel: (execution: Execution) => Promise<void>;
  wait: (signal: AbortSignal) => Promise<void>;
}
/** Clé de contexte : un changement d'un de ces champs invalide toutes les tuiles. */
export interface SchedulerContext { space: string; identity: string; environment: string; dashboard: string }
/** État et commandes du planificateur ; `tileCount` ne contient aucune donnée personnelle. */
export interface Scheduler {
  readonly tileCount: number;
  snapshot(): ReadonlyMap<string, ScheduledState>;
  /**
   * Remplace la liste des tuiles voulues, dans l'ordre. Une tuile déjà connue dont la requête composée est identique garde sa
   * tâche, en cours ou terminée : elle n'est pas resoumise. Seules sont annulées les tuiles retirées de la liste et celles dont la
   * requête change ; les nouvelles rejoignent la file.
   */
  update(tiles: readonly ScheduledTile[]): void;
  /** Relance uniquement une tâche dont le serveur a confirmé l’annulation. */
  restart(id: string): void;
  changeContext(context: SchedulerContext): void;
  cancel(): void;
}

/** Une tâche : sa tuile, la requête qu'elle porte (pour reconnaître un changement) et sa propre annulation. */
interface Job { tile: ScheduledTile; request: string; controller: AbortController; execution?: Execution }

/**
 * Lance les tuiles dans l'ordre, quatre au plus simultanément ; aucun refus n'est réessayé. La liste peut être remplacée par
 * `update` sans toucher aux tâches inchangées ; `cancel` ou un changement de contexte abandonnent tout.
 */
export function schedule(initial: readonly ScheduledTile[], context: SchedulerContext, clients: SchedulerClients, onChange: (states: ReadonlyMap<string, ScheduledState>) => void): Scheduler {
  const states = new Map<string, ScheduledState>();
  const jobs = new Map<string, Job>();
  let queue: { job: Job; input: ExecutionInput }[] = [];
  let stopped = false;
  let running = 0;
  const snapshot = () => new Map(states);
  const isStopped = (job: Job) => job.controller.signal.aborted;
  function publish(job: Job, state: ScheduledState): void {
    if (isStopped(job)) return;
    states.set(job.tile.id, state);
    onChange(snapshot());
  }
  function cancelExecution(execution: Execution): void {
    void clients.cancel(execution).catch(() => undefined);
  }
  /** Abandonne une tâche : sa réponse tardive est ignorée et l'exécution qu'elle suivait est annulée côté serveur. */
  function abandon(job: Job): void {
    job.controller.abort();
    if (job.execution !== undefined) cancelExecution(job.execution);
  }
  async function run(job: Job, input: ExecutionInput): Promise<void> {
    const { signal } = job.controller;
    // La dernière exécution connue : si la suite échoue (lecture, résultat), l'erreur la porte pour le diagnostic.
    let known: Execution | undefined;
    try {
      let execution = await clients.submit(input);
      known = execution;
      if (isStopped(job)) {
        if (execution.state === "queued" || execution.state === "running") cancelExecution(execution);
        return;
      }
      job.execution = execution;
      while (execution.state === "queued" || execution.state === "running") {
        await clients.wait(signal);
        if (isStopped(job)) return;
        execution = await clients.read(execution, signal);
        known = execution;
        if (isStopped(job)) return;
        job.execution = execution;
      }
      delete job.execution;
      if (execution.state === "denied") {
        publish(job, { status: "denied", decision: execution.errorCode === "deny" ? "DENY" : "REQUIRE_HUMAN", execution });
      } else if (execution.state === "cancelled") {
        publish(job, { status: "cancelled" });
      } else if (execution.state !== "succeeded") {
        publish(job, { status: "error", error: execution.errorCode, execution });
      } else {
        const result = await clients.result(execution, signal);
        publish(job, { status: result.numRows === 0 ? "empty" : "success", result, execution });
      }
    } catch (error) {
      publish(job, known === undefined ? { status: "error", error } : { status: "error", error, execution: known });
    } finally {
      delete job.execution;
      running -= 1;
      pump();
    }
  }
  function pump(): void {
    while (!stopped && running < 4) {
      const next = queue.shift();
      if (next === undefined) return;
      const { job, input } = next;
      running += 1;
      publish(job, { status: "running" });
      if (isStopped(job)) {
        running -= 1;
        return;
      }
      void run(job, input);
    }
  }
  function update(tiles: readonly ScheduledTile[]): void {
    if (stopped) return;
    const wanted = new Map(tiles.map((tile) => [tile.id, JSON.stringify(tile.composed)] as const));
    for (const [id, job] of [...jobs]) {
      if (wanted.get(id) === job.request) continue;
      abandon(job);
      jobs.delete(id);
      states.delete(id);
    }
    for (const tile of tiles) {
      if (jobs.has(tile.id)) continue;
      jobs.set(tile.id, { tile, request: wanted.get(tile.id) as string, controller: new AbortController() });
      states.set(tile.id, tile.composed.status === "ready" ? { status: "waiting" } : { status: "unavailable", reason: tile.composed.reason });
    }
    queue = tiles.flatMap((tile) => (tile.composed.status === "ready" && states.get(tile.id)?.status === "waiting" ? [{ job: jobs.get(tile.id) as Job, input: tile.composed.input }] : []));
    pump();
    onChange(snapshot());
  }
  function cancel(): void {
    if (stopped) return;
    stopped = true;
    queue = [];
    jobs.forEach(abandon);
    for (const [id, state] of states) {
      if (state.status === "waiting" || state.status === "running") states.set(id, { status: "cancelled" });
    }
    onChange(snapshot());
  }
  update(initial);
  return {
    get tileCount() { return jobs.size; },
    snapshot,
    update,
    restart(id) {
      if (stopped || states.get(id)?.status !== "cancelled") return;
      const wanted = [...jobs.values()].map((job) => job.tile);
      const job = jobs.get(id) as Job;
      abandon(job);
      jobs.delete(id);
      states.delete(id);
      update(wanted);
    },
    cancel,
    changeContext(current) {
      if (current.space !== context.space || current.identity !== context.identity || current.environment !== context.environment || current.dashboard !== context.dashboard) cancel();
    },
  };
}
