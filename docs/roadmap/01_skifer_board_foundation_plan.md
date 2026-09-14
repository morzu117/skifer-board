# Plan 01 — Fondation de skifer-board

> Rédigé le 13 septembre 2026. Couvre la phase 1 de la [roadmap](00_roadmap.md) (F1.1 à F1.5).
> Statut : **validé, GO donné le 13 septembre 2026** (D12 et 35B tranchés le même jour).
> Implémentation : **terminée le 13 septembre 2026** sur `feat/plan01-foundation` (sous-tâches 1.1 à 5.1, vérification sur clone frais verte). **Livrée le 14 septembre 2026** : PR #1 mergée dans `main` (`a55e095`). Rétro : `skifer-board/retro/foundation`. Revue humaine des décisions prises par l'orchestrateur : **faite le 14 septembre 2026** (D16 à D20, §10) ; sous-tâches 6.1 à 6.4 implémentées sur `review/plan01-decisions` (`b6fc75b`, `de9f156`, `04a51c6`, `acf2edc`), gate vert, en attente de livraison.
> Tâche mémoire : `skifer-board/plan/foundation` (source gbrain `skifer-board` ; gbrain refuse `:`
> dans les slugs).

## 1. Intention

Rendre le dépôt livrable par slices : un monorepo pnpm + uv avec un gate unique, la spec
« Dashboard as YAML » v1 validée des deux côtés à partir d'un seul JSON Schema, un mock skifer
qui implémente le contrat `SK-02`, un client typé écrit contre ce mock, et une identité minimale
construite côté serveur. Aucune fonctionnalité utilisateur.

## 2. Contexte

- Le dépôt ne contient que de la documentation et une CI provisoire (validation YAML + présence de
  `[Unreleased]`).
- skifer expose aujourd'hui une API **loopback** à identité locale. Constaté par l'index structurel
  de `../skifer` le 13/09 :
  - `AgentReadyDataService` renvoie `Page[ModelSummary]`, `GovernedModelView`
    (`key, description, layer, tags, dimensions, metrics, entities, related_models`) et
    `QueryEnvelope` `{rows, evidence, truncated}` ;
  - le corps de requête MCP est un JSON Schema fermé (`model, metrics, group_by,
    filters[{column, operator, value}], date_from, date_to, period, limit`), bornes issues de
    `ServiceLimits` ;
  - les erreurs de l'API actuelle ont la forme `{code, message, path}` (table `_ERROR_TABLE`), et
    **pas** la forme `{error: {type, message, reasons?, recommended_action?}}` attendue par
    `SK-02.5` ;
  - `SemanticAccessDenied` porte `model_key, datasets, decision, reasons, evaluated_at,
    recommended_action` ; décisions `ALLOW | WARN | DENY | REQUIRE_HUMAN`.
- Le client et le mock du board sont écrits **contre `SK-02` (cible)**, pas contre l'API loopback.
- **Numérotation côté skifer** : `docs/roadmap/35_governance_wiring_plan.md` existe déjà. Le plan
  des prérequis du board sera le **plan 35B** côté skifer (décision du 13/09) ; les références de
  `CLAUDE.md` et `00_attendus_skifer.md` ont été mises à jour en conséquence.
- Machine de développement Windows : `make` absent, Python 3.12 et uv 0.12 installés, node 26,
  pnpm 9. **uv est obligatoire** pour tout l'outillage Python (décision utilisateur du 13/09).

## 3. Décisions

