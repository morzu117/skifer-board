import { bounded, decodeName, decodePerson } from "../analyses/document";
import { exact, fail, pick, uuid } from "../analyses/shape";
import { kpi, reference, visual, type KpiPresentation, type Reference, type VisualPresentation } from "../dashboards/document";
import type { Person } from "../analyses/document";

type Common = { api_version: "board.component/v1"; id: string; name: string; description: string; owner: Person; analysis: Reference };
export type ComponentDocument = Common & ({ kind: "visual"; presentation: VisualPresentation } | { kind: "kpi"; presentation: KpiPresentation });

export function decodeComponent(value: unknown, path = "component"): ComponentDocument {
  const found = exact(value, ["api_version", "id", "name", "description", "owner", "kind", "analysis", "presentation"], path);
  if (found.api_version !== "board.component/v1") return fail(`${path}.api_version`, "board.component/v1");
  const kind = pick(found.kind, ["visual", "kpi"] as const, `${path}.kind`);
  const common = { api_version: "board.component/v1" as const, id: uuid(found.id, `${path}.id`), name: decodeName(found.name, `${path}.name`), description: bounded(found.description, `${path}.description`, 0, 2000, true), owner: decodePerson(found.owner, `${path}.owner`), analysis: reference(found.analysis, `${path}.analysis`) };
  return kind === "visual" ? { ...common, kind, presentation: visual(found.presentation, `${path}.presentation`) } : { ...common, kind, presentation: kpi(found.presentation, `${path}.presentation`) };
}
