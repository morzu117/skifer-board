# Attendus côté skifer pour skifer-board

Date : 2026-09-13. Ce document liste ce que skifer-board **attend** de skifer, tel que constaté en
lisant `../skifer` à cette date (CLAUDE.md, `agentic/data_service.py`, `agentic/resolver.py`,
`semantic/evidence.py`, `services/context.py`, `api/routes/`). Il sert d'entrée au plan
`docs/roadmap/35B_*` côté skifer (35 est déjà pris par le câblage gouvernance), qui sera écrit **à partir de ces besoins réels**.

⚠️ Rien ici ne doit être démarré dans `../skifer` sans accord explicite : un autre chantier y est
en cours sur une autre machine.

Chaque attendu porte un identifiant `SK-xx` référencé par la [roadmap du board](00_roadmap.md),
une priorité (**B** = bloquant pour une phase du board, **S** = souhaitable), et la phase du board
qu'il débloque.

---

## Ce qui existe déjà et que le board consomme tel quel

| Brique skifer | Usage par le board |
|---|---|
| `AgentReadyDataService` (`list_models`, `get_model`, `get_contract`, `get_certification`, `get_lineage`, `query`) | Unique frontière. Le board n'appelle rien d'autre. |
| `SemanticQuery` (`model_name`, `metrics`, `group_by`, `filters`, `date_from`, `date_to`, `period`) | Forme d'une tuile, d'une exploration, d'une réponse d'agent. |
| `SemanticEvidence.to_dict()` (redigée) : `evidence_id`, `sql_hash`, `metrics[].definition_hash`, `sources[].definition_hash`, `certification_status`, `data_age_seconds`, `policy` | Pied de provenance, clé de cache, invalidation. |
| `ConsumerContext` / `RequestContext`, scopes `models:read`, `contracts:read`, `lineage:read`, `query:execute` | Le board transmet, ne fabrique jamais. |
| `ServiceLimits` (page 100, lignes 1 000, 50 filtres, valeur 1 024 caractères) | Plafonds respectés côté client ; voir `SK-02.4` pour les tables. |
| Gate de certification `off | warn | enforce | supervised`, décisions `ALLOW/WARN/DENY/REQUIRE_HUMAN` | Rendues telles quelles, jamais contournées. |
| API loopback `[api]` : `GET /catalog`, `GET /catalog/{key}`, `POST /semantic/query`, `GET /certifications/{dataset}`, `GET /contracts/…`, `GET /me`, `POST /agents/ask` | Base du contrat `SK-02`, mais loopback et identité locale seulement aujourd'hui. |
| MCP read-only (`query_semantic_model`, opérateurs `eq neq gt lt gte lte in like is_null is_not_null`) | Référence de vocabulaire des filtres pour l'explorateur. |
| `adaptive/models.py` `SemanticUsageEvent` | Cible des événements d'usage du board (`SK-04`). |
| `agentic/exporter.py` (PDF fpdf2), `observability/alerts.py` (`AlertDispatcher`) | Réutilisation en phase 5 (`SK-06`). |

---

## SK-01 — Backend d'exécution sans Spark  **[B — phase 2 prod]**

**Constat.** `AgentReadyDataService.query()` appelle `semantic_engine.query_with_evidence()` qui
renvoie un DataFrame Spark puis `.collect()`. Le board ne peut pas embarquer Spark, et une API
de dashboards ne peut pas payer un démarrage de session Spark par requête.

**Attendu.**
1. Un backend d'exécution sélectionnable par configuration, sans changer l'API du service :
   - **prod** : Databricks SQL warehouse via Statement Execution API (déjà utilisée pour les MV,
     `params.sql_warehouse_id`) ;
   - **local / petite instance** : DuckDB + delta-rs.
2. Le SQL produit par `QueryResolver` est du Spark SQL : transpilation de dialecte (sqlglot, MIT)
   vers `databricks` / `duckdb`, **avec tests de non-régression** : pour chaque exemple de
   `examples/`, le SQL transpilé renvoie les mêmes lignes que Spark local.
