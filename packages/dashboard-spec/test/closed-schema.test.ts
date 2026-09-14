import { describe, expect, it } from "vitest";

import { validateStructure } from "../src/validate.js";

function minimalDashboard(overrides: {
  query?: Record<string, unknown>;
  viz?: Record<string, unknown>;
}): unknown {
  return {
    apiVersion: "skifer-board/v1",
    kind: "Dashboard",
    metadata: { slug: "closed-schema", title: "Closed schema" },
    spec: {
      tiles: [
        {
          id: "revenue_by_month",
          position: { x: 0, y: 0, w: 8, h: 4 },
          query: {
            model: "sales.orders",
            metrics: ["revenue"],
            group_by: ["order_month"],
            ...overrides.query,
          },
          viz: {
            kind: "line",
            x: "order_month",
            series: ["revenue"],
            ...overrides.viz,
          },
        },
      ],
    },
  };
}

describe("closed schema", () => {
  it("rejects a raw sql field in query", () => {
    const document = minimalDashboard({ query: { sql: "SELECT * FROM orders" } });
    expect(validateStructure(document).length).toBeGreaterThan(0);
  });

  it("rejects viz.kind: pie", () => {
    const document = minimalDashboard({ viz: { kind: "pie" } });
    expect(validateStructure(document).length).toBeGreaterThan(0);
  });

  it("rejects a binding in date_from", () => {
    const document = minimalDashboard({ query: { date_from: "$filters.period" } });
    expect(validateStructure(document).length).toBeGreaterThan(0);
  });
});
