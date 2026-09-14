# Roadmap de développement — skifer-board

Date : 2026-09-13. Document vivant : chaque feature ci-dessous a vocation à être découpée en
*slices* livrables indépendamment, chacune faisant l'objet d'un plan `docs/roadmap/<NN>_*_plan.md`
validé avant tout code.

Les attendus côté skifer (API, exécution sans Spark, identité) sont dans un fichier séparé :
[`00_attendus_skifer.md`](00_attendus_skifer.md). Ce document ne les répète pas ; il les référence
par leur identifiant (`SK-xx`).

---

## 1. Vision et périmètre

skifer-board est la **couche de consommation** de la couche sémantique skifer : dashboards,
exploration ad-hoc, agentique, reporting. Il n'a **aucune** couche sémantique propre, n'émet
**jamais** de SQL, et ne parle à skifer que par HTTP (REST + MCP), au travers de la frontière
`AgentReadyDataService`.

### Invariants (non négociables, à vérifier dans chaque plan)

| # | Invariant | Conséquence pratique |
|---|---|---|
| I1 | Le board ne produit jamais de SQL. | Une tuile, une exploration, une réponse d'agent = une `SemanticQuery` (noms de modèle, métriques, dimensions, filtres, période). |
| I2 | Une seule frontière vers les données. | Un unique client HTTP (`SkiferClient`) ; aucun autre accès aux données (pas de JDBC, pas de Delta, pas de Spark). |
| I3 | Fail-closed hérité. | Une décision `DENY`/`REQUIRE_HUMAN` de skifer s'affiche telle quelle, jamais contournée ni mise en cache comme un succès. |
| I4 | Tout ce qui est affiché a une provenance. | Le pied de tuile porte l'`evidence_id`, le `sql_hash`, le statut de certification et l'âge de la donnée. |
| I5 | Dashboard as code. | YAML versionné par git, validé par schéma, éditable par un humain, générable par l'agent. |
| I6 | LLM optionnel. | Phases 2, 3, 5, 6 fonctionnent sans aucun LLM. Les appels LLM sont mockés en test. |
| I7 | Rien de commercial. | Toute dépendance est vérifiée (licence permissive) au moment de l'adoption. |

### Hors périmètre (explicitement)

- Transformation, modélisation sémantique, certification : skifer.
- Row-level security : skifer (`SK-08`), le board ne fait que transmettre l'identité.
- Écriture dans les données : jamais.

---

## 2. Architecture cible

```text
┌──────────────────────────── skifer-board ─────────────────────────────┐
│                                                                       │
│  apps/web (Next.js / React 19 / Tailwind / shadcn / zustand)          │
│   ├─ /dashboards/<slug>      renderer YAML → tuiles → ECharts/Vega    │
│   ├─ /explore                explorateur ad-hoc sans LLM              │
│   ├─ /chat                   agentique (phase 4)                      │
│   └─ /reports, /alerts       reporting suite (phase 5)                │
│                                                                       │
│  apps/api (FastAPI, Python 3.12, sans pyspark)                        │
│   ├─ dashboards/   chargement, validation, CRUD YAML sur git          │
│   ├─ queries/      SkiferClient + cache résultats (clé = sql_hash)    │
│   ├─ identity/     SSO → ConsumerContext (bearer transmis à skifer)   │
│   ├─ reporting/    scheduler, exports, abonnements, alertes           │
│   └─ usage/        événements d'usage → Adaptive Gold (skifer)        │
│                                                                       │
│  packages/dashboard-spec   schéma JSON du YAML + types TS/Pydantic    │
│  packages/kpi-packs        packs déclaratifs (phase 6)                │
└───────────────────────────────┬───────────────────────────────────────┘
                                │ HTTPS (REST + MCP), bearer, scopes
┌───────────────────────────────▼───────────────────────────────────────┐
│ skifer  ·  AgentReadyDataService  ·  SemanticEngine.query_with_evidence│
│ backend d'exécution sans Spark (SK-01)  ·  Databricks SQL / DuckDB     │
└───────────────────────────────────────────────────────────────────────┘
```

