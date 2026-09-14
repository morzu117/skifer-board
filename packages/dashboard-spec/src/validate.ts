import Ajv2020, { type ErrorObject } from "ajv/dist/2020.js";

import schema from "../schema/dashboard.v1.json";
import type { DashboardAsYAMLV1 as Dashboard } from "./generated/dashboard.v1.js";

export interface ValidationIssue {
  layer: "structural";
  code: "SCHEMA_VIOLATION";
  path: string;
  message: string;
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validator = ajv.compile(schema);

function toIssue(error: ErrorObject): ValidationIssue {
  return {
    layer: "structural",
    code: "SCHEMA_VIOLATION",
    path: error.instancePath,
    message: error.message ?? "",
  };
}

export function validateStructure(document: unknown): ValidationIssue[] {
  const valid = validator(document);
  if (valid) {
    return [];
  }
  const issues = (validator.errors ?? []).map(toIssue);
  return issues.sort(
    (a, b) => a.path.localeCompare(b.path) || a.message.localeCompare(b.message),
  );
}

export function isDashboard(document: unknown): document is Dashboard {
  return validateStructure(document).length === 0;
}
