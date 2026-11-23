import type { Page } from "@playwright/test";
import { DASHBOARD_ID, entreeDashboard, pageDe, servirDashboards, uuid, visuel } from "./serveur-dashboards";
import tokens from "../../../contracts/themes/tokens.v1.json" with { type: "json" };
import themeCreated from "../../../contracts/themes/routes/creer.json" with { type: "json" };
import templateCreated from "../../../contracts/page_templates/routes/creer.json" with { type: "json" };
import componentCreated from "../../../contracts/components/routes/creer.json" with { type: "json" };
import themeList from "../../../contracts/themes/routes/lister.json" with { type: "json" };
import templateList from "../../../contracts/page_templates/routes/lister.json" with { type: "json" };
import componentList from "../../../contracts/components/routes/lister.json" with { type: "json" };
import conflict from "../../../contracts/themes/routes/refus-revision-conflit.json" with { type: "json" };
import invalid from "../../../contracts/themes/routes/refus-invalide.json" with { type: "json" };
import forbidden from "../../../contracts/themes/routes/refus-interdit.json" with { type: "json" };
import approval from "../../../contracts/themes/routes/approver.json" with { type: "json" };
import approvalsExample from "../../../contracts/themes/routes/approbations.json" with { type: "json" };
import history from "../../../contracts/themes/routes/historique.json" with { type: "json" };
import inUse from "../../../contracts/themes/routes/refus-content-in-use.json" with { type: "json" };
import unapproved from "../../../contracts/dashboards/routes/refus-reference-non-approuvee.json" with { type: "json" };
import me from "../../../contracts/identite/me-etabli.json" with { type: "json" };
import space from "../../../contracts/espaces/espace.json" with { type: "json" };
import spaces from "../../../contracts/espaces/liste.json" with { type: "json" };

type Identity = "createur" | "admin" | "autre";
type Kind = "themes" | "page-templates" | "components";
type Item = { id: string; owner: string; versions: Record<string, unknown>[]; approved: number | null; approvals: Set<number> };
const SUBJECTS: Record<Identity, string> = { createur: "00u1a2b3c4", admin: "admin", autre: "autre" };
const ISSUER = "https://id.example.invalid";
const COMMIT = "a".repeat(40);
const templates = { themes: themeCreated, "page-templates": templateCreated, components: componentCreated };
const lists = { themes: themeList, "page-templates": templateList, components: componentList };
const field = { themes: "theme", "page-templates": "page_template", components: "component" } as const;
const key = { themes: "themes", "page-templates": "page_templates", components: "components" } as const;
const version = { themes: "board.theme/v1", "page-templates": "board.page_template/v1", components: "board.component/v1" } as const;
const expand = (value: unknown, id: string): unknown => JSON.parse(JSON.stringify(value).replaceAll("<uuid>", id).replaceAll("<commit>", COMMIT)) as unknown;

function validateTokens(value: Record<string, unknown>) {
  const draft = value as { base: keyof typeof tokens.bases; roles: { marks: Record<string, string>; text: Record<string, string> }; categorical: string[]; sequential: string[]; diverging: string[] };
  const catalog = tokens.bases[draft.base];
  const problems = [
    ...Object.entries(draft.roles.marks).filter(([, token]) => !Object.hasOwn(catalog.mark, token)).map(([name]) => ({ path: `/roles/marks/${name}`, rule: "token_not_admissible" })),
    ...Object.entries(draft.roles.text).filter(([, token]) => !Object.hasOwn(catalog.text, token)).map(([name]) => ({ path: `/roles/text/${name}`, rule: "token_not_admissible" })),
  ];
  for (const palette of ["categorical", "sequential", "diverging"] as const) {
    draft[palette].forEach((token, i, all) => {
      const required = palette === "categorical" || (palette === "sequential" && i === all.length - 1) || (palette === "diverging" && (i === 0 || i === all.length - 1));
      if (!Object.hasOwn(tokens.luminance, token) || (required && !Object.hasOwn(catalog.mark, token))) problems.push({ path: `/${palette}/${String(i)}`, rule: "token_not_admissible" });
    });
  }
  return problems.sort((a, b) => a.path.localeCompare(b.path));
}