**Pourquoi un back FastAPI et pas seulement Next.js ?** Trois responsabilités ne doivent pas vivre
dans le navigateur : le cache de résultats partagé entre utilisateurs, le scheduler de reporting, et
la traduction SSO → bearer skifer. Le back reste mince ; il ne réimplémente rien de skifer.

**Choix à figer dans le plan 01** (fondation) :

- Renderer : **ECharts** (Apache 2.0) par défaut pour les tuiles, avec la grammaire de viz du YAML
  volontairement indépendante du renderer (un `kind` + options sémantiques, pas des options ECharts
  brutes). Vega-Lite reste possible pour une famille de tuiles si ECharts manque. Superset n'est
  retenu qu'en repli et n'est pas dans la roadmap par défaut.
- Monorepo pnpm + uv ; `apps/web`, `apps/api`, `packages/*`.
- Stockage des dashboards : fichiers YAML dans un dossier git du projet (`dashboards/`), pas de
  base de données au départ. Une base (SQLite, puis Postgres) n'apparaît qu'en phase 5 (état des
  abonnements, historique des exports) et pour l'index de recherche.
- Tests : vitest + testing-library (web), pytest (api), Playwright hermétique contre un
  **skifer mock** (feature F1.4), jamais contre un vrai cluster.

---

## 3. Vue d'ensemble des phases

| Phase | Nom | Dépend de skifer ? | LLM ? | Livrable visible |
|---|---|---|---|---|
| 1 | Fondation | Non (mock) | Non | Repo, spec YAML v1, client skifer mocké, CI verte |
| 2 | Dashboard as YAML + renderer | `SK-01`, `SK-02` pour la prod ; mock avant | Non | Un dashboard YAML rendu dans le navigateur, pied de provenance |
| 3 | Explorateur ad-hoc | `SK-02`, `SK-03` | Non | Choisir modèle/dimensions/métriques → graphique → « épingler » |
| 4 | Agentique | `SK-02`, `SK-05` | Oui | Chat → `SemanticQuery` + viz → épingler au dashboard |
| 5 | Reporting suite | `SK-02`, `SK-06` | Non | Planification, PDF, abonnements, alertes |
| 6 | KPI packs | `SK-07` | Non | Packs installables (modèle sémantique template + dashboards) |
| T | Transverse | `SK-08` | — | Identité, observabilité, usage → Adaptive Gold, docs |

Ordre imposé : 1 → 2 → 3 → (4 ‖ 5) → 6. Les phases 4 et 5 sont indépendantes l'une de l'autre.
La phase 2 démarre **sans attendre skifer** grâce au mock.

---

## 4. Phase 1 — Fondation

Objectif : tout ce qui rend les phases suivantes découpables sans friction. Aucune fonctionnalité
utilisateur, mais un repo dans lequel une slice de 1 à 2 jours se livre proprement.

### F1.1 — Squelette monorepo et outillage
- Structure `apps/web`, `apps/api`, `packages/dashboard-spec`, `dashboards/` (exemples).
- pnpm workspaces, uv, ruff, mypy strict sur `apps/api`, eslint/tsc strict sur `apps/web`.
- CI : lint + type-check + tests unitaires + build. Un `Makefile` ou `justfile` avec les 5
  commandes du quotidien.
- `CHANGELOG.md` initialisé avec `[Unreleased]`.
- **Done** : `make check` vert sur un clone frais, README de 20 lignes.

### F1.2 — Spécification « Dashboard as YAML » v1
- Fichier `packages/dashboard-spec/schema/dashboard.v1.json` (JSON Schema, draft 2020-12),
  documentation `docs/dashboard_yaml_spec.md`.
- Modèle proposé (à figer dans le plan) :

