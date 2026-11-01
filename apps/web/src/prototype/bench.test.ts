import { describe, expect, it } from "vitest";

import { BENCH_PLAN, benchOption, BROWSER_PROBES, runBench, type BenchProbes } from "./bench";

describe("plan de mesure", () => {
  it("couvre les tailles fixées avant l'essai", () => {
    expect(BENCH_PLAN).toHaveLength(24);
    expect(new Set(BENCH_PLAN.map((item) => item.points))).toEqual(new Set([100, 1000, 10_000]));
    expect(new Set(BENCH_PLAN.map((item) => item.tiles))).toEqual(new Set([1, 12]));
  });

  it("construit les deux graphiques mesurés", () => {
    const bars = benchOption("barres", 10) as { series: { type: string; data: unknown[] }[] };
    const line = benchOption("ligne", 10) as { series: { type: string; data: unknown[] }[] };
    expect(bars.series[0]?.type).toBe("bar");
    expect(line.series[0]?.type).toBe("line");
    expect(line.series[0]?.data).toHaveLength(10);
  });
});

describe("runBench", () => {
  it("mesure, puis libère les tuiles", () => {
    let clock = 0;
    let heap = 1_048_576;
    let collected = 0;
    const probes: BenchProbes = {
      now: () => (clock += 6),
      heap: () => (heap += 1_048_576),
      collect: () => {
        collected += 1;
      },
    };
    const host = document.createElement("div");
    const [result] = runBench(host, [{ chart: "barres", points: 10, tiles: 2, renderer: "svg" }], probes);
    expect(result).toEqual({ chart: "barres", points: 10, tiles: 2, renderer: "svg", totalMs: 6, perTileMs: 3, heapMb: 1 });
    expect(collected).toBe(1);
    expect(host.childElementCount).toBe(0);
  });

  it("dit quand la mémoire n'est pas mesurable", () => {
    const [result] = runBench(document.createElement("div"), [{ chart: "ligne", points: 5, tiles: 1, renderer: "svg" }], { ...BROWSER_PROBES, heap: () => null });
    expect(result?.heapMb).toBeNull();
    expect(result?.totalMs).toBeGreaterThanOrEqual(0);
  });

  it("lit les sondes du navigateur quand elles existent", () => {
    expect(BROWSER_PROBES.heap()).toBeNull();
    const performanceWithMemory = performance as Performance & { memory?: { usedJSHeapSize: number } };
    performanceWithMemory.memory = { usedJSHeapSize: 42 };
    (globalThis as { gc?: () => void }).gc = () => undefined;
    expect(BROWSER_PROBES.heap()).toBe(42);
    expect(() => {
      BROWSER_PROBES.collect();
    }).not.toThrow();
    delete performanceWithMemory.memory;
    delete (globalThis as { gc?: () => void }).gc;
    expect(() => {
      BROWSER_PROBES.collect();
    }).not.toThrow();
    expect(BROWSER_PROBES.now()).toBeGreaterThan(0);
  });
});
