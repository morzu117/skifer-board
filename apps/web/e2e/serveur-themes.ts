import lireModele from "../../../contracts/page_templates/routes/lire.json" with { type: "json" };
import lireComposant from "../../../contracts/components/routes/lire.json" with { type: "json" };
import historiqueContenu from "../../../contracts/components/routes/historique.json" with { type: "json" };
import diffContenu from "../../../contracts/components/routes/diff.json" with { type: "json" };
import approuverContenu from "../../../contracts/components/routes/approver.json" with { type: "json" };
import usageComposant from "../../../contracts/components/routes/refus-content-in-use.json" with { type: "json" };
import consommateursModeles from "../../../contracts/page_templates/routes/consommateurs.json" with { type: "json" };
import modeles from "../../../contracts/page_templates/routes/lister.json" with { type: "json" };
import composants from "../../../contracts/components/routes/lister.json" with { type: "json" };
import consommateursComposants from "../../../contracts/components/routes/consommateurs.json" with { type: "json" };
import type { Page } from "@playwright/test";
import etabli from "../../../contracts/identite/me-etabli.json" with { type: "json" };
import local from "../../../contracts/identite/me-local.json" with { type: "json" };
import espace from "../../../contracts/espaces/espace.json" with { type: "json" };
import historique from "../../../contracts/themes/routes/historique.json" with { type: "json" };
import reviser from "../../../contracts/themes/routes/reviser.json" with { type: "json" };
import diff from "../../../contracts/themes/routes/diff.json" with { type: "json" };
import approuver from "../../../contracts/themes/routes/approver.json" with { type: "json" };
import utilisation from "../../../contracts/themes/routes/refus-content-in-use.json" with { type: "json" };
import lire from "../../../contracts/themes/routes/lire.json" with { type: "json" };
import creer from "../../../contracts/themes/routes/creer.json" with { type: "json" };
import conflit from "../../../contracts/themes/routes/refus-revision-conflit.json" with { type: "json" };
import liste from "../../../contracts/themes/routes/lister.json" with { type: "json" };
import consommateurs from "../../../contracts/themes/routes/consommateurs.json" with { type: "json" };
import interdit from "../../../contracts/themes/routes/refus-interdit.json" with { type: "json" };
import indisponible from "../../../contracts/themes/routes/refus-index-indisponible.json" with { type: "json" };
import { simulerEspaces, simulerIdentite } from "./aides";