```yaml
apiVersion: skifer-board/v1
kind: Dashboard
metadata:
  slug: sales-overview
  title: Ventes — vue d'ensemble
  owner: sales-analytics
  tags: [sales, gold]
spec:
  layout: {columns: 12}
  filters:                       # filtres globaux, liés aux tuiles par nom de dimension
    - name: region
      dimension: region          # résolu sur chaque tuile qui expose cette dimension
      default: null
    - name: period
      kind: period
      default: last_12_months    # nom de période du calendrier skifer, jamais une date calculée ici
  tiles:
    - id: revenue_by_month
      title: CA mensuel
      position: {x: 0, y: 0, w: 8, h: 4}
      query:                     # ≡ SemanticQuery, noms uniquement
        model: sales.orders
        metrics: [revenue]
        group_by: [order_month]
        filters: []
        period: $filters.period
      viz:
        kind: line               # kpi | table | bar | line | area | pie | scatter | heatmap
        x: order_month
        series: [revenue]
        format: {revenue: currency_eur}
      provenance: {show: true}   # pied de tuile, activé par défaut
```

- Règles de validation **hors** skifer (statiques) : unicité des `id`, positions dans la grille,
  cohérence `viz` ↔ `query` (un `x` doit être dans `group_by`, une `series` dans `metrics`),
  filtres globaux référencés existants.
- Règles de validation **avec** skifer (dynamiques, feature F2.3) : existence du modèle, des
  métriques, des dimensions, de la période.
- **Done** : 10 dashboards d'exemple valides, 15 invalides avec messages d'erreur lisibles,
  tests de schéma des deux côtés (TS + Python) à partir du même JSON Schema.

### F1.3 — Client skifer (`SkiferClient`) et contrat d'API
- `apps/api/skifer_board/skifer_client/` : un client typé (httpx) de l'API skifer, DTO Pydantic
  miroir des DTO de `AgentReadyDataService` (`ModelSummary`, `GovernedModelView`, `QueryEnvelope`,
  `SemanticEvidence`…).
- Traduction des erreurs skifer (`ScopeDenied`, `LimitExceeded`, `SemanticAccessDenied`…) en erreurs
  typées du board, **sans perte** de la raison (`MISSING`, `EXPIRED`, `FAILED_CHECK`…).
- Le contrat attendu est spécifié dans `00_attendus_skifer.md` (`SK-02`) ; le client est écrit
  contre ce contrat, pas contre l'API loopback actuelle.
- **Done** : couverture 100 % du client contre le mock (F1.4), erreurs typées testées une par une.

### F1.4 — Mock skifer (serveur de test)
- Un serveur FastAPI minimal `tools/skifer_mock/` qui implémente le contrat `SK-02` sur des
  fixtures : 3 modèles sémantiques (dont un avec jointure), résultats déterministes, evidence
  complète, scénarios d'erreur pilotables par en-tête (`X-Mock-Scenario: deny_expired`).
- Sert aux tests du back, aux tests Playwright et au développement front sans skifer.
- **Done** : le mock passe la même suite de tests de contrat que devra passer skifer (`SK-02`
  livre cette suite comme artefact partagé).

### F1.5 — Identité minimale
- Mode local : identité statique (`subject` = utilisateur OS, `consumer_class: dashboard`), bearer
  fixe lu dans l'environnement. Rien de plus tant que `SK-08` n'existe pas.
- Le `ConsumerContext` transmis à skifer est **construit côté board et jamais depuis une requête
  navigateur** (même règle que `LocalIdentity` dans skifer).
- **Done** : impossible de forger un scope depuis le front, test dédié.

**Risques phase 1** : sur-spécifier le YAML avant d'avoir rendu une tuile (garder v1 minimale,
versionner `apiVersion`) ; un mock qui diverge du vrai skifer (mitigé par la suite de tests de
contrat partagée).

---

## 5. Phase 2 — Dashboard as YAML + renderer

Objectif : un fichier YAML dans `dashboards/` devient une page web avec des tuiles interrogées via
skifer, chacune signée par sa ligne de provenance.

### F2.1 — Chargement et catalogue des dashboards
- Le back scanne `dashboards/**/*.yaml`, valide (F1.2), expose `GET /dashboards` et
  `GET /dashboards/{slug}`. Rechargement à chaud en dev.
- Un dashboard invalide apparaît dans le catalogue **avec ses erreurs** plutôt que de disparaître.
- **Done** : page liste, page détail vide (sans données), erreurs de validation visibles.

### F2.2 — Exécution des tuiles et cache de résultats
- `POST /dashboards/{slug}/tiles/{id}/data` : construit la `SemanticQuery` finale (tuile + filtres
  globaux), appelle skifer, renvoie `{rows, evidence, truncated, cached_at}`.