3. `sql_hash` reste calculé sur le SQL **canonique avant transpilation** afin que la clé de cache
   du board soit identique quel que soit le backend. Si ce n'est pas possible, l'evidence doit
   exposer le dialecte (`execution_dialect`) pour que le board l'ajoute à sa clé.
4. Latence cible pour une requête agrégée simple sur warehouse chaud : < 2 s. Le board affichera
   `execution_duration_seconds` ; c'est un indicateur, pas un SLA à ce stade.

**Ce que le board fait en attendant.** Mock skifer (F1.4) ; développement des phases 2–3 hors prod.

---

## SK-02 — API REST publique sur `AgentReadyDataService`  **[B — phases 2, 3]**

**Constat.** L'API `[api]` est loopback, à identité locale statique, avec des routes CRUD pipeline
et jobs inutiles au board. Le board a besoin d'une surface **réseau**, **authentifiée**, réduite
au service gouverné.

**Attendu.**

### SK-02.1 Surface

Une seule surface, versionnée (`/api/v1`), n'exposant rien d'autre que `AgentReadyDataService` :

| Méthode | Route | Service | Scope |
|---|---|---|---|
| GET | `/api/v1/models?cursor&limit` | `list_models` | `models:read` |
| GET | `/api/v1/models/{key}` | `get_model` | `models:read` |
| GET | `/api/v1/contracts/{contract_id}/{version}` | `get_contract` | `contracts:read` |
| GET | `/api/v1/certifications/{dataset}` | `get_certification` | `contracts:read` |
| GET | `/api/v1/lineage/{dataset}/{column}` | `get_lineage` | `lineage:read` |
| POST | `/api/v1/query?limit` | `query` | `query:execute` |
| GET | `/api/v1/me` | identité résolue (subject, consumer_class, scopes) | aucun |
| GET | `/api/v1/health` | constante figée, sans donnée métier (comme MCP) | aucun |

Les routes `pipelines`, `jobs`, `rules`, `incidents`, `semantic/write-draft|promote` ne doivent
**pas** être atteignables depuis cette surface (soit un second `app`, soit un préfixe exclu par
configuration).

### SK-02.2 Corps de `POST /query`

Le JSON Schema **fermé** du MCP (`mcp/tools.py`) est réutilisé tel quel : `model`, `metrics`,
`group_by`, `filters[{column, operator, value}]`, `date_from`, `date_to`, `period`, `limit`. Le
board n'enverra jamais `mode`, `view_name`, `explanation`, `response_format`.

### SK-02.3 Réponse de `POST /query`

`QueryEnvelope.to_dict()` : `{rows, evidence, truncated}` en JSON, plus :
- `columns: [{name, logical_type}]` dans l'ordre du SELECT (le board ne doit pas inférer les
  types depuis la première ligne ; une colonne peut être toute nulle) ;
- **Arrow IPC** en option (`Accept: application/vnd.apache.arrow.stream`), evidence dans un en-tête
  ou dans le schema metadata. Souhaitable, pas bloquant : JSON suffit en phase 2.

### SK-02.4 Limites

`HARD_MAX_QUERY_ROWS = 1 000` convient aux graphiques, pas aux tuiles `table` ni aux exports CSV.
Attendu : un plafond distinct configurable par `consumer_class` (par ex. 50 000 pour
`dashboard`, 1 000 pour `agent_read`), toujours borné en dur côté skifer. Le board respecte
`truncated` et ne pagine pas les résultats de requête.

### SK-02.5 Erreurs

Mapping HTTP **stable et documenté**, avec un corps JSON `{error: {type, message, reasons?,
recommended_action?}}` où `type` reprend les noms Python (`ScopeDenied`, `InvalidRequest`,
`LimitExceeded`, `InvalidCursor`, `ResourceNotFound`, `ResourceUnavailable`,
`SemanticAccessDenied`, `SemanticQueryError`). Pour `SemanticAccessDenied` : `decision`, `reasons`
(`MISSING`, `FAILED_CHECK`, `EXPIRED`, `OVERRIDDEN`…), `evaluated_at`, `recommended_action`,
tels que l'exception les porte déjà. Pour `SemanticQueryError` : la liste `Disponible : […]` que
le resolver produit déjà, en champ structuré `suggestions`.

