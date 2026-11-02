# Attendus de Board envers skifer

Date : 2 novembre 2026 · Lot 00b du [plan de développement](../plan-de-developpement.md) (§13, côté skifer) · Propriétaire côté skifer : **à désigner**.

Ce document dit ce que Board attend de skifer, l'état réel du code et ce que Board fait en attendant. Il reprend les SK-01 à SK-09 de `docs/roadmap/00_attendus_skifer.md` de la branche `main` (commit `63697c9`, 13 septembre 2026), qui en détaille la surface souhaitée ; SK-10 et SK-11 viennent de la révision du 31 octobre. Il est écrit dans ce dépôt seulement : rien n'est demandé ni ouvert dans `../skifer` sans accord explicite. Chaque attendu accepté devient un plan dans le dépôt de skifer, avec un propriétaire, avant que le lot Board qui en dépend soit déclaré livré.

## 1. Base vérifiée

- Dépôt `../skifer`, branche `memory-improvements`, commit `bccd7aa`, soit `v4.0.0` plus quatre commits de documentation : `git diff v4.0.0..HEAD -- src` est vide. `pyproject.toml` déclare `4.0.0` ; Board, par Atlas, installe le tag `v4.0.0`.
- Relecture du code le 2 novembre 2026, en lecture seule. Trois points ont été exécutés en mémoire avec l'import de `pyspark` bloqué, sans rien écrire : les imports, la génération de SQL par `QueryResolver`, une requête contre le conteneur par défaut de l'API.
- Les références `fichier:ligne` sont relatives à `src/skifer/` sauf mention contraire.

## 2. Les deux options du §3.3

L'arbitrage du §3.3 n'est pas tranché ; ce document ne le présume pas. Pour chaque attendu, il dit ce qui change selon l'option.

- **A′ : skifer en bibliothèque.** Board importe le modèle sémantique, `QueryResolver`, la politique de certification et l'evidence, et exécute le SQL produit par le résolveur avec ses propres connecteurs. La frontière unique est la bibliothèque skifer.
- **B : API skifer.** Board n'appelle qu'une API REST de skifer, qui exécute. La frontière unique est cette API.

Constat qui pèse sur l'arbitrage sans le trancher :

- La compilation sans Spark existe déjà. `skifer`, `skifer.semantic`, `skifer.agentic.resolver`, `skifer.agentic.data_service`, `skifer.semantic.access_policy` et `skifer.semantic.evidence` s'importent sans pyspark. `QueryResolver().resolve(...)` produit le SQL et son `hash_sql` sans charger pyspark. Seuls `spark_factory.py:13` et `core/spark_backend.py:12-13` importent pyspark au niveau du module.
- L'exécution sans Spark n'existe dans aucune des deux options.
- L'API REST actuelle n'est pas utilisable à distance.

## 3. Synthèse

| Réf. | Attendu | État au `bccd7aa` | Sous A′ | Sous B | Lots Board |
|---|---|---|---|---|---|
| SK-01 | Exécution sans Spark | **Absent** : seul `SparkBackend` existe | point d'extension public pour le backend de Board | backend Databricks SQL et DuckDB dans skifer | 03, 05 |
| SK-02 | API REST distante | **Absent** : loopback, identité locale ; refus d'accès rendu en 500 | refus d'accès typé seulement | tout l'attendu | 03, 05 |
| SK-03 | Tri et top-N | **Absent** | même attendu | même attendu | 05 |
| SK-04 | Événements d'usage | Modèle **présent**, jamais enregistré | Board écrit l'événement par la bibliothèque | skifer l'enregistre à chaque requête | 06, 10 |
| SK-05 | Agent à distance | **Partiel** : route locale, sans requête complète ni `dry_run` | hors V1 | hors V1 | hors V1 |
| SK-06 | Briques de reporting | non relu | hors V1 | hors V1 | hors V1 |
| SK-07 | Modèles template | non relu | hors V1 | hors V1 | hors V1 |
| SK-08 | Identité, identités de service, RLS | **Partiel** : scopes ; OIDC, service et RLS absents | RLS dans le planner, identité côté Board | RLS dans le planner, vérificateur OIDC côté skifer | 02, 03, 08 |
| SK-09 | Hashs de définition sans exécution | **Absent** sur `get_model` | lecture directe du modèle par la bibliothèque, à confirmer | route avec `ETag` | 05 |
| SK-10 | Candidate d'origine externe | **Absent** : Plan 44 sans code | même attendu | même attendu | 10 |
| SK-11 | Contrat de réagrégation | **Partiel** : `additivity` et `grain` sur le modèle, pas de composantes ni de ratios | même attendu | même attendu | 05, 06 |