- Cache clé = `evidence.sql_hash` (le SQL exécuté identifie le résultat). Invalidation :
  TTL configurable par dashboard, et **invalidation forcée** dès qu'un `sources[].definition_hash`
  ou un `metrics[].definition_hash` de l'evidence change par rapport à l'entrée en cache.
- Un `DENY` n'est **jamais** mis en cache. Un `WARN` l'est avec son drapeau.
- Exécution concurrente des tuiles d'un dashboard avec plafond (par ex. 6 en parallèle), timeout
  par tuile, annulation quand l'utilisateur quitte la page.
- **Done** : deux ouvertures successives ne font qu'un appel skifer ; changement de définition
  d'une métrique (simulé par le mock) → nouvel appel ; tests de course.

### F2.3 — Validation dynamique contre skifer
- `POST /dashboards/validate` : pour chaque tuile, vérifie via `GET /catalog/{key}` que modèle,
  métriques, dimensions existent. Renvoie des erreurs positionnées (chemin YAML).
- Une CLI `skifer-board validate dashboards/` utilisable en CI du dépôt de dashboards.
- **Done** : une faute de frappe dans un nom de métrique est signalée avant tout appel de données,
  avec suggestion (`did you mean`) si skifer la fournit.

### F2.4 — Renderer web : grille et tuiles
- Page `/dashboards/[slug]` : grille 12 colonnes responsive, tuiles chargées indépendamment
  (skeleton, erreur locale, retry), filtres globaux dans une barre.
- Bibliothèque de viz : les `kind` de la spec v1 (`kpi`, `table`, `bar`, `line`, D6 du plan 01) ;
  `area`, `pie`, `scatter`, `heatmap` arrivent par ajout à l'énumération. Le renderer (ECharts ou
  Vega-Lite) est **choisi en ouverture du plan 02**, sur preuve : une même tuile rendue dans chacun
  (D7 du plan 01, amendé le 14/09). Chaque `kind` a un composant, une fonction pure
  `rows → spec du renderer` testée unitairement, et les formats nommés de la spec v1.
- Thème clair/sombre, palette cohérente, accessibilité (contraste, navigation clavier).
- **Done** : les 10 dashboards d'exemple se rendent contre le mock ; snapshot tests des specs
  du renderer ; Playwright hermétique pour la navigation et les filtres.

### F2.5 — Pied de provenance
- Sous chaque tuile : statut de certification (icône + libellé), `evidence_id` tronqué, âge de la
  donnée (`data_age_seconds` humanisé), durée d'exécution, « depuis le cache » ou non.
- Panneau « Détails » : modèles utilisés, définitions sélectionnées (métriques et leurs hashs),
  filtres normalisés (valeurs redigées si skifer les a redigées), décision de policy et raisons.
- Un `WARN` s'affiche en bandeau ; un `DENY` remplace la tuile par un message actionnable
  (raison + action recommandée par skifer).
- **Done** : chaque état de `PolicyEvaluation` a un rendu et un test.

### F2.6 — Édition YAML assistée (sans agent)
- Éditeur de texte dans le navigateur (Monaco ou CodeMirror, licences permissives) avec validation
  en direct (F1.2 + F2.3) et aperçu. Sauvegarde = écriture du fichier + commit git optionnel.
- **Done** : boucle édition → aperçu < 2 s ; le fichier écrit est byte-identique à ce que
  l'éditeur affiche (pas de reformatage silencieux).

### F2.7 — Export statique d'un dashboard
- `GET /dashboards/{slug}/export?format=png|pdf` en rendu headless (Playwright déjà présent).
  Base de la phase 5, livrée tôt pour valider le pipeline de rendu.
- **Done** : un PDF A4 avec le pied de provenance de chaque tuile.

