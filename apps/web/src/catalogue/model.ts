import { boolean, instant, integer, list, nullable, object, oneOf, text } from "./decode";

/** Contrat de l'API du catalogue (plan 04, 4.2), champ pour champ. */

export const DOCUMENT_KINDS = ["concept", "kpi"] as const;
export const ATLAS_STATUSES = ["validated", "draft", "needs_curation", "invalid"] as const;
export const AVAILABILITY_STATES = ["executable", "unresolved"] as const;
export const UNRESOLVED_REASONS = ["mapping_absent", "not_validated"] as const;
export const FRESHNESS = ["fresh", "stale"] as const;
export const SOURCE_PROBLEMS = ["repository_missing", "repository_unreadable"] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export type AtlasStatus = (typeof ATLAS_STATUSES)[number];
export type AvailabilityState = (typeof AVAILABILITY_STATES)[number];
export type UnresolvedReason = (typeof UNRESOLVED_REASONS)[number];
export type Freshness = (typeof FRESHNESS)[number];
export type SourceProblem = (typeof SOURCE_PROBLEMS)[number];

export interface Provenance {
  commit: string;
  read_at: Date;
  freshness: Freshness;
  problem: SourceProblem | null;
  detail: string | null;
}

export interface Availability {
  state: AvailabilityState;
  reason: UnresolvedReason | null;
}

export interface CatalogEntry {
  id: string;
  kind: DocumentKind;
  label: string;
  domain: string | null;
  owner: string | null;
  version: number | null;
  status: AtlasStatus;
  description: string | null;
  synonyms: readonly string[];
  variant_count: number;
  availability: Availability | null;
}

export interface Issue {
  path: string;
  node_id: string | null;
  code: string;
  message: string;
  severity: string;
}

export interface Variant {
  id: string;
  entity: string;
  mode: string;
  kpi_version: number | null;
  override_count: number;
  undeclared_count: number;
  version: number | null;
  owner: string | null;
  status: AtlasStatus;
}

export interface Reference {
  id: string;
  kind: string;
  version: number | null;
  found: boolean;
  document_kind: string | null;
  label: string | null;
  status: AtlasStatus | null;
  domain: string | null;
}

export interface Dependent {
  id: string;
  kind: string;
  version: number | null;
  document_kind: string;
  label: string;
  status: AtlasStatus;
  domain: string | null;
  document_version: number | null;
}

export interface CatalogDocument {
  entry: CatalogEntry;
  fingerprint: string | null;
  path: string;
  issues: readonly Issue[];
  variants: readonly Variant[];
  references: readonly Reference[];
  referenced_by: readonly Dependent[];
  impact: number;
}

export interface Facets {
  domain: readonly string[];
  owner: readonly string[];
  status: readonly AtlasStatus[];
  kind: readonly DocumentKind[];
}

export interface CatalogPage {
  provenance: Provenance;
  entries: readonly CatalogEntry[];
  facets: Facets;
}

export interface DocumentPage {
  provenance: Provenance;
  document: CatalogDocument;
}

export interface Unavailable {
  problem: SourceProblem;
  detail: string;
}

const status = oneOf(ATLAS_STATUSES);
const optionalText = nullable(text);
const optionalInteger = nullable(integer);

const provenance = object<Provenance>({
  commit: text,
  read_at: instant,
  freshness: oneOf(FRESHNESS),
  problem: nullable(oneOf(SOURCE_PROBLEMS)),
  detail: optionalText,
});

const entry = object<CatalogEntry>({
  id: text,
  kind: oneOf(DOCUMENT_KINDS),
  label: text,
  domain: optionalText,
  owner: optionalText,
  version: optionalInteger,
  status,
  description: optionalText,
  synonyms: list(text),
  variant_count: integer,
  availability: nullable(object<Availability>({ state: oneOf(AVAILABILITY_STATES), reason: nullable(oneOf(UNRESOLVED_REASONS)) })),
});

const document = object<CatalogDocument>({
  entry,
  fingerprint: optionalText,
  path: text,
  issues: list(object<Issue>({ path: text, node_id: optionalText, code: text, message: text, severity: text })),
  variants: list(
    object<Variant>({
      id: text,
      entity: text,
      mode: text,
      kpi_version: optionalInteger,
      override_count: integer,
      undeclared_count: integer,
      version: optionalInteger,
      owner: optionalText,
      status,
    }),
  ),
  references: list(
    object<Reference>({
      id: text,
      kind: text,
      version: optionalInteger,
      found: boolean,
      document_kind: optionalText,
      label: optionalText,
      status: nullable(status),
      domain: optionalText,
    }),
  ),
  referenced_by: list(
    object<Dependent>({
      id: text,
      kind: text,
      version: optionalInteger,
      document_kind: text,
      label: text,
      status,
      domain: optionalText,
      document_version: optionalInteger,
    }),
  ),
  impact: integer,
});

export const decodeCatalogPage = (value: unknown): CatalogPage =>
  object<CatalogPage>({
    provenance,
    entries: list(entry),
    facets: object<Facets>({ domain: list(text), owner: list(text), status: list(status), kind: list(oneOf(DOCUMENT_KINDS)) }),
  })(value, "catalogue");

export const decodeDocumentPage = (value: unknown): DocumentPage => object<DocumentPage>({ provenance, document })(value, "fiche");

/** Corps d'une réponse 503 : `{"error": {"code": "catalog_unavailable", "problem", "detail"}}`. */
export const decodeUnavailable = (value: unknown): Unavailable =>
  object<{ error: Unavailable & { code: "catalog_unavailable" } }>({
    error: object({ code: oneOf(["catalog_unavailable"] as const), problem: oneOf(SOURCE_PROBLEMS), detail: text }),
  })(value, "réponse").error;