## 4. Détail

### SK-01 — Exécution sans Spark

**Attendu.** La couche sémantique s'exécute sans session Spark : Databricks SQL (Statement Execution API) en production, DuckDB en local. Le SQL de `QueryResolver` est transpilé (sqlglot) avec des tests de non-régression par exemple. `sql_hash` reste stable quel que soit le moteur, ou l'evidence dit le dialecte.

**Constat.**

- `AgentReadyDataService.query()` (`agentic/data_service.py:348-377`) n'importe pas Spark mais attend un objet DataFrame : `result.dataframe.limit(limit + 1).collect()` (l.370).
- Le moteur passe par `self.core._get_backend()` puis `execute_sql_with_metadata(sql)` ou `execute_sql(sql)` (`semantic/semantic.py:488-503`), avec un `ExecutionResult(dataframe, statement_id, metadata)` (`semantic/evidence.py:39-45`). Ce point d'extension existe donc, mais il est privé.
- Seule implémentation : `SparkBackend` (`core/spark_backend.py:168`). `SkiferEngine.__init__` exige une session Spark (`core/core.py:224-236`).
- La Statement Execution API ne sert qu'aux vues matérialisées (`core/spark_backend.py:865-893`) et à l'historique de l'analyzer. Le Plan 41 de skifer (D2) l'écarte du service comme « un second runtime, contraire au Plan 26 », et le Plan 26 (« Spark-only ») a retiré les backends non Spark.
- DuckDB est absent de `src/`, `tests/` et `pyproject.toml`. sqlglot n'est utilisé que par l'analyzer (extra `[analyzer]`), jamais par `QueryResolver`, qui assemble du SQL Spark à la main (`agentic/resolver.py:465`, `712-731`).
- `sql_hash = hash_sql(resolved.full_sql)` (`semantic/semantic.py:480`) : sha256 du SQL Spark aux espaces près, préfixé `sha256:v1:`. La limite du service n'y entre pas.

**Sous A′.** Board exécute le SQL du résolveur avec ses connecteurs. Il faut alors à skifer :

- un **point d'extension public** pour le backend, à la place de `core._get_backend()` et d'un faux « cœur » portant `db` et `config`, que l'API de skifer contourne déjà avec `_CatalogOnlyCore` (`services/container.py:39-47`) ;
- une règle écrite pour `sql_hash` : il reste calculé sur le SQL du résolveur, avant la transpilation faite par Board, et l'evidence porte le dialecte d'exécution.

La transpilation et ses tests de non-régression deviennent alors un travail de Board. Ils doivent prouver, exemple par exemple, que le SQL transpilé rend les mêmes lignes que Spark.

**Sous B.** Tout l'attendu est côté skifer, et il va contre deux décisions écrites de skifer (Plans 26 et 41). Il faut une décision de skifer avant un plan.

**Board en attendant.** Aucune exécution. Les lots 03 et 05 ne sont pas démarrés.

### SK-02 — API REST distante

**Attendu (sous B).** Une surface réseau réduite à `AgentReadyDataService`, détaillée dans `main` (SK-02.1 à SK-02.7) :

- bind non-loopback seulement derrière un bearer vérifié par un vérificateur injecté ;
- `POST /query` renvoyant `{columns, rows, evidence, truncated}` ;
- erreurs typées : `SemanticAccessDenied` avec `decision`, `reasons`, `recommended_action`, jamais de lignes ;
- plafond de lignes par `consumer_class` ;
- suite de contrat partagée.

**Constat.**