**Risques phase 2** : latence des tuiles si `SK-01` (exécution sans Spark) n'est pas prête (le
mock masque le problème : prévoir un scénario « lent » dans le mock et un budget de latence
explicite) ; grammaire de viz qui fuit vers ECharts (garder `viz` sémantique, revue à chaque
nouveau `kind`) ; volumétrie (plafond `max_query_rows` de skifer = 1 000 lignes aujourd'hui, à
négocier dans `SK-02` pour les tables) ; schéma `dashboard.v1.json` introuvable hors du monorepo
(`schema.py` le cherche en remontant les dossiers, il n'est pas embarqué dans le paquet
`skifer-board-api`) : l'embarquer au build avec un contrôle de dérive, à trancher au plan 02 avant
tout déploiement (revue du 14/09).

---

## 6. Phase 3 — Explorateur ad-hoc sans LLM

Objectif : l'équivalent de l'*explore* Lightdash. L'utilisateur compose une `SemanticQuery` par
clics, voit le résultat, et l'épingle dans un dashboard.

### F3.1 — Navigateur de modèles
- Liste des modèles (`GET /catalog`), fiche modèle (dimensions, métriques, entités, modèles liés,
  descriptions, statut de certification). Recherche plein texte côté board.
- **Done** : trouver une métrique par son nom ou sa description en moins de 3 actions.

### F3.2 — Constructeur de requête
- Panneau : modèle → dimensions (glisser dans « regrouper par ») → métriques → filtres (opérateurs
  de `SK-02`, valeurs typées) → période (dates ou nom de période du calendrier).
- L'état est une `SemanticQuery` sérialisable dans l'URL (partage par lien).
- Modèles liés : proposer les dimensions des modèles atteignables, avec affichage des refus de
  skifer (fanout, chemin ambigu) **tels quels**.
- **Done** : toute requête constructible dans l'UI est une `SemanticQuery` valide ; tests de
  propriété (génération aléatoire de requêtes → validation par le mock).

### F3.3 — Résultats et visualisation automatique
- Table de résultats (tri, pagination client dans la limite renvoyée, indicateur `truncated`).
- Suggestion de viz automatique à partir de la forme (1 métrique 0 dimension → `kpi`, une
  dimension temporelle → `line`, etc.), modifiable.
- Même pied de provenance qu'en phase 2.
- **Done** : la suggestion est une fonction pure testée sur une matrice de formes.

### F3.4 — Épingler au dashboard
- « Épingler » ouvre un choix de dashboard existant ou nouveau, une position, et produit
  **le YAML de la tuile** que l'utilisateur voit avant confirmation. Écrit via F2.6.
- **Done** : épingler puis ouvrir le dashboard rend la même chose que l'exploration.

### F3.5 — Explorations sauvegardées
- Une exploration se sauvegarde en YAML (`kind: Exploration`) au même endroit que les dashboards,
  même validation, même versionnement.
- **Done** : ouvrir une exploration sauvegardée restaure exactement l'état.

**Risques phase 3** : besoin de tri et de top-N côté skifer (`SK-03`, manquant aujourd'hui dans
`SemanticQuery`) ; valeurs de dimensions pour les filtres (liste déroulante) nécessitent une requête
`group_by: [dim]` sans métrique, autorisée par le planner mais coûteuse : mettre en cache.

---

## 7. Phase 4 — Agentique

Objectif : le chat produit une `SemanticQuery` + une spec de viz, l'utilisateur vérifie, épingle.
Le board **n'appelle pas** un LLM lui-même pour la génération de requêtes : il délègue à
`GenBIAgent` via skifer (`SK-05`) et n'ajoute que la couche de viz et d'épinglage.

### F4.1 — Chat connecté à l'agent skifer
- Page `/chat`, historique de session, appel `POST /agents/ask` (skifer). Affichage de
  l'`explanation`, de la `SemanticQuery` produite (lisible, éditable), et du résultat avec
  provenance.
- **Done** : tests avec réponses d'agent mockées ; aucun appel réseau en test.

### F4.2 — Spec de viz générée
- À partir de `response_format` et de la forme du résultat, le board propose la viz (réutilise
  F3.3). Le LLM ne choisit **pas** les options ECharts ; il choisit au plus un `kind`.
- **Done** : la viz proposée passe la validation F1.2.

### F4.3 — Épingler depuis le chat et générer un dashboard complet
- Réutilise F3.4. Variante « générer un dashboard » : l'agent propose N tuiles (N `SemanticQuery`),
  le board assemble le YAML, l'utilisateur relit dans l'éditeur (F2.6) avant sauvegarde.