| # | Décision | Options écartées et raison |
|---|---|---|
| D1 | **Gate unique `pnpm check`**, scripts du `package.json` racine. Les parties Python passent par `uv run`. | `Makefile` : `make` absent de la machine Windows de dev, le gate serait rouge pour une raison d'environnement. `justfile` : un binaire de plus à installer partout. Turborepo : inutile à deux apps, ajoutable plus tard sans casser `pnpm check`. |
| D2 | **uv workspace à la racine** (`pyproject.toml` virtuel, membres `apps/api` et `tools/*`), un seul `uv.lock` commité, `.python-version` = 3.12, `uv sync --locked` en CI. Aucun `pip`, aucun `requirements.txt`. | Un projet uv par dossier : plusieurs lockfiles qui divergent. pip + venv : contraire à la décision uv obligatoire. |
| D3 | **Source de vérité de la spec = JSON Schema draft 2020-12**, écrit à la main dans `packages/dashboard-spec/schema/dashboard.v1.json`. Types générés et commités : TS via `json-schema-to-typescript`, Pydantic via `datamodel-code-generator`. Un contrôle de dérive régénère et compare dans `pnpm check`. | Pydantic comme source : le schéma devient un artefact Python, alors que le YAML doit être générable par un agent et validable depuis n'importe quel langage. Zod comme source : même problème côté Python. |
| D4 | **Validation structurelle des deux côtés** (ajv côté TS, `jsonschema` côté Python), sur un même corpus de fixtures. **Règles inter-champs** (unicité des `id`, grille, `viz` ↔ `query`, filtres référencés) : **Python seul** en v1, avec des codes d'erreur stables. | Règles dupliquées en TS : deux implémentations à tenir alignées dès la v1. L'éditeur (F2.6) passera par l'API, validateur de référence. |
| D5 | **`query` d'une tuile = corps `SK-02.2` sans `limit`**, schéma fermé (`additionalProperties: false`). Les liaisons `$filters.<nom>` ne sont admises que dans `period` (vers un filtre `kind: period`) et `filters[].value` (vers un filtre de dimension) ; `date_from` et `date_to` restent des dates littérales en v1, aucun filtre global ne produisant de date (précisé le 13/09 à l'écriture du brief 2.1). Pas de `order_by` ni de top-N (`SK-03` absent). | Ajouter `order_by` dès la v1 : le board promettrait un tri que skifer ne sait pas exécuter (lignes arbitraires). Ajout additif en v2 quand `SK-03` existe. |
| D6 | **`viz.kind` v1 : `kpi`, `table`, `bar`, `line`.** `area`, `pie`, `scatter`, `heatmap` arriveront par ajouts à l'enum, sans casser la v1. Formats nommés sous forme d'enum fermé (`number`, `integer`, `percent`, `currency_eur`, `currency_usd`), jamais d'options du renderer. | Les 8 types de la roadmap : risque déjà nommé de sur-spécifier avant d'avoir rendu une tuile. |
| D7 | **Renderer non tranché ici.** La spec v1 est sémantique et indépendante du renderer ; le choix ECharts / Vega-Lite / Superset reste au plan 02 (« temps 2 » de `CLAUDE.md`). | Figer ECharts maintenant : aucune tuile n'est rendue en phase 1, la décision n'aurait aucune preuve. |
| D8 | **Suite de tests de contrat écrite par le board** (`tools/skifer_contract_tests/`, pytest, base URL en paramètre), contre `SK-02`. Proposée ensuite à skifer comme artefact `SK-02.7`. | Attendre que skifer la livre : bloque la phase 1 sur un chantier externe. |
| D9 | **Stack web alignée sur `../klasso/apps/web`** : Next.js 15, React 19, Tailwind 4, zustand 5, vitest + testing-library, eslint 9, `tsc --noEmit`. Playwright n'arrive qu'au plan 02, avec la première page réelle. | Next.js 16 : écart de conventions avec la référence klasso sans bénéfice en phase 1. |
| D10 | **Stack API** : FastAPI, httpx, Pydantic v2, ruff, mypy `strict`, pytest. Aucune dépendance `pyspark`, et un test vérifie qu'aucun module du board n'importe `skifer` ni `pyspark`. | Importer `skifer` pour réutiliser ses DTO : couplage par code, contraire à « HTTP uniquement ». |
| D11 | **`.gitattributes` `* text=auto eol=lf`** dès la première sous-tâche. | Laisser l'autocrlf de Windows : les contrôles de dérive des fichiers générés (D3) deviendraient rouges sur la machine de dev seulement. |
| D12 | **Filtres globaux uniquement, application implicite** (validé le 13/09) : un filtre de `spec.filters` s'applique à chaque tuile dont le modèle expose sa dimension, avec une exclusion par tuile via `ignore_filters: [<nom>]`. La résolution se fait à l'exécution (F2.3) ; la v1 ne valide statiquement que les références (`$filters.<nom>` et `ignore_filters` doivent pointer vers des filtres existants). | Déclaration explicite des filtres sur chaque tuile : verbeux et source d'oublis. **Filtres de section** : plus tard, par ajout (un niveau de portée entre dashboard et tuile) ; la v1 ne réserve aucun champ pour eux. |
| D13 | **Précisions après la 2.2** (validées le 13/09). (a) D3 maintenu : le schéma v1 n'utilise **pas** `propertyNames` (clés de `viz.format` non contraintes structurellement, vérifiées par `FORMAT_KEY_UNKNOWN`) : datamodel-code-generator traduit mal une contrainte de clé de dict — clé `RootModel` non hashable avec `$ref`, `constr()` refusé par mypy strict en ligne (amendé le 13/09 après le re-dev 1 de la 2.2, essai vérifié) ; un test charge chaque fixture valide dans les modèles générés. (b) Le `path` d'une issue désigne l'élément fautif le plus précis, **avec son index** dans une liste (`.../viz/series/<k>`, `.../viz/columns/<k>`). | Retirer les modèles générés ou les écrire à la main : abandon de la source unique D3 pour un défaut d'outil contournable dans le schéma. Paths sans index : un éditeur ne pourrait pas surligner l'élément exact. |
| D14 | **Contrat HTTP du mock et de la suite de contrat, là où SK-02 est muet** (fixé et validé le 13/09 avant le brief 3.1, proposé à skifer via le plan 35B). Authentification : bearer `Authorization: Bearer <token>`, absent ou invalide → **401 `Unauthenticated`** (type ajouté à la liste SK-02.5) ; `/health` sans authentification. Codes : `InvalidRequest` 400, `LimitExceeded` 400, `InvalidCursor` 400, `ScopeDenied` 403, `SemanticAccessDenied` 403 (corps : `decision`, `reasons`, `evaluated_at`, `recommended_action`, jamais de `rows`), `ResourceNotFound` 404, `SemanticQueryError` 422 (avec `suggestions`), `ResourceUnavailable` 503. Formes : `GET /models` → `{items, next_cursor, total}` (miroir de `Page`) ; `POST /query` → `{columns[{name, logical_type}], rows, evidence, truncated}`, `logical_type` ∈ `string`, `date`, `integer`, `decimal`. La suite de contrat est agnostique de la cible (base URL ou factory ASGI en ini) et ne présume d'aucune valeur de ligne. | Reprendre la forme `{code, message, path}` de l'API loopback actuelle : elle perd `decision`/`reasons` de `SemanticAccessDenied`, contraire à I3. 422 pour toute erreur de validation : confond une requête mal formée (faute du client) et un nom sémantique inconnu (faute de catalogue). Suite de contrat liée au mock : inutilisable par skifer, contraire à SK-02.7. |
| D15 | **Couverture des états préparés par la suite de contrat** (validé le 13/09, avant la 3.2). La suite obtient par des requêtes normales : `DENY` (`finance.invoices`, `EXPIRED`), `LimitExceeded`, `InvalidCursor`, `SemanticQueryError` avec `suggestions`, `Unauthenticated`, `InvalidRequest`. Pour les états qu'aucune requête normale ne provoque, la **cible déclare ses fixtures** en configuration de la suite : clé de modèle en `WARN`, clé de modèle en `REQUIRE_HUMAN`, et un bearer sans le scope `query:execute` (→ `ScopeDenied`). Sans cette configuration, les tests concernés échouent avec un message explicite (jamais de skip). Le mock ajoute ces états à son catalogue de **test** (le catalogue §4 reste celui des exemples). `ResourceUnavailable` reste hors contrat (non provocable proprement sur une cible réelle). L'en-tête `X-Mock-Scenario` est propre au mock et sert aux tests du client du board (4.2), jamais à la suite de contrat. | En-tête de scénario dans le contrat : imposerait à skifer une surface de test dans son API réseau. États naturels seulement : `WARN` est listé dans SK-02.7, la suite n'y serait pas conforme. |
| D16 | **Liaison interdite dans une liste** (revue humaine du 14/09, A1). Un élément du tableau `query.filters[].value` qui commence par `$filters.` est une erreur semantic `BINDING_IN_LIST`, de path `.../filters/<i>/value/<k>` (D13 b). Une liaison n'est admise que comme valeur entière (D5). | Traiter l'élément comme une liaison : injecter un filtre global dans une liste littérale, sémantique à inventer. Le laisser littéral (comportement livré en 2.2) : la chaîne `$filters.region` part vers skifer, filtre sur une valeur inexistante, et la tuile est vide sans aucune erreur. |
| D17 | **Garde de pagination par curseurs déjà vus** (revue du 14/09, A2 ; ratifie et étend la garde livrée en 4.2). `iter_models` mémorise tous les curseurs suivis ; un `next_cursor` déjà vu lève `UnexpectedResponse`. | Comparer au seul curseur précédent (4.2) : un cycle A → B → A boucle sans fin. Plafond de pages déduit de `total` : suppose un `total` stable pendant toute l'itération. |
| D18 | **Refus sur 2xx sans les lignes** (revue du 14/09, A3 ; ratifie le fail-closed livré en 4.2). Une réponse 2xx dont `evidence.policy.decision` vaut `DENY` ou `REQUIRE_HUMAN` lève `SemanticAccessDenied` dont `body` vaut `{"evidence": <evidence reçue>}` : jamais `rows` ni `columns`. `recommended_action` reste `None` sur ce chemin tant que `evidence.policy` ne le porte pas (demandé à skifer, SK-02.3). | Conserver le corps complet (4.2) : les lignes d'une requête refusée vivent dans l'exception et fuient au premier handler qui sérialise `body` (route des tuiles, phase 2). Vider `body` : perd la preuve utile au pied de provenance d'un refus. |
| D19 | **Couverture 100 % étendue à `identity`** (revue du 14/09, A4 ; ratifie le seuil livré en 4.2). `check:api` mesure `skifer_board.skifer_client` et `skifer_board.identity`, seuil 100 %. | Tout `skifer_board` à 100 % : pousse à tester des chemins sans enjeu de sécurité (recherche du schéma, CLI). Client seul (4.2) : laisse hors seuil l'autre frontière de sécurité, où le repli de D20 était du code mort non détecté. |
| D20 | **Repli de l'identité locale effectif en Python 3.12** (revue du 14/09, B1). `local_identity` retombe sur `"unknown"` quand `getpass.getuser()` lève `OSError`, `KeyError` ou `ImportError`. | `except OSError` seul (5.1) : ne couvre que Python ≥ 3.13 ; en 3.12, un UID absent de `/etc/passwd` sans variable `USER` (conteneur) lève `KeyError`, et `/api/me` répond 500. |