- **Bind.** La CLI impose `127.0.0.1` (`cli.py:62`, `1574-1579`), sans option `--host`. CORS n'admet que `localhost` et `127.0.0.1` (`api/app.py:16`, `55-61`).
- **Identité.** Locale par défaut (`api/app.py:63-65`) : `LocalIdentity` prend l'utilisateur de l'OS et tous les scopes sauf `certification_override` (`services/identity.py:23-57`). `create_app(context_provider=...)` permet d'injecter un fournisseur, mais la CLI n'en passe pas. Le vérificateur de bearer n'existe que côté MCP (`mcp/auth.py:35-61`, `98-184`) : contrôles stricts d'émetteur, d'audience, d'expiration et de scopes, `certification_override` interdit.
- **Requête.** `POST /semantic/query` (`api/routes/semantic.py:21-28`) lit le corps par `SemanticQuery.from_dict`, qui **ignore les clés inconnues**. Il renvoie `{rows, evidence, truncated}` sans `columns`, avec une evidence expurgée (`agentic/data_service.py:226-237`, `366`).
- **Erreurs.** Le gestionnaire ne traite que `AgentReadyDataError` (`api/errors.py:19-51`) : 403, 400, 404, 503, 500, avec le corps `{code, message, path}`. `SemanticAccessDenied` et `SemanticQueryError` n'en héritent pas (`semantic/access_policy.py:57`). Ils sortent en **500 générique, sans `decision` ni `reasons`**. Côté MCP, le refus est `-32003 "semantic_access_denied"`, lui aussi sans décision (`mcp/tools.py:224-229`).
- **Conteneur par défaut.** `POST /semantic/query` échoue aujourd'hui en 500. Le moteur repose sur `_CatalogOnlyCore`, sans attribut `db` (`services/container.py:63-72`). `semantic/semantic.py:392` lève donc `AttributeError` avant d'atteindre l'erreur prévue, `ResourceUnavailable` en 503. `POST /session/connect` ne recâble pas le moteur sémantique.
- **Limites.** `HARD_MAX_QUERY_ROWS = 1 000`, page 100, 50 filtres, valeurs de 1 024 caractères (`services/context.py:10-13`).

**Sous A′.** Pas d'API. Reste un attendu : un refus d'accès qui porte `decision`, `reasons` et `recommended_action` en données structurées dans l'exception, pour que Board l'affiche tel quel (invariant fail-closed).

**Sous B.** Tout l'attendu. Le refus en 500 et les clés ignorées sont à corriger avant toute ouverture réseau : Board ne peut pas distinguer un refus d'une panne, ni savoir qu'un champ a été ignoré.

**Board en attendant.** Le simulateur et la suite de contrat de `main` (§3.4) sont à remettre en service au lot 00. Aucun lot Board ne se déclare livré sur ce simulateur.

### SK-03 — Tri et top-N

**Attendu.** `order_by` sur des noms de `metrics ∪ group_by`, `limit` porté dans le SQL, ajout additif. Souhaitable : comparaison de période (N-1).

**Constat.** Absent.

- Les champs de `SemanticQuery` (`agentic/resolver.py:57-67`) sont `model_name`, `metrics`, `group_by`, `filters`, `date_from`, `date_to`, `mode`, `view_name`, `explanation`, `response_format` et `period`.
- `_assemble_sql` n'émet ni `ORDER BY` ni `LIMIT`. La troncature du service garde donc des lignes non déterministes.
- `period` est une période nommée, définie par un début et une fin (`semantic/calendar.py:15-30`), sans décalage.

**Selon l'option.** Même attendu sous A′ et B : c'est le résolveur qui doit l'écrire. Sous A′, Board ne compense pas en ajoutant `ORDER BY` lui-même, ce qui reviendrait à écrire du SQL.

**Board en attendant.** Pas de top-N. Un résultat tronqué est affiché comme tel (§4.6).

### SK-04 — Événements d'usage

**Attendu.** Les rendus de Board alimentent les événements d'usage de skifer, sans valeur de donnée, avec la surface d'origine.

**Constat.**

- `SemanticUsageEvent` existe (`adaptive/models.py:51-67`) : identifiant, date, environnement, `consumer_class`, hashs de modèle, métriques, dimensions, forme des filtres, empreinte, durée, lignes, octets, statut. Il n'a pas de champ `surface`.
- `usage_event_from_evidence` (`adaptive/models.py:248`) n'est appelé nulle part dans `src`. Les stores ne sont alimentés que par un exemple et des tests. Il n'y a pas de route d'ingestion.