- **Done** : le YAML généré est validé statiquement et dynamiquement avant proposition.

### F4.4 — MCP côté board (optionnel, à trancher)
- Exposer les dashboards en ressources MCP read-only (« quels dashboards existent, que contient
  celui-ci ») pour qu'un agent externe puisse s'en servir. Même règles que le MCP skifer : loopback,
  bearer injecté, lecture seule.
- **Done** : décision documentée, implémentation seulement si un cas d'usage concret existe.

**Risques phase 4** : boucle de confiance (un utilisateur épingle une requête mal comprise) → la
`SemanticQuery` et l'`explanation` sont toujours visibles avant épinglage, jamais cachées derrière
la viz.

---

## 8. Phase 5 — Reporting suite

Objectif : Power BI / Looker « scheduled delivery » sans plateforme commerciale.

### F5.1 — Planification
- `kind: Schedule` en YAML : dashboard ou exploration, cron, fuseau, format, destinataires.
- Scheduler dans le back (APScheduler ou équivalent, licence permissive), état persistant (SQLite
  → Postgres), verrou pour plusieurs instances.
- **Done** : un run manqué (back arrêté) est détecté et rapporté, pas rejoué silencieusement.

### F5.2 — Exports
- PDF et PNG (F2.7), CSV/XLSX des tables (dans la limite skifer), lien vers le dashboard vivant.
  Chaque export embarque la provenance (page de garde : modèles, certification, evidence ids).
- **Done** : un export est reproductible à partir de ses evidence ids.

### F5.3 — Abonnements et livraison
- Canaux : e-mail (SMTP), Slack, Teams, Google Chat, webhook — mêmes canaux que
  `observability/alerts.py` de skifer (`SK-06` : réutilisation ou duplication minimale).
- **Done** : chaque canal a un test avec transport mocké.

### F5.4 — Alertes sur métriques
- `kind: Alert` : une `SemanticQuery` à résultat scalaire, une condition (seuil, variation vs
  période précédente), une fréquence, un canal. Aucune valeur de donnée sensible dans l'alerte si
  la colonne est classée `pii`/`restricted` (même règle que skifer).
- **Done** : hystérésis (pas de tempête d'alertes), historique consultable.

### F5.5 — Rapports narratifs (as code)
- Optionnel, inspiré d'Evidence : markdown + blocs `query:` YAML rendus en page. Réutilise le
  renderer de tuiles.
- **Done** : décision go/no-go après phase 5.1–5.4.

**Risques phase 5** : le scheduler a besoin d'une identité de service côté skifer (`SK-08`,
`consumer_class: scheduled_report`) ; sans elle, les rapports tournent avec une identité humaine,
inacceptable en prod.

---

## 9. Phase 6 — KPI packs

Objectif : des packs déclaratifs par domaine (ventes, finance, supply, RH…) : modèle sémantique
template + dashboards + explorations + alertes, installables et adaptables.

### F6.1 — Format de pack
- `packages/kpi-packs/<domain>/pack.yaml` : métadonnées, prérequis (entités, dimensions, métriques
  attendues, avec types), dashboards, explorations, alertes, glossaire.
- **Done** : schéma JSON du pack, un pack `sales` de démonstration.

### F6.2 — Mapping vers un modèle réel
- Assistant : le pack déclare des noms logiques (`revenue`, `order_date`) ; l'utilisateur les
  associe aux métriques/dimensions d'un modèle skifer. Le board génère les YAML concrets.
  Le modèle sémantique template lui-même est livré côté skifer (`SK-07`).
- **Done** : installer le pack `sales` sur le mock produit des dashboards valides.

### F6.3 — Catalogue et mises à jour
- Versionnement des packs, diff à la mise à jour, jamais d'écrasement d'une personnalisation.
- **Done** : mise à jour d'un pack avec une tuile modifiée localement → conflit rapporté, rien écrit
  (même philosophie que `SemanticSynchronizer`).

---

## 10. Transverse

