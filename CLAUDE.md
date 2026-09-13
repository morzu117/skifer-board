# CLAUDE.md — skifer-board

## Contexte

**skifer-board** est la suite de [skifer](../skifer) : une plateforme de **self-BI agentique**
auto-hébergée. Dashboards personnalisés, rapports ad-hoc, et une reporting suite du type
Power BI / Looker, mais sans dépendre d'aucune plateforme logicielle commerciale : une instance
GCP, Azure ou autre, et on est autonome.

skifer centralise la **transformation** et la **couche sémantique** avec une approche déclarative
(le *What* en YAML, strictement découplé du *How* en Python). skifer-board est la **couche de
consommation** de cette couche sémantique. Il ne la remplace jamais, ne la contourne jamais.

Le dépôt skifer est un frère de ce dossier : `../skifer`. Lire son `CLAUDE.md` avant toute
décision d'architecture — il décrit précisément la frontière que le board consomme.

## Décisions déjà prises (2026-09-13)

| Décision | Choix |
|---|---|
| Dépôt | Séparé de skifer, ici. Couplage avec skifer **par HTTP uniquement** (REST + MCP). Spark n'entre jamais dans le board. |
| Socle graphique | **Pas Plotly Dash** : c'est un framework d'applications Python (un dashboard = du code), sans self-service ni spec déclarative. Contraire au principe What vs How. |
| Format des dashboards | **Dashboard as YAML** : une tuile = une `SemanticQuery` (noms de dimensions, métriques, filtres, période — jamais de SQL) + une spec de visualisation. Généré par l'agent, éditable par un humain, versionné par git. |
| Renderer | **Tranché en temps 2.** Options : construire sur ECharts (Apache 2.0) / Vega-Lite (BSD), ou s'appuyer sur Apache Superset pour les dashboards classiques et concentrer le board sur l'ad-hoc et l'agentique. |
| KPI prêts à l'emploi | Pas de dépendance externe (il n'existe pas de bibliothèque open source de KPI réutilisables). Ce seront des **KPI packs** déclaratifs : modèle sémantique template + dashboards template par domaine, à la manière des Looker Blocks. |

## Ce que skifer fournit déjà (à consommer, pas à reconstruire)

Tout est dans `../skifer/src/skifer/` :

- **Requête sémantique sans SQL émis par un LLM** : `agentic/resolver.py` (`QueryResolver`),
  `semantic/planner` (`SemanticPlanner`, chemins de jointure, sécurité de grain, calendriers).
- **Preuve par requête** : `SemanticEngine.query_with_evidence()` → `SemanticEvidence`
  (hash `sha256:v1:` du SQL exécuté, hashs de définition des métriques, lineage, snapshot de
  certification, décision de policy, durée). La **ligne de provenance** devient le pied de
  chaque tuile. Le hash du SQL est la **clé de cache naturelle** des résultats.
- **Gate de certification fail-closed** : `semantic/access_policy.py`, `ConsumerContext`,
  `consumer_class`, `off | warn | enforce | supervised`.
- **La frontière de sécurité** : `agentic/data_service.py` (`AgentReadyDataService`) — scopes
  `models:read`, `contracts:read`, `lineage:read`, `query:execute`, plafonds durs
  (`ServiceLimits`), DTO par allowlist, pagination opaque. **Le board ne parle qu'à ça.**
- **MCP read-only** : `mcp/` (stdio / http, bind loopback obligatoire, bearer injecté).
- **Agent GenBI** : `agentic/agent.py` (`GenBIAgent`), `agentic/hub.py` (`AgenticHub`),
  serving MLflow dans `serving/`.
- **Adaptive Gold** : `adaptive/` — les événements d'usage des dashboards seront la première
  source de volume de cette boucle (proposition → PR → évaluation).
- **Briques réutilisables pour la reporting suite** : `agentic/exporter.py` (PDF via fpdf2),
  `observability/alerts.py` (`AlertDispatcher`).
- **Statement Execution API Databricks** déjà utilisée pour les materialized views
  (`params.sql_warehouse_id`) — même mécanisme pour exécuter sans Spark.

## Ce qui manque, et où ça se construit

### Côté skifer (prérequis, plan `docs/roadmap/35_*` dans skifer — pas ici)