**Sous A′.** Board construit l'événement depuis l'evidence avec la bibliothèque et l'écrit dans le store de skifer. Il faut un champ `surface` et un store accessible depuis le backend de Board.

**Sous B.** skifer enregistre l'événement à chaque `query()`, avec la surface transmise par un en-tête. C'est l'option préférée dans `main`.

**Board en attendant.** Rien n'est émis.

### SK-05 — Agent à distance (hors V1)

**Constat.**

- `POST /agents/ask` existe (`api/routes/agents.py:20-26`). Il répond `{text, response}`, et `query_params` n'y porte pas `model_name`. Il n'y a ni lignes, ni evidence, ni `dry_run`.
- `AgentService.ask` ne transmet pas le contexte de la requête (`services/agents.py:25-35`) : le moteur retombe sur `consumer_id="legacy"` (`semantic/semantic.py:944-949`).

L'attendu de `main` est inchangé.

### SK-06, SK-07 — Reporting et modèles template (hors V1)

Non relus cette fois. Les attendus de `main` restent la référence.

### SK-08 — Identité, identités de service, RLS

**Attendu.**

- Un vérificateur OIDC produisant le contexte de la requête depuis les claims.
- Des identités de service par `consumer_class`, sans `certification_override`.
- Une **RLS** déclarée dans le modèle sémantique et injectée par le planner avant la compilation. Elle est visible dans `normalized_filters` avec une origine `policy`.

**Constat.** Partiel.

- **Contextes.** `RequestContext(subject, scopes, consumer_class, trace_context)` (`services/context.py:76-93`) et `ConsumerContext` (`semantic/access_policy.py:34-40`) existent. Le service filtre les scopes transmis au moteur par une liste vide (`_CONSUMER_SCOPE_ALLOWLIST = frozenset()`, `services/context.py:14`). Le moteur reçoit donc toujours des scopes vides et aucun `user_id`.
- **OIDC.** Absent ; seul existe le vérificateur injectable côté MCP.
- **Identités de service.** Absentes.
- **RLS.** Absente : aucune politique de lignes.
- **Filtres du modèle.** Le `base_filter` part dans le SQL (`agentic/resolver.py:387-389`) mais pas dans l'evidence.
- **Contrôle d'accès.** Il se limite à la porte de certification par `consumer_class` (`semantic/semantic.py:861-934`).
- Aucun plan postérieur au 35 ne traite ce sujet.

**Sous A′.** La RLS reste dans le planner de skifer : Board ne pose jamais une restriction de sécurité lui-même (invariant §2). Board vérifie l'identité avec son fournisseur et construit le `ConsumerContext`. skifer doit alors transmettre `user_id` et les attributs nécessaires à la politique, ce que la liste vide empêche aujourd'hui. Le `base_filter` doit aussi paraître dans l'evidence.

**Sous B.** Tout l'attendu est côté skifer : vérificateur OIDC sur l'API, identités de service, RLS.

**Board en attendant.** Le lot 02 attend le choix du fournisseur d'identité. Aucune donnée n'est servie par utilisateur.

### SK-09 — Hashs de définition sans exécution

**Attendu.** Lire `definition_hash` du modèle et des sources sans exécuter, idéalement avec un `ETag`, pour vérifier la fraîcheur d'un cache.

**Constat.**

- `get_model` renvoie des noms seulement, sans hash (`agentic/data_service.py:63-84`, `267-281`), et il n'y a pas d'`ETag` dans l'API.
- Le hash des métriques n'apparaît que dans l'evidence, après exécution (`semantic/evidence.py:333-363`). Un hash interne de modèle existe sans être exposé (`semantic/domain_graph.py:251-256`).
- Ailleurs : les ressources MCP portent un `ETag` sha256. `GET /certifications/{dataset}` expose le hash de la certification.

**Sous A′.** Board peut calculer les hashs en lisant le modèle avec la bibliothèque, si `hash_definition` est public et stable. Attendu : le déclarer public, avec sa version de calcul.

**Sous B.** Route de lecture avec `ETag`.

**Board en attendant.** Pas de cache de résultats. Tout résultat servi porte son âge.