### T1 — Identité et sécurité
- SSO (OIDC) → session board → bearer skifer avec `consumer_class` et scopes (`SK-08`).
- Identités de service pour le scheduler et les alertes.
- Aucun secret en YAML, aucun bearer dans le navigateur, CSP stricte.

### T2 — Observabilité
- Traces : propager `trace_id` de bout en bout (board → skifer). Métriques : latence par tuile,
  taux de cache, décisions de policy par raison. Logs structurés sans valeur de donnée.

### T3 — Usage → Adaptive Gold
- Chaque exécution de tuile, exploration ou question émet un `SemanticUsageEvent` vers skifer
  (`SK-04`). C'est la première source de volume de la boucle adaptive.

### T4 — Documentation et exemples
- mkdocs comme skifer ; un exemple par feature dans `examples/`, exécutable contre le mock.

### T5 — Déploiement
- Docker compose (web + api + skifer mock), puis charts pour GCP/Azure. Pas d'exigence de cluster.

---

## 11. Dépendances et chemin critique

```text
F1.1 ─┬─ F1.2 ─┬─ F2.1 ── F2.4 ── F2.5 ── F2.6 ── F2.7
      │        │
      ├─ F1.3 ─┴─ F2.2 ── F2.3
      │   │
      └─ F1.4     └──── F3.1 ── F3.2 ── F3.3 ── F3.4 ── F3.5
                                          │
                              F4.1 ── F4.2 ─┴─ F4.3      F5.1 ── F5.2 ── F5.3 ── F5.4
                                                                    │
                                                          F6.1 ── F6.2 ── F6.3
```

Chemin critique : `F1.2 → F1.3 → F2.2 → F2.4 → F2.5`. Tout le reste peut se paralléliser.

Points de synchronisation avec skifer :

| Jalon board | Attendu skifer bloquant |
|---|---|
| Fin phase 2 en prod | `SK-01` exécution sans Spark, `SK-02` API REST |
| F3.2 | `SK-03` tri / top-N |
| F4.1 | `SK-05` endpoint agent avec `SemanticQuery` en clair |
| F5.1 en prod | `SK-08` identités de service |
| F6.2 | `SK-07` modèles sémantiques template |

---

## 12. Règles de découpage en slices

Pour que le découpage ultérieur soit mécanique :

1. **Une slice = une valeur observable** (une page, un endpoint, un `kind` de viz), livrable en
   1 à 3 jours, avec ses tests et son entrée `CHANGELOG.md`.
2. **Une slice ne dépend jamais de skifer réel** : elle se démontre contre le mock. La première
   fois qu'un attendu skifer devient bloquant, la slice le nomme (`SK-xx`) et s'arrête à la
   frontière.
3. **Chaque slice a une preuve** : test unitaire, test de contrat, ou Playwright hermétique.
   Pas de « vérifié à la main ».
4. **Le YAML est l'API** : toute slice qui touche au format bump `apiVersion` seulement si
   incompatible, sinon ajoute avec valeur par défaut et met à jour le JSON Schema + les 10 exemples.
5. **Une slice = un plan `NN_*_plan.md` + un ou plusieurs commits** `feat(planNN-x.y): …`, après
   validation explicite.

---

## 13. Risques globaux et parades

| Risque | Impact | Parade |
|---|---|---|
| skifer tarde sur `SK-01`/`SK-02` (autre chantier en cours) | Phase 2 ne passe pas en prod | Mock + suite de tests de contrat partagée ; le board n'attend pas pour les phases 2–3 |
| Le format YAML devient un DSL de viz | Perte du principe What/How | `viz` sémantique, revue systématique, refus des options renderer brutes |
| Latence perçue des dashboards | Adoption | Cache par `sql_hash`, chargement parallèle borné, invalidation par hash de définition, préchauffage par le scheduler |
| Dérive entre mock et skifer | Bugs tardifs | Tests de contrat exécutés dans les deux dépôts |
| Sécurité : bearer ou scope forgeable | Fuite de données | Contexte construit côté back uniquement, tests négatifs dédiés, revue `cso` avant chaque phase en prod |
| Licences | Juridique | Tableau de licences tenu à jour dans `docs/licenses.md`, vérifié à chaque ajout |