### SK-02.6 Authentification

Bearer vérifié par un **vérificateur injecté** (même principe que `mcp/auth.py`), jamais de scope
lu dans le corps de la requête. Le bind non-loopback est autorisé pour cette surface **uniquement**
si un vérificateur est configuré ; sinon erreur au démarrage.

### SK-02.7 Suite de tests de contrat partagée

Un paquet `skifer-api-contract-tests` (ou un dossier `tests/contract/` exportable) qui joue le
même scénario contre n'importe quelle base URL : catalogue, requête simple, requête avec jointure,
`DENY` expiré, `WARN`, limite dépassée, curseur invalide. Le board l'exécute contre son mock,
skifer contre son API. C'est la parade principale à la dérive mock ↔ réel.

---

## SK-03 — Tri et top-N dans `SemanticQuery`  **[B — phase 3]**

**Constat.** `SemanticQuery` n'a ni `order_by` ni `limit` sémantique ; la limite est un paramètre
de service appliqué **après** exécution (`dataframe.limit(limit + 1)`). Un « top 10 clients par
CA » n'est donc pas exprimable : le board recevrait 10 lignes arbitraires.

**Attendu.**
- `order_by: [{name, direction}]` où `name` ∈ `metrics ∪ group_by` (noms uniquement, validés par
  le resolver comme les autres), et `limit` transmis au SQL (`ORDER BY … LIMIT n`).
- Ajout **additif** : `SemanticQuery` garde ses valeurs par défaut, `QueryResolver` produit le
  même SQL qu'avant en l'absence de ces champs. Reflété dans le JSON Schema MCP et l'evidence
  (`normalized_order_by`).
- Souhaitable : comparaison de période (`compare_to: previous_period`) résolue par le calendrier
  versionné, pour les KPI « vs N-1 ». Sinon le board fera deux requêtes.

---

## SK-04 — Ingestion des événements d'usage du board  **[S — transverse, Adaptive Gold]**

**Constat.** Les stores `adaptive/store.py` sont append-only et alimentés par le moteur. Le board
sera la première source de volume (chaque tuile rendue, chaque exploration).

**Attendu.**
- `POST /api/v1/usage-events` acceptant un lot de `SemanticUsageEvent` (fingerprint versionné
  inchangé), scope dédié `usage:write`, sans aucune valeur de donnée, avec `evidence_id` comme
  clé de corrélation.
- Ou, alternative sans nouvelle route : skifer enregistre lui-même un événement à chaque
  `query()` de `AgentReadyDataService` avec `consumer_class` et un champ libre `surface`
  (`dashboard:<slug>/<tile>`, `explore`, `chat`) transmis par le board dans un en-tête. Cette
  seconde option est préférée : moins de surface, pas de double comptage.

---

## SK-05 — Endpoint agent utilisable par le board  **[B — phase 4]**

**Constat.** `POST /agents/ask` existe (`services/agents.py`, résultats allowlistés) mais le board
a besoin de la `SemanticQuery` **en clair** dans la réponse, pas seulement du texte formaté.

**Attendu.**
- Réponse structurée : `{answer_text, semantic_query, evidence, response_format, explanation,
  rows?}` avec `semantic_query` conforme à `SK-02.2` (donc directement épinglable).
- Le LLM est configuré **côté skifer** ; le board n'a ni clé ni fournisseur. Sessions
  (`SessionHistory`) identifiées par `subject` + `session_id` fourni par le board.
- Mode « plan sans exécuter » (`dry_run: true`) : renvoyer la `SemanticQuery` et l'evidence
  compilée (SQL non exécuté, `execution_status: pending`) pour que l'utilisateur relise avant
  d'exécuter. Utile aussi pour la validation F2.3 à coût nul.

