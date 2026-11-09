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
  changeContext(context: SchedulerContext): void;
  cancel(): void;
}

/** Lance les tuiles dans l'ordre, quatre au plus simultanément ; aucun refus n'est réessayé. */
export function schedule(tiles: readonly ScheduledTile[], context: SchedulerContext, clients: SchedulerClients, onChange: (states: ReadonlyMap<string, ScheduledState>) => void): Scheduler {
  const states = new Map<string, ScheduledState>();
  const controller = new AbortController();
  const active = new Map<string, Execution>();
  let stopped = false;
  let next = 0;
  let running = 0;
  for (const tile of tiles) {
    states.set(tile.id, tile.composed.status === "ready" ? { status: "waiting" } : { status: "unavailable", reason: tile.composed.reason });
  }
  const snapshot = () => new Map(states);
  const isStopped = () => controller.signal.aborted;
  function publish(id: string, state: ScheduledState): void {
    if (stopped) return;
    states.set(id, state);
    onChange(snapshot());
  }
  function cancelExecution(execution: Execution): void {
    void clients.cancel(execution).catch(() => undefined);
  }
  async function run(tile: ScheduledTile, input: ExecutionInput): Promise<void> {
    try {
      let execution = await clients.submit(input);
      if (stopped) {
        if (execution.state === "queued" || execution.state === "running") cancelExecution(execution);
        return;
      }
      active.set(tile.id, execution);
      while (execution.state === "queued" || execution.state === "running") {
        await clients.wait(controller.signal);
        if (isStopped()) return;
        execution = await clients.read(execution, controller.signal);
        if (isStopped()) return;
        active.set(tile.id, execution);
      }
      active.delete(tile.id);
      if (execution.state === "denied") {
        publish(tile.id, { status: "denied", decision: execution.errorCode === "deny" ? "DENY" : "REQUIRE_HUMAN", execution });
      } else if (execution.state === "cancelled") {
        publish(tile.id, { status: "cancelled" });
      } else if (execution.state !== "succeeded") {
        publish(tile.id, { status: "error", error: execution.errorCode, execution });
      } else {
        const result = await clients.result(execution, controller.signal);
        publish(tile.id, { status: result.numRows === 0 ? "empty" : "success", result, execution });
      }
    } catch (error) {
      publish(tile.id, { status: "error", error });
    } finally {
      active.delete(tile.id);
      running -= 1;
      pump();
    }
  }
  function pump(): void {
    while (!stopped && running < 4 && next < tiles.length) {
      const tile = tiles[next] as ScheduledTile;
      next += 1;
      if (tile.composed.status !== "ready") continue;
      running += 1;
      publish(tile.id, { status: "running" });
      if (isStopped()) {
        running -= 1;
        return;
      }
      void run(tile, tile.composed.input);
    }
  }
  function cancel(): void {
    if (stopped) return;
    stopped = true;
    controller.abort();
    active.forEach(cancelExecution);
    for (const [id, state] of states) {
      if (state.status === "waiting" || state.status === "running") states.set(id, { status: "cancelled" });
    }
    onChange(snapshot());
  }
  pump();
  return {
    tileCount: tiles.length,
    snapshot,
    cancel,
    changeContext(current) {
      if (current.space !== context.space || current.identity !== context.identity || current.environment !== context.environment || current.dashboard !== context.dashboard) cancel();
    },
  };
}