type Change = { path: string; kind: "added" | "removed" | "modified"; node: null; id: null; before: unknown; after: unknown };
function changes(before: unknown, after: unknown, path = ""): Change[] {
  if (Array.isArray(before) && Array.isArray(after)) {
    return Array.from({ length: Math.max(before.length, after.length) }, (_, i) => i >= before.length
      ? [{ path: `${path}/${String(i)}`, kind: "added" as const, node: null, id: null, before: null, after: after[i] }]
      : i >= after.length ? [{ path: `${path}/${String(i)}`, kind: "removed" as const, node: null, id: null, before: before[i], after: null }]
        : changes(before[i], after[i], `${path}/${String(i)}`)).flat();
  }
  if (before !== null && after !== null && typeof before === "object" && typeof after === "object" && !Array.isArray(before) && !Array.isArray(after)) {
    const left = before as Record<string, unknown>; const right = after as Record<string, unknown>;
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort().flatMap((name) => {
      const next = `${path}/${name}`;
      if (!Object.hasOwn(left, name)) return [{ path: next, kind: "added" as const, node: null, id: null, before: null, after: right[name] }];
      if (!Object.hasOwn(right, name)) return [{ path: next, kind: "removed" as const, node: null, id: null, before: left[name], after: null }];
      return changes(left[name], right[name], next);
    });
  }
  return Object.is(before, after) ? [] : [{ path, kind: "modified", node: null, id: null, before, after }];
}

