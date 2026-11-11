import { describe, expect, it, vi } from "vitest";
import type { Table } from "apache-arrow";
import type { Execution } from "../../executions/model";
import type { ExecutionInput } from "../../executions/client";
import { schedule, type SchedulerClients, type ScheduledTile } from "./scheduler";

const input = {} as ExecutionInput;
const context = { space: "s", identity: "i", environment: "DEV", dashboard: "d" };
const execution = (id: string, state: Execution["state"], errorCode: Execution["errorCode"] = null) => ({ id, state, errorCode, proof: { evidenceId: "proof" } }) as Execution;
const ready = (id: string): ScheduledTile => ({ id, composed: { status: "ready", input: { ...input, connection: id }, overlaps: [] } });
const table = (numRows: number) => ({ numRows }) as Table;
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

describe("planificateur des tuiles", () => {
  it("borne à quatre et lance les tuiles dans l'ordre, sans soumettre les indisponibles", async () => {
    const submitted: string[] = [];
    const releases: ((run: Execution) => void)[] = [];
    const clients: SchedulerClients = {
      submit: vi.fn((request: ExecutionInput) => { submitted.push(request.connection); return new Promise<Execution>((resolve) => releases.push(resolve)); }),
      read: vi.fn(), result: vi.fn().mockResolvedValue(table(1)), cancel: vi.fn(), wait: vi.fn(),
    };
    const scheduler = schedule([ready("a"), ready("b"), { id: "x", composed: { status: "unavailable", reason: "unverified" } }, ready("c"), ready("d"), ready("e")], context, clients, () => undefined);
    expect(submitted).toEqual(["a", "b", "c", "d"]);
    expect(scheduler.tileCount).toBe(6);
    expect(scheduler.snapshot().get("e")).toEqual({ status: "waiting" });
    expect(scheduler.snapshot().get("x")).toEqual({ status: "unavailable", reason: "unverified" });
    (releases[0] as (run: Execution) => void)(execution("0", "succeeded"));
    await flush();
    expect(submitted).toEqual(["a", "b", "c", "d", "e"]);
    expect(scheduler.snapshot().get("a")).toMatchObject({ status: "success", execution: { proof: { evidenceId: "proof" } } });
    scheduler.cancel();
  });
  it("suit avec l'horloge injectée, expose vide et refus sans nouvel essai", async () => {
    vi.useFakeTimers();
    const clients: SchedulerClients = {
      submit: vi.fn().mockResolvedValueOnce(execution("a", "queued")).mockResolvedValueOnce(execution("b", "denied", "require_human")),
      wait: vi.fn(() => new Promise<void>((resolve) => { setTimeout(resolve, 50); })),
      read: vi.fn().mockResolvedValue(execution("a", "succeeded")), result: vi.fn().mockResolvedValue(table(0)), cancel: vi.fn(),
    };
    const scheduler = schedule([ready("a"), ready("b")], context, clients, () => undefined);
    await flush();
    expect(scheduler.snapshot().get("b")).toMatchObject({ status: "denied", decision: "REQUIRE_HUMAN" });
    await vi.advanceTimersByTimeAsync(50);
    await flush();
    expect(scheduler.snapshot().get("a")).toMatchObject({ status: "empty" });
    expect(vi.mocked(clients.submit)).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
  it.each(["space", "identity", "environment", "dashboard"] as const)("annule au changement de %s et ignore la réponse tardive", async (field) => {
    let finish!: (value: Table) => void;
    const clients: SchedulerClients = { submit: vi.fn().mockResolvedValue(execution("a", "succeeded")), read: vi.fn(), wait: vi.fn(), cancel: vi.fn().mockResolvedValue(undefined), result: vi.fn(() => new Promise<Table>((resolve) => { finish = resolve; })) };
    const scheduler = schedule([ready("a")], context, clients, () => undefined);
    await flush();
    scheduler.changeContext(context);
    expect(scheduler.snapshot().get("a")?.status).toBe("running");
    scheduler.changeContext({ ...context, [field]: "different" });
    expect(vi.mocked(clients.cancel)).not.toHaveBeenCalled();
    finish(table(1));
    await flush();
    expect(scheduler.snapshot().get("a")?.status).toBe("cancelled");
    scheduler.cancel();
  });
  it("annule même une soumission qui répond après le changement de contexte", async () => {
    let finish!: (value: Execution) => void;
    const clients: SchedulerClients = { submit: vi.fn(() => new Promise<Execution>((resolve) => { finish = resolve; })), read: vi.fn(), result: vi.fn(), wait: vi.fn(), cancel: vi.fn().mockRejectedValue(new Error("offline")) };
    const scheduler = schedule([ready("a"), ready("b"), ready("c"), ready("d"), ready("e")], context, clients, () => undefined);
    scheduler.cancel();
    finish(execution("late", "running"));
    await flush();
    expect(vi.mocked(clients.cancel)).toHaveBeenCalledTimes(1);
    expect(scheduler.snapshot().get("e")?.status).toBe("cancelled");
  });
  it.each([["denied", "deny", "denied"], ["failed", "execution_failed", "error"], ["timed_out", "execution_timed_out", "error"], ["cancelled", "cancelled", "cancelled"]] as const)("restitue l'état terminal %s", async (state, code, expected) => {
    const clients: SchedulerClients = { submit: vi.fn().mockResolvedValue(execution("a", state, code)), read: vi.fn(), result: vi.fn(), wait: vi.fn(), cancel: vi.fn() };
    const scheduler = schedule([ready("a")], context, clients, () => undefined);
    await flush();
    expect(scheduler.snapshot().get("a")).toMatchObject({ status: expected });
    if (state === "failed" || state === "timed_out") expect(scheduler.snapshot().get("a")).toMatchObject({ execution: { id: "a" } });
    if (state === "denied") {
      expect(scheduler.snapshot().get("a")).toMatchObject({ decision: "DENY" });
      expect(vi.mocked(clients.submit)).toHaveBeenCalledTimes(1);
    }
  });
  it.each(["wait", "read"] as const)("ignore la fin tardive de %s", async (stage) => {
    let releaseWait: () => void = () => undefined;
    let releaseRead: (value: Execution) => void = () => undefined;
    const clients: SchedulerClients = {
      submit: vi.fn().mockResolvedValue(execution("a", "running")),
      wait: vi.fn(() => stage === "wait" ? new Promise<void>((resolve) => { releaseWait = resolve; }) : Promise.resolve()),
      read: vi.fn(() => new Promise<Execution>((resolve) => { releaseRead = resolve; })),
      result: vi.fn(), cancel: vi.fn().mockResolvedValue(undefined),
    };
    const scheduler = schedule([ready("a")], context, clients, () => undefined);
    await flush();
    scheduler.cancel();
    if (stage === "wait") releaseWait();
    else releaseRead(execution("a", "succeeded"));
    await flush();
    expect(scheduler.snapshot().get("a")?.status).toBe("cancelled");
  });
  it("ne soumet pas après annulation pendant la publication de running", async () => {
    const clients: SchedulerClients = { submit: vi.fn().mockResolvedValue(execution("a", "succeeded")), read: vi.fn(), result: vi.fn().mockResolvedValue(table(1)), wait: vi.fn(), cancel: vi.fn() };
    const scheduler: ReturnType<typeof schedule> = schedule([ready("a"), ready("b"), ready("c"), ready("d"), ready("e")], context, clients, (states) => {
      if (states.get("e")?.status === "running") scheduler.cancel();
    });
    await flush();
    expect(vi.mocked(clients.submit)).toHaveBeenCalledTimes(4);
    expect(scheduler.snapshot().get("e")?.status).toBe("cancelled");
  });
  it("ne demande pas l'annulation d'une exécution terminale reçue tard", async () => {
    let finish: (value: Execution) => void = () => undefined;
    const clients: SchedulerClients = { submit: vi.fn(() => new Promise<Execution>((resolve) => { finish = resolve; })), read: vi.fn(), result: vi.fn(), wait: vi.fn(), cancel: vi.fn() };
    const scheduler = schedule([ready("a")], context, clients, () => undefined);
    scheduler.cancel();
    finish(execution("a", "succeeded"));
    await flush();
    expect(vi.mocked(clients.cancel)).not.toHaveBeenCalled();
  });
  it("rend les erreurs de client sans nouvelle tentative", async () => {
    const clients: SchedulerClients = { submit: vi.fn().mockRejectedValue(new Error("panne")), read: vi.fn(), result: vi.fn(), wait: vi.fn(), cancel: vi.fn() };
    const scheduler = schedule([ready("a")], context, clients, () => undefined);
    await flush();
    expect(scheduler.snapshot().get("a")).toMatchObject({ status: "error" });
    expect(vi.mocked(clients.submit)).toHaveBeenCalledTimes(1);
  });
  it("garde l'exécution déjà obtenue quand la lecture du résultat échoue", async () => {
    const done = execution("a", "succeeded");
    const clients: SchedulerClients = { submit: vi.fn().mockResolvedValue(done), read: vi.fn(), result: vi.fn().mockRejectedValue(new Error("résultat perdu")), wait: vi.fn(), cancel: vi.fn() };
    const scheduler = schedule([ready("a")], context, clients, () => undefined);
    await flush();
    expect(scheduler.snapshot().get("a")).toMatchObject({ status: "error", execution: { id: "a" } });
  });
  it("garde la dernière exécution lue quand le suivi échoue en cours de route", async () => {
    const clients: SchedulerClients = {
      submit: vi.fn().mockResolvedValue(execution("a", "queued")), wait: vi.fn().mockResolvedValue(undefined),
      read: vi.fn().mockResolvedValueOnce(execution("a", "running")).mockRejectedValueOnce(new Error("lecture perdue")), result: vi.fn(), cancel: vi.fn(),
    };
    const scheduler = schedule([ready("a")], context, clients, () => undefined);
    await flush();
    expect(scheduler.snapshot().get("a")).toMatchObject({ status: "error", execution: { id: "a", state: "running" } });
  });
  it("sans exécution obtenue, l'erreur n'en porte pas", async () => {
    const clients: SchedulerClients = { submit: vi.fn().mockRejectedValue(new Error("panne")), read: vi.fn(), result: vi.fn(), wait: vi.fn(), cancel: vi.fn() };
    const scheduler = schedule([ready("a")], context, clients, () => undefined);
    await flush();
    expect(scheduler.snapshot().get("a")).not.toHaveProperty("execution");
  });
});

it("met à jour les tâches sans interrompre celles qui restent, et abandonne celles retirées ou modifiées", async () => {
  const releases = new Map<string, (run: Execution) => void>();
  const clients: SchedulerClients = {
    submit: vi.fn((request: ExecutionInput) => new Promise<Execution>((resolve) => { releases.set(request.connection, resolve); })),
    read: vi.fn(), result: vi.fn().mockResolvedValue(table(1)), wait: vi.fn(), cancel: vi.fn().mockResolvedValue(undefined),
  };
  const scheduler = schedule([ready("a"), ready("b"), ready("c")], context, clients, () => undefined);
  const modified: ScheduledTile = { id: "c", composed: { status: "ready", input: { ...input, connection: "changed" }, overlaps: [] } };
  scheduler.update([ready("a"), modified, ready("d")]);
  expect(vi.mocked(clients.submit).mock.calls.map(([value]) => value.connection)).toEqual(["a", "b", "c", "changed"]);
  releases.get("b")?.(execution("b", "running"));
  releases.get("c")?.(execution("c", "succeeded"));
  await flush();
  expect(clients.cancel).toHaveBeenCalledWith(expect.objectContaining({ id: "b" }));
  expect(vi.mocked(clients.submit).mock.calls.map(([value]) => value.connection)).toEqual(["a", "b", "c", "changed", "d"]);
  releases.get("a")?.(execution("a", "succeeded"));
  await flush();
  expect(scheduler.snapshot().get("a")).toMatchObject({ status: "success" });
  expect(scheduler.snapshot().has("b")).toBe(false);
  scheduler.cancel();
  scheduler.update([ready("new")]);
  expect(scheduler.snapshot().has("new")).toBe(false);
});

it.each(["cancel", "update"] as const)("annule côté serveur une exécution en cours par %s", async (action) => {
  const run = execution("active", "running");
  const clients: SchedulerClients = { submit: vi.fn().mockResolvedValue(run), wait: vi.fn(() => new Promise<void>(() => undefined)), read: vi.fn(), result: vi.fn(), cancel: vi.fn().mockResolvedValue(undefined) };
  const scheduler = schedule([ready("a")], context, clients, () => undefined);
  await flush();
  if (action === "cancel") scheduler.cancel(); else scheduler.update([]);
  expect(clients.cancel).toHaveBeenCalledExactlyOnceWith(run);
});