**Ratifié sans changement le 14/09** (revue humaine) : D5 précisé (dates littérales seulement dans
`date_from`/`date_to`) ; `422 SemanticQueryError` livré en 3.1 au lieu de 3.2 (scope-creep accepté).

## 4. Catalogue du mock (figé ici, référencé par les exemples)

Trois modèles, noms volontairement proches des exemples skifer :

| Modèle | Dimensions | Métriques | Particularité |
|---|---|---|---|
| `sales.orders` | `order_date`, `order_month`, `region`, `channel`, `customer_id` | `revenue`, `order_count`, `avg_basket` | calendrier avec les périodes `last_12_months`, `ytd`, `previous_year` |
| `sales.customers` | `customer_id`, `segment`, `country` | `customer_count` | joint à `sales.orders` via `customer_id` (`related_models`) |
| `finance.invoices` | `invoice_month`, `status` | `invoiced_amount`, `overdue_amount` | certification `EXPIRED` par défaut, pour tester `DENY` sans en-tête |

Scénarios pilotables par l'en-tête `X-Mock-Scenario` : `deny_expired`, `warn_stale`,
`require_human`, `limit_exceeded`, `invalid_cursor`, `unknown_metric` (suggestions renvoyées),
`scope_denied`, `unavailable`. Résultats déterministes : les lignes sont une fonction pure de la
requête normalisée.