/** Simulateur commun des contenus ; le simulateur du plan 19 fournit dashboards, analyses et exécutions. */
export async function servirPlan20(page: Page) {
  const composants: Record<string, string> = {};
  const initial = pageDe("Pilotage", [visuel(uuid(31), uuid(21), { title: "Ventes" })], { visibility: "personal" });
  const docs = new Map<string, Record<string, unknown>>([[DASHBOARD_ID, initial as unknown as Record<string, unknown>]]);
  const owners = new Map<string, string>([[DASHBOARD_ID, SUBJECTS.createur]]);
  let identity: Identity = "createur";
  const dashboard = await servirDashboards(page, { role: "creator", dashboards: [entreeDashboard(DASHBOARD_ID, initial, { proprietaire: SUBJECTS.createur })], analyses: { [uuid(21)]: { nom: "Ventes" } }, composants, acteur: () => SUBJECTS[identity], identifiants: Array.from({ length: 20 }, (_value, index) => uuid(200 + index)), onWrite: (id, document) => { docs.set(id, document as unknown as Record<string, unknown>); if (!owners.has(id)) owners.set(id, SUBJECTS[identity]); } });
  let next = 1;
  const contents: Record<Kind, Map<string, Item>> = { themes: new Map(), "page-templates": new Map(), components: new Map() };
  const bodies: { method: string; path: string; body: unknown; brut: string | null }[] = [];
  const journal = { inattendues: dashboard.journal.inattendues, corps: bodies };
  const snapshot = (kind: Kind, item: Item, revision = item.versions.length) => {
    const raw = expand(templates[kind].body, item.id) as Record<string, unknown>;
    const doc = item.versions[revision - 1];
    return { ...raw, revision, state: item.approvals.has(revision) ? "approved" : "draft", approved_revision: item.approved, revised_by: { issuer: ISSUER, subject: item.owner }, [field[kind]]: doc };
  };
  const visible = (item: Item, revision: number) => identity === "admin" || item.owner === SUBJECTS[identity] || item.approvals.has(revision);
  await page.route("**/api/me", (route) => route.fulfill({ json: { ...me.body, identity: { ...me.body.identity, subject: SUBJECTS[identity] } } }));
  await page.route("**/api/spaces", (route) => route.fulfill({ json: { ...spaces.body, spaces: spaces.body.spaces.map((s) => s.id === "finance" ? { ...s, role: identity === "admin" ? "admin" : "creator" } : s) } }));
  await page.route("**/api/spaces/finance", (route) => route.fulfill({ json: { ...space.body, role: identity === "admin" ? "admin" : "creator" } }));
  await page.route("**/api/spaces/finance/**", async (route) => {
    const req = route.request(); const url = new URL(req.url()); const path = url.pathname; const method = req.method();
    const body = method === "POST" || method === "PUT" ? req.postDataJSON() as Record<string, unknown> : null;
    if (body !== null) bodies.push({ method, path, body: structuredClone(body), brut: req.postData() });
    const match = /^\/api\/spaces\/finance\/(themes|page-templates|components)(?:\/([^/]+))?(?:\/(history|diff|approvals|consumers))?$/.exec(path);
    if (!match) {
      const dash = /^\/api\/spaces\/finance\/dashboards(?:\/([^/]+)\/revisions)?$/.exec(path);
      if (dash && method === "POST" && body !== null) {
        const refs: { kind: Kind; id: string; revision: number; path: string }[] = [];
        const walk = (value: unknown, at: string): void => {
          if (Array.isArray(value)) { value.forEach((child, i) => { walk(child, `${at}/${String(i)}`); }); return; }
          if (!value || typeof value !== "object") return;
          const obj = value as Record<string, unknown>;
          if (obj.type === "slot") refs.push({ kind: "page-templates", id: "slot", revision: 0, path: at });
          if (typeof obj.theme_id === "string" && typeof obj.revision === "number") refs.push({ kind: "themes", id: obj.theme_id, revision: obj.revision, path: at });
          if (obj.type === "component" && obj.component && typeof obj.component === "object") { const ref = obj.component as { component_id: string; revision: number }; refs.push({ kind: "components", id: ref.component_id, revision: ref.revision, path: at }); }
          Object.entries(obj).forEach(([name, child]) => { walk(child, `${at}/${name}`); });
        };
        walk(body, "");
        const slot = refs.find((ref) => ref.id === "slot");
        if (slot) { await route.fulfill({ status: 422, json: { error: { code: "invalid_dashboard", reason: "schema_violation", violations: [{ path: slot.path, rule: "schema_violation" }] } } }); return; }
        const owner = dash[1] === undefined ? SUBJECTS[identity] : owners.get(dash[1]);
        const missing = refs.filter((ref) => { const found = contents[ref.kind].get(ref.id); return !found || !found.versions[ref.revision - 1] || (!found.approvals.has(ref.revision) && found.owner !== owner); });
        if (missing.length) { const violations = missing.map((ref) => ({ path: ref.path, rule: ref.kind === "themes" ? "theme_not_found" : "component_not_found" })); await route.fulfill({ status: 422, json: { error: { code: "invalid_dashboard", reason: violations[0]?.rule, violations } } }); return; }
        const denied = body.visibility === "shared" ? refs.filter((ref) => !contents[ref.kind].get(ref.id)?.approvals.has(ref.revision)) : [];
        if (denied.length) { await route.fulfill({ status: unapproved.status, json: { error: { ...unapproved.body.error, paths: denied.map((ref) => ref.path) } } }); return; }
        await route.fallback(); return;
      }
      await route.fallback(); return;
    }
    const kind = match[1] as Kind; const id = match[2]; const action = match[3]; const map = contents[kind]; const item = id ? map.get(id) : undefined;
    const respond = async (status: number, json: unknown) => route.fulfill({ status, json, headers: { ETag: `"${COMMIT}"` } });
    if (!id && method === "GET") {
      const source = lists[kind].body[key[kind] as keyof typeof lists[typeof kind]["body"]] as unknown as Record<string, unknown>[];
      const rows = [...map.values()].flatMap((one) => {
        const n = visible(one, one.versions.length) ? one.versions.length : one.approved;
        if (n === null || !visible(one, n)) return [];
        const doc = one.versions[n - 1] as Record<string, unknown>;
        return [{ ...expand(source[0], one.id) as object, name: doc.name, owner: doc.owner, revision: n, state: one.approvals.has(n) ? "approved" : "draft", approved_revision: one.approved }];
      });
      await respond(200, { [key[kind]]: rows, unreadable: 0 }); return;
    }
    if (!id && method === "POST" && body !== null) {
      if (kind === "themes") {
        const problems = validateTokens(body);
        if (problems.length) { await respond(invalid.status, { error: { ...invalid.body.error, reason: problems[0]?.rule, violations: problems } }); return; }
      }
      const newId = uuid(next++); const owner = SUBJECTS[identity];
      const doc: Record<string, unknown> = { ...body, api_version: version[kind], id: newId, owner: { issuer: ISSUER, subject: owner } };
      const created: Item = { id: newId, owner, versions: [doc], approved: null, approvals: new Set() }; map.set(newId, created);
      if (kind === "components" && typeof (doc.analysis as { analysis_id?: unknown } | undefined)?.analysis_id === "string") composants[`${newId}:1`] = (doc.analysis as { analysis_id: string }).analysis_id;
      await respond(201, snapshot(kind, created)); return;
    }
    if (!item || !id) { await respond(404, { error: { code: `${field[kind]}_not_found` } }); return; }
    const latestVisible = visible(item, item.versions.length) ? item.versions.length : item.approved;
    const n = Number(url.searchParams.get("revision") ?? latestVisible ?? 0);
    if (method === "POST" && action === "approvals" && identity !== "admin") { await respond(forbidden.status, forbidden.body); return; }
    if (latestVisible === null || !visible(item, action ? latestVisible : n)) { await respond(404, { error: { code: `${field[kind]}_not_found` } }); return; }
    if (method === "GET" && !action) {
      if (!item.versions[n - 1] || !visible(item, n)) { await respond(404, { error: { code: `${field[kind]}_not_found` } }); return; }
      await respond(200, snapshot(kind, item, n)); return;
    }
    if (method === "PUT" && !action && body !== null) {
      if (body.expected_revision !== item.versions.length) { await respond(conflict.status, conflict.body); return; }
      const draft = { ...body }; delete draft.expected_revision;
      if (kind === "themes") { const problems = validateTokens({ ...item.versions.at(-1), ...draft }); if (problems.length) { await respond(invalid.status, { error: { ...invalid.body.error, reason: problems[0]?.rule, violations: problems } }); return; } }
      if (identity !== "admin" && item.owner !== SUBJECTS[identity]) { await respond(403, { error: { code: "not_owner" } }); return; }
      const updated = { ...item.versions.at(-1), ...draft }; item.versions.push(updated);
      if (kind === "components" && typeof (updated.analysis as { analysis_id?: unknown } | undefined)?.analysis_id === "string") composants[`${id}:${String(item.versions.length)}`] = (updated.analysis as { analysis_id: string }).analysis_id;
      await respond(201, snapshot(kind, item)); return;
    }
    if (method === "POST" && action === "approvals" && body !== null) {
      if (body.expected_revision !== item.versions.length || body.revision !== item.versions.length) { await respond(conflict.status, conflict.body); return; }
      item.approved = item.versions.length; item.approvals.add(item.approved); await respond(201, { ...expand(approval.body, id) as object, approved_revision: item.approved }); return;
    }
    if (method === "GET" && action === "approvals") {
      const example = expand(approvalsExample.body, id) as typeof approvalsExample.body;
      await respond(200, { id, approvals: [...item.approvals].filter((revision) => visible(item, revision)).map((revision) => ({ ...example.approvals[0], revision, approver: { issuer: ISSUER, subject: SUBJECTS.admin } })) }); return;
    }
    if (method === "GET" && action === "history") {
      const example = expand(history.body, id) as typeof history.body;
      await respond(200, { ...example, current_revision: latestVisible, revisions: item.versions.flatMap((_v, i) => visible(item, i + 1) ? [{ ...example.revisions[0], revision: i + 1 }] : []) }); return;
    }
    if (method === "GET" && action === "diff") {
      const base = Number(url.searchParams.get("from")); const other = Number(url.searchParams.get("to"));
      const before = item.versions[base - 1]; const after = item.versions[other - 1];
      if (!before || !after || !visible(item, base) || !visible(item, other)) { await respond(404, { error: { code: `${field[kind]}_not_found` } }); return; }
      await respond(200, { id, base, other, changes: changes(before, after) }); return;
    }
    const refers = (value: unknown): boolean => {
      if (Array.isArray(value)) return value.some(refers);
      if (value === null || typeof value !== "object") return false;
      const obj = value as Record<string, unknown>;
      return (kind === "themes" && obj.theme_id === id && obj.revision === (method === "DELETE" ? item.versions.length : latestVisible)) || (kind === "components" && obj.component_id === id && obj.revision === (method === "DELETE" ? item.versions.length : latestVisible)) || Object.values(obj).some(refers);
    };
    const dependent = [...docs].filter(([, doc]) => refers(doc));
    const shown = dependent.filter(([dashboardId, doc]) => owners.get(dashboardId) === SUBJECTS[identity] || doc.visibility === "shared");
    const consumers = shown.map(([dashboardId]) => ({ kind: "dashboard", id: dashboardId }));
    const others = dependent.length - shown.length;
    if (method === "GET" && action === "consumers") { await respond(200, { id, consumers, others }); return; }
    if (method === "DELETE" && !action) {
      if (identity !== "admin" && item.owner !== SUBJECTS[identity]) { await respond(403, { error: { code: "not_owner" } }); return; }
      if (Number(url.searchParams.get("expected_revision")) !== item.versions.length) { await respond(conflict.status, conflict.body); return; }
      if (dependent.length && kind !== "page-templates") { await respond(inUse.status, { error: { ...inUse.body.error, consumers, others } }); return; }
      map.delete(id); await route.fulfill({ status: 204 }); return;
    }
    journal.inattendues.push(`${method} ${path}`); await route.abort();
  });
  return { journal, identite: (nextIdentity: Identity) => { identity = nextIdentity; }, dashboard, contents };
}