---

## SK-06 — Réutilisation des briques de reporting  **[S — phase 5]**

- `AlertDispatcher` (webhook, Slack, e-mail, Teams, Google Chat) : soit extrait dans un paquet
  léger importable sans pyspark (le board est en Python, la dépendance serait naturelle), soit
  le board le duplique. Préférence : extraction, mais seulement si le paquet reste sans dépendance
  Spark ni engine. À trancher avec le plan 35B.
- `HistoryExporter` (PDF fpdf2) : moins utile, le board rend en headless (Playwright). Pas d'attendu.

---

## SK-07 — Modèles sémantiques template pour les KPI packs  **[B — phase 6]**

**Constat.** Un KPI pack = un modèle sémantique template + des dashboards. Le modèle sémantique
vit côté skifer (`semantic_models/`), pas côté board.

**Attendu.**
- Un format de **modèle template** : un modèle sémantique dont les `sql:` sont des placeholders
  nommés (`{{ revenue_column }}`), instancié par `skifer semantic instantiate <template> --map …`
  en un modèle réel qui passe `SemanticValidator`.
- Le board livre la partie dashboards/explorations/alertes du pack et l'assistant de mapping ;
  skifer livre le template et son instanciation. Le pack référence la version du template.

---

## SK-08 — Identité utilisateur, identités de service, RLS  **[B — phase 5 prod, T1]**

**Constat.** `LocalIdentity` dérive le sujet de l'OS et accorde tous les scopes locaux ; aucun
mapping SSO, aucune row-level security.

**Attendu.**
1. **Vérificateur de bearer** (OIDC / JWT) côté API `SK-02.6`, produisant un `RequestContext`
   avec `subject`, `consumer_class` et scopes issus des **claims** (ou d'une table de mapping
   groupes → scopes en configuration), jamais du corps de la requête.
2. **Identités de service** : `consumer_class` dédiées (`scheduled_report`, `alert`) avec bearer de
   service, sans `certification_override`, pour le scheduler du board.
3. **Row-level security** : filtres obligatoires par `subject`/groupe déclarés dans le modèle
   sémantique (par ex. `row_policies: [{dimension: region, from_claim: allowed_regions}]`),
   injectés par le planner **avant** compilation et visibles dans l'evidence
   (`normalized_filters` avec `origin: policy`). Le board ne pose jamais ces filtres lui-même et
   n'affiche jamais une tuile dont la policy n'a pas pu être résolue (fail-closed).

---

## SK-09 — Signaux de changement pour l'invalidation  **[S — phase 2]**

**Constat.** Le board invalide son cache en comparant les hashs de définition renvoyés par
l'evidence, ce qui suppose d'appeler skifer pour le savoir.

**Attendu (souhaitable).** `GET /api/v1/models/{key}` expose `definition_hash` du modèle et
`sources[].definition_hash` sans exécuter de requête, pour une vérification de fraîcheur peu
coûteuse avant de servir depuis le cache. Idéalement, `ETag` sur cette route.

---

## Récapitulatif par phase du board

| Phase board | Bloquants | Souhaitables |
|---|---|---|
| 1 Fondation | — (mock) | SK-02.7 (suite de contrat, à co-écrire) |
| 2 Dashboards (prod) | SK-01, SK-02 | SK-09, SK-02.3 Arrow |
| 3 Explorateur | SK-02, SK-03 | — |
| 4 Agentique | SK-02, SK-05 | — |
| 5 Reporting (prod) | SK-08 (identités de service) | SK-06 |
| 6 KPI packs | SK-07 | — |
| Transverse | SK-08 (SSO, RLS) | SK-04 |

Ordre de livraison suggéré côté skifer, pour minimiser l'attente du board :
**SK-02.7 → SK-02 → SK-01 → SK-03 → SK-08 → SK-05 → SK-04 → SK-07 → SK-09 → SK-06**.