1. **Backend d'exécution sans Spark** : Databricks SQL warehouse (Statement Execution API) en
   prod, DuckDB + delta-rs en local / petite instance. Le SQL de `QueryResolver` est du Spark
   SQL → transpilation de dialecte (sqlglot, MIT).
2. **API REST sur `AgentReadyDataService`** (résultats en Arrow IPC de préférence). Une seule
   frontière : l'API n'expose rien d'autre que le service.
3. **Identité utilisateur** : mapping SSO → `ConsumerContext` (consumer class, scopes), et
   row-level security, qui n'existe pas encore.

⚠️ Ne pas démarrer ce travail dans `../skifer` sans accord explicite : un autre chantier y est
en cours sur une autre machine.

### Côté skifer-board (ici)

Phases validées, dans l'ordre :

2. **Dashboard as YAML + renderer** : spec du format, validation, rendu web, pied de provenance
   par tuile, cache de résultats clé = hash du SQL, invalidation sur `source_definition_hash`.
3. **Explorateur ad-hoc sans LLM** : choisir modèle, dimensions, métriques, filtres → graphique.
   (Équivalent de l'*explore* Lightdash.) Ne dépend d'aucun LLM.
4. **Agentique** : chat → `SemanticQuery` + spec de viz → « épingler au dashboard ».
5. **Reporting suite** : planification, exports PDF, abonnements, alertes.
6. **KPI packs**.

La phase 2 peut démarrer sans attendre skifer : la spec YAML des dashboards ne dépend d'aucun
code skifer, seulement de la forme d'une `SemanticQuery`.

## Projets open source à étudier avant de construire

| Projet | Licence | Pourquoi |
|---|---|---|
| Lightdash | MIT | Le plus proche du produit visé (BI sur couche sémantique dbt). Étudier l'UX d'exploration. Forker = gros chantier TypeScript lié à dbt. |
| Rill | Apache 2.0 | BI-as-code, metrics view YAML, DuckDB. Très aligné sur la philosophie et le mode local. |
| Evidence | MIT | Rapports as code (markdown + SQL). Gain rapide pour la reporting suite statique. |
| Apache Superset | Apache 2.0 | Solution de repli complète pour les dashboards classiques. Défaut : sa propre couche sémantique doublonnerait skifer. |
| Perspective (FINOS) | Apache 2.0 | Pivots et viz haute performance dans le navigateur, utile pour l'ad-hoc. |
| ECharts / Vega-Lite | Apache 2.0 / BSD | Grammaires de viz déclaratives, candidats naturels pour le « How » du renderer. |
| sqlglot | MIT | Transpilation Spark SQL → DuckDB. |

Vérifier les licences au moment de l'adoption ; ce tableau date du 2026-09-13.

## Stack pressentie

- **Front** : Next.js / React 19 / Tailwind / shadcn / zustand — même stack que
  `../klasso/apps/web`, à réutiliser comme référence de conventions.
- **Back** (si nécessaire au-delà de l'API skifer) : Python, FastAPI. Le board ne dépend pas
  de `pyspark`.
- Choix définitifs à figer dans le premier plan.

## Conventions héritées de skifer

- **Plans de développement** dans `docs/roadmap/<NN>_<feature>_plan.md` : contexte, phases avec
  fichiers créés/modifiés, risques, stratégie de vérification. Le plan est **commité avant tout
  code** et attend la **validation explicite** de l'utilisateur.
- Un point de plan = un commit, message référençant le plan (`feat(plan01-2.1): ...`).
- Toute modification de code = test associé + entrée dans `CHANGELOG.md` sous `[Unreleased]`.
- **Ne jamais bumper la version** : l'utilisateur gère le versioning.
- Les appels LLM sont toujours mockés en test ; aucun réseau, aucune clé, aucun cluster.

## Premières tâches pour la session qui démarre ici

1. Lire `../skifer/CLAUDE.md` et `../skifer/src/skifer/agentic/data_service.py`.
2. Écrire `docs/roadmap/01_skifer_board_foundation_plan.md` : format dashboard-as-YAML,
   architecture du board, contrat attendu de l'API skifer (pour que le plan 35 côté skifer
   soit écrit à partir des besoins réels du board), choix de stack.
3. Attendre la validation avant de coder.