## 5. Sous-tâches

Un point = un commit `feat(plan01-X.Y): …`, avec ses tests et une entrée `CHANGELOG.md [Unreleased]`.
Taille indicative pour le routage des modèles : **T** trivial, **S** standard, **C** complexe.

### F1.1 — Squelette monorepo et outillage

**1.1 — Racine et API Python** (S)
- Créés : `package.json` (racine, scripts `check`, `check:api`), `pnpm-workspace.yaml`,
  `pyproject.toml` (workspace uv), `uv.lock`, `.python-version`, `.gitattributes`,
  `apps/api/pyproject.toml`, `apps/api/src/skifer_board/__init__.py`,
  `apps/api/tests/test_smoke.py`, `apps/api/tests/test_no_forbidden_imports.py`.
- `check:api` = `uv run ruff check`, `uv run ruff format --check`, `uv run mypy`, `uv run pytest`.
- Modifiés : `.gitignore` (ajouts uniquement), `CHANGELOG.md`.

**1.2 — App web** (S)
- Créés : `apps/web/` (Next.js minimal : une page, `package.json`, `tsconfig.json`, config eslint et
  vitest), `apps/web/src/app/page.test.tsx`, `pnpm-lock.yaml`.
- Script racine `check:web` = lint + `tsc --noEmit` + vitest + `next build`. `check` enchaîne
  `check:api` et `check:web`.