### SK-10 — Candidate de métrique d'origine externe

**Attendu.** Une métrique ad hoc définie dans Board (calcul structuré, sans LLM) entre dans le cycle des candidates de skifer : soumission d'une définition structurée, état lisible par Board, continuité d'identité à la promotion.

**Constat.** Le Plan 44 de skifer est écrit, sans code : « Rien n'est implémenté ». D7 reste en suspens jusqu'au banc 44.7.

- `MetricCandidate` naît d'une question posée à l'agent de repli (`docs/roadmap/44_metric_candidates/01_candidate_registry_spec.md:48-74`). Aucune soumission externe n'est prévue.
- D6 révisée : l'arbitrage passe par une API Python `CandidateService`, exposée par un notebook Databricks et par la CLI locale. Routes `api/` et application sont exclues de la v1.

**Sous A′.** Board pourrait appeler `CandidateService` en bibliothèque, si une forme de candidate structurée existe. Cela reste compatible avec D6, qui n'exclut que les routes.

**Sous B.** Il faut une route, que D6 exclut en v1.

**Dans les deux cas,** il faut une forme de candidate qui accepte une définition structurée.

**Board en attendant.** Le lot 10 n'est pas démarré.

### SK-11 — Contrat de réagrégation

**Attendu.**

- Des métriques ratio ou dérivées, avec numérateur et dénominateur.
- Les composantes d'une moyenne : somme et effectif.
- Le grain du résultat, les dimensions et opérations compatibles.
- Une complétude au-delà de `truncated`.

**Constat.** Partiel.

- `type` ∈ {`sum`, `count_distinct`, `count`, `avg`, `min`, `max`}. `additivity` et `non_additive_dimensions` existent et sont appliqués par le planner (`semantic/planner.py:294-352`). Ils ne sont **pas exposés** au consommateur : `get_model` ne donne que des noms, l'evidence n'a ni `type` ni `additivity`.
- `avg` compile en `AVG(...)` sans composantes (`agentic/resolver.py:507-508`). Il n'y a ni ratio, ni métrique dérivée.
- `grain` existe sur le modèle et le contrat, pas sur le résultat d'une requête.
- `truncated` est la seule complétude. `data_age_seconds` reste toujours à `None` (`semantic/semantic.py:633-634`).

**Selon l'option.** L'évolution du modèle et du résolveur est côté skifer dans les deux cas.

- **Sous A′.** Board lit `type` et `additivity` dans le modèle par la bibliothèque. Seules les composantes et les ratios manquent.
- **Sous B.** L'API doit en plus exposer ces attributs dans `get_model` ou dans la réponse.

**Board en attendant.** Le calcul contextuel du plan 01 ne réagrège que les métriques additives sur des dimensions compatibles. Tout le reste est renvoyé au moteur. Les composantes de moyenne sont prévues dans le contrat de Board (`AvgComponents`) mais jamais remplies.

## 5. Défauts constatés à signaler

Indépendants de l'arbitrage, ils touchent l'invariant fail-closed ou l'absence d'approximation silencieuse :

1. `SemanticAccessDenied` et `SemanticQueryError` sortent de l'API REST en 500, sans `decision` ni `reasons`.
2. `POST /semantic/query` échoue en 500 avec le conteneur par défaut (`AttributeError` sur `_CatalogOnlyCore.db`), au lieu de l'indisponibilité prévue en 503.
3. `SemanticQuery.from_dict` ignore les clés inconnues : une demande de tri envoyée aujourd'hui serait exécutée sans tri.
4. `POST /agents/ask` ne transmet pas le contexte de la requête : la porte de certification voit `consumer_id="legacy"`.
5. La limite de service tronque sans `ORDER BY` : les lignes gardées ne sont pas déterministes.

## 6. Ordre suggéré

Sous A′ : SK-01 (point d'extension public, règle de `sql_hash`), SK-08 (RLS dans le planner, contexte complet), SK-11, SK-03, SK-09, SK-04, SK-10.

Sous B : défauts 1 à 3, SK-02 avec sa suite de contrat, SK-01, SK-08, SK-03, SK-11, SK-09, SK-04, SK-10.

L'ordre de `main` (SK-02.7 → SK-02 → SK-01 → …) supposait B.