export const THEME_ID = "00000000-0000-4000-8000-000000000001";
export async function servirThemes(page: Page, options: { role?: "admin" | "creator" | "reader"; local?: boolean; empty?: boolean; unreadable?: boolean; consumersFail?: boolean; forbidden?: boolean; previous?: boolean; used?: boolean; approvalConflict?: boolean } = {}) {
  await simulerIdentite(page, options.local ? local : etabli);
  await simulerEspaces(page, { "/api/spaces/finance": { status: 200, body: { ...espace.body, role: options.role ?? "admin", implicit: options.local ?? false } } });
  const inattendues: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/") && !["/api/me", "/api/spaces", "/api/spaces/finance"].includes(path) && !path.startsWith("/api/spaces/finance/themes") && !path.startsWith("/api/spaces/finance/page-templates") && !path.startsWith("/api/spaces/finance/components")) inattendues.push(path);
  });
  const expand = (value: unknown): unknown => JSON.parse(JSON.stringify(value).replaceAll("<uuid>", THEME_ID).replaceAll("<commit>", "a".repeat(40))) as unknown;
  type Saved = { id: string; revision: number; commit: string; state: string; approved_revision: number | null; theme: Record<string, unknown> };
  let saved = expand(options.previous ? reviser.body : lire.body) as Saved;
  if (options.previous) {
    const roles = saved.theme.roles as { marks: Record<string, unknown> };
    roles.marks.series = "ink";
  }
  let removed = false;
  const revisions = new Map<number, Saved>([[saved.revision, structuredClone(saved)]]);
  let conflictNext = false;
  const headers = () => ({ ETag: `"${saved.commit}"` });
  for (const [segment, example, key] of [["page-templates", modeles, "page_templates"], ["components", composants, "components"]] as const) {
    type Content = { id: string; revision: number; commit: string; state: string; approved_revision: number | null; page_template?: Record<string, unknown>; component?: Record<string, unknown> };
    const initial = expand((segment === "page-templates" ? lireModele : lireComposant).body) as Content;
    if (initial.page_template) {
      let counter = 1;
      const unique = (value: unknown): void => { if (Array.isArray(value)) { value.forEach(unique); return; } if (typeof value !== "object" || value === null) return; const obj = value as Record<string, unknown>; if (typeof obj.id === "string") obj.id = `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`; Object.values(obj).forEach(unique); };
      unique(initial.page_template.filters); unique(initial.page_template.layout);
    }
    let saved = structuredClone(initial);
    const versions = new Map<number, Content>([[1, structuredClone(saved)]]);
    let removedContent = false;
    let nextConflict = false;
    await page.route(`**/api/spaces/finance/${segment}**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() === "GET" && path.endsWith(`/${segment}`)) {
        if (options.forbidden) { await route.fulfill({ status: interdit.status, json: interdit.body }); return; }
        const body = expand(example.body) as Record<string, unknown>;
        if (options.empty || removedContent) body[key] = [];
        if (options.unreadable) body.unreadable = 1;
        await route.fulfill({ status: 200, json: body }); return;
      }
      const method = route.request().method();
      if (method === "GET" && path.endsWith(`/${THEME_ID}`)) {
        const rev = new URL(route.request().url()).searchParams.get("revision"); const item = rev === null ? saved : versions.get(Number(rev));
        if (!item) { inattendues.push(path); await route.fulfill({ status: 500 }); return; }
        await route.fulfill({ status: 200, json: item, headers: { ETag: `"${item.commit}"` } }); return;
      }
      if (method === "PUT" && path.endsWith(`/${THEME_ID}`)) {
        const { expected_revision, ...draft } = route.request().postDataJSON() as Record<string, unknown>;
        if (expected_revision !== saved.revision) { inattendues.push("révision attendue incorrecte"); await route.fulfill({ status: 500 }); return; }
        if (nextConflict) { nextConflict = false; await route.fulfill({ status: conflit.status, json: conflit.body }); return; }
        const field = segment === "page-templates" ? "page_template" : "component";
        saved = { ...saved, revision: saved.revision + 1, state: "draft", approved_revision: 1, [field]: { ...saved[field], ...draft } }; versions.set(saved.revision, structuredClone(saved)); nextConflict = true;
        await route.fulfill({ status: 201, json: saved, headers: { ETag: `"${saved.commit}"` } }); return;
      }
      if (method === "GET" && path.endsWith("/history")) {
        const body = expand(historiqueContenu.body) as { current_revision: number; revisions: { revision: number }[] }; const entry = body.revisions[0] as { revision: number };
        body.current_revision = saved.revision; body.revisions = [...versions.keys()].map((revision) => ({ ...entry, revision })); await route.fulfill({ status: 200, json: body }); return;
      }
      if (method === "GET" && path.endsWith("/diff")) { const body = expand(diffContenu.body) as { base: number; other: number }; body.base = saved.approved_revision as number; body.other = saved.revision; await route.fulfill({ status: 200, json: body }); return; }
      if (method === "POST" && path.endsWith("/approvals")) { const body = route.request().postDataJSON() as { revision: number; expected_revision: number }; if (body.revision !== saved.revision || body.expected_revision !== saved.revision) { inattendues.push(path); await route.fulfill({ status: 500 }); return; } saved = { ...saved, state: "approved", approved_revision: saved.revision }; const result = expand(approuverContenu.body) as { approved_revision: number }; result.approved_revision = saved.revision; await route.fulfill({ status: 201, json: result }); return; }
      if (method === "DELETE" && path.endsWith(`/${THEME_ID}`)) { if (Number(new URL(route.request().url()).searchParams.get("expected_revision")) !== saved.revision) { inattendues.push(path); await route.fulfill({ status: 500 }); return; } if (options.used && segment === "components") { const body = expand(usageComposant.body) as { error: { others: number } }; body.error.others = 2; await route.fulfill({ status: 409, json: body }); return; } removedContent = true; await route.fulfill({ status: 204 }); return; }
      if (segment === "page-templates" && route.request().method() === "GET" && path.endsWith(`/${THEME_ID}/consumers`)) {
        inattendues.push(path); await route.fulfill({ status: 200, json: expand(consommateursModeles.body) }); return;
      }
      if (segment === "components" && route.request().method() === "GET" && path.endsWith(`/${THEME_ID}/consumers`)) {
        await route.fulfill(options.consumersFail ? { status: indisponible.status, json: indisponible.body } : { status: 200, json: expand(consommateursComposants.body) }); return;
      }
      inattendues.push(path); await route.fulfill({ status: 500 });
    });
  }
  await page.route("**/api/spaces/finance/themes**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (method === "POST" && path.endsWith("/themes")) {
      const draft = route.request().postDataJSON() as Record<string, unknown>;
      saved = expand(creer.body) as Saved;
      saved.theme = { ...saved.theme, ...draft };
      revisions.clear(); revisions.set(1, structuredClone(saved));
      await route.fulfill({ status: 201, json: saved, headers: headers() }); return;
    }
    if (method === "PUT" && path.endsWith(`/themes/${THEME_ID}`)) {
      const { expected_revision, ...draft } = route.request().postDataJSON() as Record<string, unknown>;
      if (expected_revision !== saved.revision) { inattendues.push("révision attendue incorrecte"); await route.fulfill({ status: 500 }); return; }
      if (conflictNext) { conflictNext = false; await route.fulfill({ status: conflit.status, json: conflit.body }); return; }
      saved = { ...saved, revision: saved.revision + 1, state: "draft", theme: { ...saved.theme, ...draft } };
      revisions.set(saved.revision, structuredClone(saved));
      await route.fulfill({ status: 201, json: saved, headers: headers() }); return;
    }
    if (method === "POST" && path.endsWith(`/themes/${THEME_ID}/approvals`)) {
      const body = route.request().postDataJSON() as { revision: number; expected_revision: number };
      if (body.revision !== saved.revision || body.expected_revision !== saved.revision) { inattendues.push("approbation : révision incorrecte"); await route.fulfill({ status: 500 }); return; }
      if (options.approvalConflict) { await route.fulfill({ status: conflit.status, json: conflit.body }); return; }
      saved = { ...saved, state: "approved", approved_revision: saved.revision };
      const result = expand(approuver.body) as { approved_revision: number };
      result.approved_revision = saved.revision;
      await route.fulfill({ status: 201, json: result }); return;
    }
    if (method === "DELETE" && path.endsWith(`/themes/${THEME_ID}`)) {
      if (Number(new URL(route.request().url()).searchParams.get("expected_revision")) !== saved.revision) { inattendues.push("suppression : révision incorrecte"); await route.fulfill({ status: 500 }); return; }
      if (options.used) { const body = expand(utilisation.body) as { error: { others: number } }; body.error.others = 2; await route.fulfill({ status: 409, json: body }); return; }
      removed = true; await route.fulfill({ status: 204 }); return;
    }
    if (method !== "GET") { inattendues.push(route.request().url()); await route.fulfill({ status: 500 }); return; }
    if (path.endsWith(`/themes/${THEME_ID}/diff`)) {
      const url = new URL(route.request().url());
      if (Number(url.searchParams.get("from")) !== saved.approved_revision || Number(url.searchParams.get("to")) !== saved.revision) { inattendues.push("diff : révisions incorrectes"); await route.fulfill({ status: 500 }); return; }
      const body = expand(diff.body) as { base: number; other: number; changes: unknown[] };
      body.base = saved.approved_revision; body.other = saved.revision;
      body.changes = [{ path: "/roles/marks/series", kind: "modified", node: null, id: null, before: "blue", after: "ink" }];
      await route.fulfill({ status: 200, json: body }); return;
    }
    if (path.endsWith(`/themes/${THEME_ID}/history`)) {
      const template = expand(historique.body) as { id: string; current_revision: number; deleted: boolean; revisions: { revision: number }[] };
      const entry = template.revisions[0] as { revision: number };
      template.current_revision = saved.revision;
      template.revisions = [...revisions.keys()].map((revision) => ({ ...entry, revision }));
      await route.fulfill({ status: 200, json: template }); return;
    }
    if (path.endsWith(`/themes/${THEME_ID}`)) {
      const number = new URL(route.request().url()).searchParams.get("revision");
      const result = number === null ? saved : revisions.get(Number(number));
      if (result === undefined) { inattendues.push(`révision inconnue ${number}`); await route.fulfill({ status: 404 }); return; }
      await route.fulfill({ status: 200, json: result, headers: { ETag: `"${result.commit}"` } }); return;
    }
    if (path.endsWith("/consumers")) { await route.fulfill(options.consumersFail ? { status: indisponible.status, json: indisponible.body } : { status: 200, json: expand(consommateurs.body) }); return; }
    if (path.endsWith("/themes")) { if (options.forbidden) { await route.fulfill({ status: interdit.status, json: interdit.body }); return; } const body = expand(liste.body) as { themes: Record<string, unknown>[]; unreadable: number }; if (options.empty || removed) body.themes = []; else body.themes = body.themes.map((entry) => ({ ...entry, name: saved.theme.name, revision: saved.revision, commit: saved.commit, state: saved.state, approved_revision: saved.approved_revision })); if (options.unreadable) body.unreadable = 1; await route.fulfill({ status: 200, json: body }); return; }
    inattendues.push(path); await route.fulfill({ status: 500 });
  });
  return { inattendues, conflictOnNextSave: () => { conflictNext = true; } };
}