**1.3 — CI, gate et README** (T)
- Modifiés : `.github/workflows/ci.yml` (job `check` : setup pnpm + uv, `uv sync --locked`,
  `pnpm install --frozen-lockfile`, `pnpm check` ; le job `docs` existant est conservé),
  `agent.yml` (`commands.test`, `commands.lint` et `gates` pointent sur `pnpm check`),
  `README.md` (section « Développer » d'une vingtaine de lignes, ajout uniquement).
- Suite : relancer `/sync` pour régénérer le bloc rendu de `CLAUDE.md`. Ce n'est **pas** fait dans
  ce commit, car ce bloc ne s'édite pas à la main.

### F1.2 — Spécification « Dashboard as YAML » v1

**2.1 — Schéma, documentation, fixtures** (S)
- Créés : `packages/dashboard-spec/package.json`,
  `packages/dashboard-spec/schema/dashboard.v1.json`, `docs/dashboard_yaml_spec.md`,
  `packages/dashboard-spec/fixtures/valid/*.yaml` (10),
  `packages/dashboard-spec/fixtures/invalid/*.yaml` (15), chacun avec un `*.expected.json`
  `{layer: structural|semantic, code, path}`.
- Forme : celle de la roadmap §F1.2, restreinte par D5 et D6.

**2.2 — Validation Python** (C)
- Créés : `apps/api/src/skifer_board/dashboard_spec/` (chargement YAML sûr, validation `jsonschema`,
  modèles Pydantic générés, règles inter-champs avec codes stables), CLI
  `uv run skifer-board validate <chemins>`, tests paramétrés sur les 25 fixtures, test de dérive
  du code généré.

**2.3 — Validation TS** (S)
- Créés : `packages/dashboard-spec/src/` (validateur ajv, types générés), tests vitest sur les
  fixtures de couche `structural`, test de dérive des types.

**2.4 — Dashboards d'exemple** (T)
- Créés : `dashboards/sales-overview.yaml`, `dashboards/finance-invoices.yaml` (sur le catalogue §4).
- `check:api` valide `dashboards/` avec la CLI de la 2.2.

### F1.4 — Mock skifer et tests de contrat (avant F1.3 : le client se teste contre le mock)

**3.1 — Tests de contrat et mock, chemin nominal** (C)
- Créés : `tools/skifer_contract_tests/` (pytest, `--base-url`, bearer en variable
  d'environnement), `tools/skifer_mock/` (FastAPI, fixtures §4) : `GET /api/v1/health`, `/me`,
  `/models`, `/models/{key}`, `POST /query` avec `columns`, `rows`, `evidence` complète,
  `truncated`.
- Le mock joue la suite en processus (transport ASGI httpx) : aucun port ouvert, aucun réseau.

**3.2 — Scénarios d'erreur** (S)
- Mock : les scénarios `X-Mock-Scenario` de §4, corps d'erreur `SK-02.5`.
- Suite de contrat : un test par type d'erreur, décision et raisons vérifiées à l'identique.

### F1.3 — Client skifer

**4.1 — DTO et client nominal** (S)
- Créés : `apps/api/src/skifer_board/skifer_client/` (`SkiferClient` httpx asynchrone, DTO Pydantic
  `ModelSummary`, `ModelPage`, `GovernedModelView`, `QueryRequest`, `QueryResult`, `Evidence`),
  tests contre le mock.

**4.2 — Erreurs typées** (S)
- Une exception du board par `type` `SK-02.5`, qui conserve `decision`, `reasons`,
  `recommended_action` et `suggestions`. Un test par type. Couverture du paquet client à 100 %
  (`pytest --cov --cov-fail-under=100` sur ce seul paquet).
- Invariant I3 testé : une réponse `DENY` ou `REQUIRE_HUMAN` ne produit jamais un `QueryResult`.

### F1.5 — Identité minimale

**5.1 — Identité statique côté serveur** (S)
- Créés : `apps/api/src/skifer_board/identity/` (sujet = utilisateur OS,
  `consumer_class: dashboard`, bearer lu dans `SKIFER_BOARD_SKIFER_TOKEN`),
  `apps/api/src/skifer_board/app.py` (FastAPI minimal : `/api/health`, `/api/me`).
- Test dédié : des en-têtes, cookies ou champs de corps qui prétendent porter `scopes`,
  `consumer_class` ou un bearer n'ont aucun effet sur le contexte transmis à skifer.

## 6. Rayon d'impact déclaré

**Non établi par l'index structurel** : le dépôt ne contient aucun code, `codegraph impact` n'a donc
rien à mesurer. Le contrat vérifiable par la review est la liste de fichiers du §5, plus les
**seuls** fichiers existants modifiés ci-dessous (ajouts uniquement) :

| Fichier existant | Sous-tâche | Nature |
|---|---|---|
| `.gitignore` | 1.1 | ajouts |
| `CHANGELOG.md` | toutes | entrées sous `[Unreleased]` |
| `.github/workflows/ci.yml` | 1.3 | ajout du job `check`, remplacement du commentaire de fin |
| `agent.yml` | 1.3 | `commands` et `gates` (demandé explicitement par ce plan) |
| `README.md` | 1.3 | section ajoutée |

Aucune écriture dans `../skifer`. Aucune modification de `CLAUDE.md` ni d'`AGENTS.md` (blocs rendus).

## 7. Risques et parades

| Risque | Parade |
|---|---|
| Le mock dérive du vrai skifer. | Suite de contrat D8 proposée comme `SK-02.7` ; skifer la jouera contre son API. |
| La forme d'erreur `SK-02.5` n'est pas adoptée côté skifer (l'API actuelle renvoie `{code, message, path}`). | Le décodage des erreurs est isolé dans un seul module du client ; un changement de forme ne touche que lui et la suite de contrat. |
| On ne sait pas comment l'API loopback actuelle traduit `SemanticAccessDenied` en HTTP (non vérifié). Si elle renvoie 500, le fail-closed se lirait comme une panne. | Le client traite tout 5xx comme `ResourceUnavailable`, jamais comme un succès. Point ajouté aux attendus lors de la mise à jour de `00_attendus_skifer.md`. |
| Sur-spécification du YAML. | D5, D6 ; `apiVersion` versionnée ; tout ajout ultérieur est additif. |
| Types générés différents selon l'OS (fins de ligne, ordre). | D11 et contrôle de dérive exécuté aussi en CI Linux. |
| Gate rouge sur la machine de dev à cause d'un PATH de session périmé. | Signalé comme échec d'environnement, jamais contourné. |
| Premier cycle de la chaîne agent sur ce dépôt. | Sous-tâches courtes ; la 1.1 sert de rodage avant les sous-tâches C. |

## 8. Ce qui reste incertain

1. ~~**Application des filtres globaux**~~ : tranché, voir D12.
2. ~~**Numéro du plan des prérequis côté skifer**~~ : tranché, plan 35B.
3. ~~**Mémoire**~~ : source gbrain `skifer-board` créée le 13/09, page `skifer-board/plan/foundation`
   écrite.
4. **Leçons** : la recherche dans `lessons` n'a remonté aucune leçon de domaine applicable (seulement
   les documents du noyau).

## 9. Stratégie de vérification

- Chaque sous-tâche : `pnpm check` **en entier**, vert, dès qu'il existe (à partir de la 1.1) ; avant
  cela, le gate `docs` d'`agent.yml`.
- Contrôle de périmètre mécanique après chaque commit :
  `git --no-pager show <COMMIT> | grep -E "^-" | grep -vE "^---" | wc -l` proche de zéro.
- Fin de phase : clone frais → `uv sync --locked && pnpm install --frozen-lockfile && pnpm check`
  vert sous Linux (CI) et sous Windows (machine de dev).
- Aucun réseau en test : mock en processus, aucun LLM, aucune clé.

## 10. Suites de la revue humaine (14 septembre 2026)

Revue de la codebase livrée (PR #1) appuyée sur l'index codegraph, branche
`review/plan01-decisions`. Décisions D16 à D20 et ratifications au §3, **validées par l'utilisateur
le 14/09**. Un point = un commit `fix(plan01-6.Y): …`, avec ses tests et une entrée
`CHANGELOG.md [Unreleased]` (section `Fixed`).

**6.1 — Liaison interdite dans une liste (D16)** (S)
- Modifiés : `apps/api/src/skifer_board/dashboard_spec/semantic.py` (règle `BINDING_IN_LIST`),
  `apps/api/tests/dashboard_spec/test_semantic_rules.py` (le test
  `test_literal_period_and_values_are_not_bindings` est **remplacé** : une liste contenant
  `$filters.region` devient un cas d'erreur, une liste littérale sans liaison et une période littérale
  restent valides), `docs/dashboard_yaml_spec.md` (ligne du tableau des codes semantic, phrase sur les
  deux positions admises).
- Créés : `packages/dashboard-spec/fixtures/invalid/semantic-binding-in-list.yaml` et son
  `.expected.json`. Si un test compte les fixtures, sa mise à jour est autorisée.

**6.2 — Garde de pagination par curseurs déjà vus (D17)** (T)
- Modifiés : `apps/api/src/skifer_board/skifer_client/client.py` (`iter_models` seul),
  `apps/api/tests/skifer_client/test_pagination_guard.py` (ajout : un cycle A → B → A lève
  `UnexpectedResponse` ; le cas du curseur répété immédiatement reste couvert).

**6.3 — Refus sur 2xx sans les lignes (D18)** (S)
- Modifiés : `apps/api/src/skifer_board/skifer_client/client.py` (`query` seul),
  `apps/api/tests/skifer_client/test_fail_closed.py` (ajouts : réponse 2xx `DENY` puis
  `REQUIRE_HUMAN` avec des lignes non vides → `error.body` n'a ni `rows` ni `columns`, aucune valeur
  de ligne n'apparaît dans `str(error)` ni dans `repr(error.body)`, `error.body["evidence"]` est
  égal à l'evidence reçue).

**6.4 — Identité locale et couverture (D19, D20)** (T)
- Modifiés : `apps/api/src/skifer_board/identity/local.py`, un test par exception (`OSError`,
  `KeyError`, `ImportError` → `subject == "unknown"`) dans `apps/api/tests/identity/`,
  `package.json` (`check:api` : ajout de `--cov=skifer_board.identity`, demandé explicitement par
  ce plan). Le correctif et le seuil vont dans le même commit : sans le correctif, `identity` est
  à 85 % et le gate serait rouge.

**Rayon d'impact déclaré** (`codegraph impact`, 14/09) :

| Symbole | Sous-tâche | Fichiers dans le rayon |
|---|---|---|
| `semantic_issues` | 6.1 | `semantic.py`, `validate.py`, `dashboard_spec/__init__.py`, `test_semantic_rules.py` |
| `iter_models` | 6.2 | `client.py`, `test_client_nominal.py`, `test_pagination_guard.py` |
| `SkiferClient.query` (lève `SemanticAccessDenied`) | 6.3 | `client.py` ; la classe `SemanticAccessDenied` est inchangée (son rayon, `errors.py`, `app.py` et 8 fichiers de test du client, n'est pas touché) |
| `local_identity` | 6.4 | `local.py`, `app.py`, `test_app.py`, `test_no_forged_identity.py` |

Seule la 6.1 supprime des lignes existantes (le test remplacé, la phrase de la doc). Aucune écriture
dans `../skifer`.

**Reports hors du plan 01**, faits dans le commit de ce paragraphe :
- `recommended_action` sur le chemin 2xx (D18) → `00_attendus_skifer.md`, SK-02.3.
- Schéma JSON non embarqué dans le paquet `skifer-board-api` (`schema.py` le cherche en remontant
  les dossiers du monorepo) → risques de la phase 2 dans `00_roadmap.md`, à trancher au plan 02.
- F2.4 de la roadmap alignée sur D6 et D7 : les 4 `kind` de la v1, renderer choisi en ouverture du
  plan 02.
