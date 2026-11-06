# Skifer Board — Plan de développement

Date : 31 octobre 2026

Statut : plan de cadrage pour revue, avant spécifications détaillées et implémentation.

Révision du 31 octobre 2026 : l’état des dépôts `skifer` (v4.0.0, branche `memory-improvements`) et `skifer-atlas` (plans 0001 à 0004 fusionnés) a été revérifié dans le code et les décisions, pas seulement dans les briefs. Le §3 a été réécrit en conséquence, l’héritage de la branche `main` de ce dépôt est consigné au §3.4, les attendus externes au §13.

## 1. Objectif produit

Permettre à un utilisateur de construire facilement une analyse, de l’explorer, de la sauvegarder et de la diffuser dans un dashboard fortement personnalisable. Les définitions métier s’appuient sur Atlas, les calculs sur les capacités de Skifer et les résultats respectent les droits du lecteur.

Le parcours de référence est :

> Ouvrir un espace → choisir des données ou métriques accessibles → explorer → créer éventuellement un calcul adhoc → sauvegarder une analyse → composer un dashboard → valider en TEST → publier en PROD → consulter selon ses droits.

Le caractère distinctif de Board repose sur trois capacités : continuité entre adhoc et métriques gouvernées, liberté de présentation, et déploiement versionné entre environnements.

## 2. Décisions retenues

| Sujet | Décision |
|---|---|
| Distribution | Application web partagée. |
| Atlas | Référentiel des définitions, versions, variantes, sources et étapes métier. |
| Skifer | Moteur de préparation et d’interrogation, contrôles et preuves disponibles. Son exécution est aujourd’hui Spark/Databricks uniquement (Plan 26) ; voir §3.1. |
| Board | Exploration, analyses, dashboards, partage, contexte de consultation. Les « connexions propres » ne sont pas acquises : c’est l’arbitrage du §3.3. |
| SQL | Board n’émet jamais de SQL et n’en stocke jamais. Une analyse est une requête sémantique par noms (modèle, métriques, dimensions, filtres, période), jamais une chaîne SQL. Invariant hérité de `main` (I1), maintenu. |
| Frontière vers les données | Une seule frontière, un seul client. Qui la tient (Skifer, Atlas ou un service d’exécution commun) est l’arbitrage du §3.3 ; qu’il n’y en ait qu’une n’est pas discuté. Invariant hérité de `main` (I2), maintenu. |
| Fail-closed | Une décision `DENY` ou `REQUIRE_HUMAN` de la politique de certification s’affiche telle quelle, n’est jamais contournée ni mise en cache comme un succès. Invariant hérité de `main` (I3), maintenu. |
| Responsabilité des calculs | Skifer garantit le sens et les règles des calculs analytiques ; Board exécute les agrégations contextuelles compatibles avec les résultats reçus. Atlas porte les définitions gouvernées. |
| Identité du lecteur | Le résultat dépend de l’identité, du RLS applicable et des filtres, notamment d’entité. |
| Métriques adhoc | Les usages alimentent le système de promotion de métriques prévu dans l’écosystème ; les métriques promues ont vocation à rejoindre Atlas. |
| Environnements | DEV, TEST et PROD, avec promotion et paramètres de déploiement. |
| Personnalisation | La composition du dashboard et les graphiques doivent être fortement personnalisables. |
| Graphiques | Apache ECharts est le candidat initial retenu pour validation par prototype. |
| Vault commun | Un éventuel skifer-vault est hors programme à ce stade. Si l’arbitrage du §3.3 confie des connexions à Board, Board gère leurs secrets côté serveur ; sinon il n’en détient aucun. |

### Propositions à confirmer pendant le cadrage technique

- Un espace Board est rattaché à un espace Atlas et possède plusieurs environnements.
- L’analyse sauvegardée est un objet réutilisable ; les dashboards référencent des versions d’analyses.
- L’éditeur utilise sections et conteneurs avec une mise en page responsive.
- Les responsabilités initiales sont consulter, créer et administrer, auxquelles s’ajoute le droit de déployer par environnement.
- La première intégration distante vise Databricks. Les autres connecteurs restent des extensions.

## 3. État des dépendances et points d’attention

Lecture des dépôts refaite le 31 octobre 2026, dans le code et les décisions. Chaque ligne ci-dessous distingue ce qui **existe** (code fusionné) de ce qui est **planifié** (document validé, aucun code) et de ce qui est **absent** (ni l’un ni l’autre). Les capacités doivent être revérifiées au démarrage de chaque lot concerné.

### 3.1 Skifer (v4.0.0, branche `memory-improvements`)

| Capacité | État | Détail vérifié |
|---|---|---|
| Requête sémantique sans SQL | Existe | `QueryResolver` construit le SQL de façon déterministe ; `AgentReadyDataService` est la frontière (scopes `models:read`, `query:execute`, plafonds `ServiceLimits`, pagination opaque, `truncated`). |
| Preuve par requête | Existe | `SemanticEvidence` : `evidence_id`, `trace_id`, `model_keys`, `metrics` (avec hashs de définition), `dimensions`, `normalized_filters`, `sources` (certification), `policy`, `sql_hash`, `statement_id`, durées, statut. |
| Certification fail-closed | Existe | `access_policy.evaluate()`, `ConsumerContext` (`consumer_id`, `consumer_class`, `user_id`, `scopes`, `trace_id`), modes `off / warn / enforce / supervised`. |
| Modèle de métrique | Existe, limité | Types `sum`, `count`, `count_distinct`, `avg`, `min`, `max` ; `additivity` (`additive`, `semi_additive`, `non_additive`) ; `non_additive_dimensions` ; `grain` au niveau du modèle ; calendriers versionnés. **Pas de ratio, pas de métrique dérivée, pas d’exposition des composantes** (somme et effectif d’une moyenne). |
| Forme du résultat de requête | Existe, limité | Lignes, `truncated`, evidence. **Ni grain du résultat, ni règles de réagrégation, ni complétude autre que `truncated`.** |
| API HTTP | Existe, locale | FastAPI loopback uniquement (`127.0.0.1`, `::1`), identité dérivée de l’OS par `LocalIdentity`. Routes 1:1 avec `services/` : `semantic`, `catalog`, `certifications`, `lineage`, `dictionary`, `jobs`, `session`, `identity`… Aucun bearer vérifié, aucun bind distant. |
| Exécutions suivies | Existe | `ExecutionService` : `submit`, `status`, `cancel`, `logs`, `result` borné (`ResultView`), une session à la fois. |
| Backend d’exécution | Spark uniquement | `SparkBackend` est le seul runtime (Plan 26). Aucun DuckDB, aucun backend Statement Execution autonome pour la couche sémantique. Le « plan 35B » cité par l’ancien `CLAUDE.md` du Board n’a jamais existé : le plan 35 de skifer est le câblage de gouvernance. |
| RLS | Absent | Aucun filtrage de lignes par sujet nulle part dans `src/skifer`. Les scopes et la certification n’en tiennent pas lieu. |
| Événements d’usage | Existe, interne | `adaptive/` : `SemanticUsageEvent` (`event_id`, `occurred_at`, `environment`, `consumer_class`, `model_hashes`, `metric_ids`, `dimension_ids`, `normalized_filter_shape`, `query_fingerprint`, `duration_ms`, `rows_returned`, `status`), stores append-only alimentés par le moteur. **Aucune route d’ingestion externe.** |
| Métriques candidates (Plan 44) | Planifié, rien d’implémenté | Vérifié ce jour dans l’en-tête du plan. 11 specs, 33 slices. Une candidate naît d’une **question en langage naturel** que `GenBIAgent` ne résout pas, convertie par LLM en schéma de pipeline dans la grammaire fermée, validée par cohérence / fréquence / stabilité. **D6 révisée : ni API ni application en v1**, arbitrage par notebook Databricks et CLI. Aucune spec ne prévoit l’ingestion d’une candidate externe. |
| Agent, MCP, export | Existe | `GenBIAgent`, `AgenticHub`, serveur MCP read-only (loopback, bearer injecté), `HistoryExporter` PDF (fpdf2), `AlertDispatcher`. Non utilisés en V1 Board (§11), mais existants : ne pas les redessiner. |
| Environnements | Existe | `ConfigurationManager` détecte `LOCAL / DEV / QA / PROD`. Board écrit `DEV / TEST / PROD` : l’alignement est à arbitrer (§10). |

### 3.2 Atlas (plans 0001 à 0004 fusionnés le 30 octobre 2026)

| Capacité | État | Détail vérifié |
|---|---|---|
| Modèle des documents | Existe | `model/` : dix types de nœuds, concept, KPI, déclinaison ; `data_product` avec `id`, `version` (entier), `owner`, `domain` ; JSON Schema versionné (`schema_version`). |
| Validation, variantes, normalisation, empreinte | Existe | `atlas validate / check / resolve / normalize / fingerprint` (`sha256:atlas1:`). |
| Diff structurel | Existe | `atlas diff`, rapport conforme à `diff-report.v1.schema.json`, classification des écarts. |
| Extraction SQL → brouillons | Existe | `atlas extract` (`databricks`, `snowflake`), résidus, `needs_curation` (ADR 0006). |
| API | Existe, minimale | Deux routes : `/health` et `/api/workspaces` (lecture, création). Sidecar FastAPI sur `127.0.0.1`, token de session Tauri (ADR 0001). |
| Espaces, dépôt Git, catalogue indexé | Planifié (0005) | Un espace = un clone Git + une base DuckDB locale ; identité = compte GitHub ; `governance.yaml` versionné ; `CODEOWNERS` généré (ADR 0005). |
| Propositions et gouvernance | Planifié (0006) | Une sauvegarde crée une PR ; validations décomptées sur les revues de l’hébergeur. |
| Compilation SQL multi-dialecte | Planifié (0007) | ADR 0004 acceptée : AST SQLGlot, une CTE par nœud, dialectes `databricks`, `snowflake`, `duckdb`. **Aucun compilateur dans le code aujourd’hui.** |
| Coffre et connecteur Databricks | Planifié (0008) | Coffre **personnel, par espace, jamais sur un serveur** ; OAuth utilisateur d’abord ; registre des points d’accès ; exécution push-down avec les droits de la personne ; comptes de service reportés « beaucoup plus tard » (brief §7.2, §12). |
| Comparaison chiffrée | Planifié (0009) | Résultats dans DuckDB local, par espace. |
| Format pivot | Décidé | Le YAML Skifer est le format de tous les modules (ADR 0002). Atlas dépend du paquet `skifer` épinglé `v4.0.0` sans extra Spark et réutilise ses catalogues d’opérateurs ; le modèle doit remonter dans le moteur une fois stable (ADR 0003). |

Conséquence pour Board : le lot 04 « Catalogue Atlas » dépend du plan 0005 d’Atlas, qui n’est pas commencé. La « correspondance KPI Atlas → requête exécutable » n’est pas un défaut de format commun, le format est commun ; c’est l’absence de mapping entre deux objets du même YAML : le bloc `graph` d’un document Atlas et le modèle sémantique skifer (métriques, dimensions, `additivity`, `grain`) que `SemanticQuery` consomme. Ce mapping n’existe dans aucun des deux dépôts.

Mise à jour du 1er novembre 2026 : ce tableau date du 30 octobre et n’est plus exact pour le catalogue. Au commit `fe334267` de `origin/main`, le plan 0005 d’Atlas est livré : index DuckDB d’un clone, recherche, facettes, fiches, dépendances et versions par tags `doc/<id>/v<n>`. Le code contient aussi les modules `proposals`, `compile`, `vault`, `connectors` et `compare`, que Board n’a pas relus : leur état n’est pas vérifié ici. Le lot 04 lit ce catalogue en bibliothèque ([plan 04](roadmap/04_catalogue_atlas_plan.md), §1) ; le mapping KPI → modèle sémantique (AT-02) reste absent des deux dépôts.

### 3.3 Contradiction à trancher en premier : qui exécute, qui détient les connexions

Trois textes en vigueur décrivent trois exécuteurs différents pour la même requête :

| Texte | Exécuteur | Connexions et identité |
|---|---|---|
| Ce plan, versions antérieures (§2 « connexions propres », §5.1, §7, lot 03) | Skifer « avec push-down », mais connexions **détenues par Board**, secrets **côté serveur**, par environnement. | Identité déléguée ou compte de service, « documenté par connecteur ». |
| Skifer (code, Plan 26) | Spark/Databricks uniquement, dans un processus qui a une session Spark. | Identité OS locale ; aucune API distante ; aucun RLS. |
| Atlas (brief §7, ADR 0004, plan 0008) | **Atlas lui-même**, compilation SQLGlot et push-down, « parce que le moteur est limité à Spark ». | **Registre des points d’accès dans Atlas**, coffre personnel, droits de la personne, **jamais de token sur un serveur**, pas de compte de service avant longtemps. |
| Board `main` (roadmap 00, invariants I1, I2) | Skifer, via un backend sans Spark à construire (SK-01) et une API distante (SK-02). | Un seul client HTTP ; **aucun JDBC, Delta ou Spark dans Board** ; identité SSO traduite en bearer skifer (SK-08). |

Les positions « Board détient des connexions avec secrets côté serveur » et « les tokens ne sont jamais sur un serveur, chaque exécution porte les droits de la personne » sont incompatibles. Une application web partagée qui exécute pour un lecteur authentifié par SSO ne peut pas, non plus, utiliser un coffre posé sur le poste de ce lecteur. Le plan ne peut pas laisser les trois textes coexister.

Options, avec leur coût réel :

| Option | Ce qu’il faut construire | Ce que ça contredit |
|---|---|---|
| A. Board exécute lui-même avec ses connexions | Connecteurs, coffre serveur, propagation d’identité, RLS, et un compilateur sémantique → SQL dans Board. | I1 et I2 de `main`, le brief Atlas §7.2, et le principe « aucune couche sémantique propre » : Board redevient un troisième compilateur. |
| B. Skifer exécute | SK-01 (backend sans Spark : Statement Execution API, DuckDB), SK-02 (API distante avec bearer vérifié), SK-08 (identité SSO → `RequestContext`, RLS dans le planner). Rien de tout cela n’est planifié côté skifer aujourd’hui. | Rien côté Board. Côté Atlas, ADR 0004 reste valable pour la comparaison locale ; il y a alors deux compilateurs dans l’écosystème, ce que l’ADR 0003 prévoit de résorber. |
| C. Service d’exécution commun issu du compilateur Atlas (0007), remonté dans le moteur (ADR 0003), exposé par une API hébergée | Le plan 0007 d’Atlas, puis sa remontée dans skifer comme backend Spark-free, puis SK-02 et SK-08. Chemin le plus long mais un seul compilateur à la fin. | L’hypothèse Atlas « local-first, rien d’hébergé » (brief §8.4, §12 « mode hébergé : à l’usage »). |

Variante A′, apparue à la discussion du 31 octobre 2026 : Board **embarque skifer comme bibliothèque** (modèle sémantique, `QueryResolver`, politique de certification, evidence, tous importables sans Spark, comme Atlas le fait déjà avec `skifer` épinglé) et exécute le SQL produit par le résolveur avec **ses propres connecteurs** (Databricks SQL, DuckDB) après transpilation sqlglot. Les invariants tiennent : Board n’écrit pas de SQL, le résolveur skifer l’écrit ; la frontière est la bibliothèque skifer, unique. Ce qui change par rapport à B : SK-01 et SK-02 sont réalisés dans le backend Board au lieu d’attendre skifer, et la décision D10 de `main` (aucun import `skifer` dans Board) tombe. Ce qui ne change pas : SK-08 (identité, RLS) reste à construire quelque part, et un coffre côté serveur est inévitable dans **toutes** les options pour une application web partagée, B compris, puisque l’API skifer devrait alors détenir les identifiants. L’objection Atlas « jamais de token sur un serveur » vaut pour une application de bureau, pas pour Board.

Décision du 2 novembre 2026 : **A′ est retenue** (§10.2, D-1). Le paragraphe suivant est la proposition antérieure, conservée pour l’historique. Proposition de ce plan, **à valider par le porteur** : B comme cible contractuelle de Board (Board ne parle qu’à une API skifer, un seul client, invariants I1 à I3 conservés), C comme trajectoire de l’écosystème pour n’avoir qu’un compilateur. L’option A est écartée : elle ferait de Board ce que le projet a décidé qu’il ne serait pas. Tant que B n’est pas livré côté skifer, Board se développe contre un simulateur de cette API (comme la suite de contrat de `main`, §3.4) et **aucun lot qui touche des données réelles n’est considéré livré**.

Tant que l’arbitrage n’est pas rendu, les mentions « connexions Board », « liaison de connexion », « référence de secret » et « secrets côté serveur » dans ce document (§4.1, §5.1, §7, lot 03) se lisent comme **l’option A, non retenue**, conservées pour que la comparaison reste lisible.

### 3.4 Héritage de la branche `main` de ce dépôt

Le commit de reboot a supprimé le monorepo du plan 01 (dernier état : `63697c9`). Rien n’est perdu, tout est dans l’historique, mais le plan doit dire ce qu’il en fait. Inventaire et sort proposé :

| Livrable de `main` | Contenu | Sort proposé |
|---|---|---|
| `docs/roadmap/00_attendus_skifer.md` | Neuf attendus nommés SK-01 à SK-09 : backend sans Spark, API REST publique sur `AgentReadyDataService` (surface, corps et réponse de `POST /query`, limites, erreurs, authentification, suite de contrat), tri et top-N, ingestion des événements d’usage, endpoint agent, briques de reporting, modèles template, identité et RLS, signaux d’invalidation. | **Repris** au §13 comme base des attendus externes ; complété par les attendus Atlas et par le contrat de réagrégation du §4.6. |
| `docs/roadmap/00_roadmap.md` | Invariants I1 à I7, architecture cible, phases. | I1, I2, I3 **repris** au §2. I4 (provenance par tuile) **repris** au §4.2. I5 (dashboard as code en YAML sur git) **à arbitrer** (§10). I6 (LLM optionnel) **repris** : aucun lot V1 ne dépend d’un LLM. I7 (licences permissives vérifiées) **repris**. |
| Spécification « Dashboard as YAML » v1 | JSON Schema draft 2020-12 source de vérité, types TS et Pydantic générés, validation structurelle des deux côtés, règles inter-champs côté Python, `query` = corps de `POST /query` sans `limit`, `viz.kind` fermé, filtres globaux avec liaisons `$filters.<nom>`, codes d’erreur, corpus de fixtures, deux dashboards d’exemple. | **Entrée du lot 06 et du lot 09.** Ce plan sépare requête, présentation et disposition (§4.1) et ajoute analyses versionnées et releases : la spec v1 est le point de départ du format de sérialisation d’une analyse et d’un manifeste de release, pas un concurrent. |
| `SkiferClient` | Client HTTP unique, fail-closed sur 2xx dont la policy est `DENY` ou `REQUIRE_HUMAN` (D18), garde de pagination sur curseurs déjà vus (D17), aucune donnée de réponse dans une exception (D21), couverture 100 % (D19), aucun import `skifer` ni `pyspark` vérifié par un test (D10). | **Repris** : ce sont les règles de l’adaptateur Skifer du §7, quelle que soit l’option du §3.3. |
| Suite de tests de contrat et mock skifer | pytest agnostique de la cible (base URL ou ASGI), états préparés (`DENY`, `LimitExceeded`, `InvalidCursor`…), proposée à skifer comme artefact SK-02.7. | **Repris** : c’est le simulateur du §3.3 et le moyen de ne pas déclarer une intégration livrée sur un mock. |
| Module `identity` | Identité locale minimale avec repli, test « aucune identité forgée depuis la requête ». | **Repris** comme règle (§4.3) ; l’implémentation dépend du fournisseur d’identité (§10). |
| Chaîne agent (`CLAUDE.md`, `AGENTS.md`, `agent.yml`, `.mcp.json`) et conventions (`docs/roadmap/NN_*`, un point de plan = un commit, test + CHANGELOG, jamais de bump) | Supprimés par le reboot. | **À rétablir** avant le premier lot, au moins un `CLAUDE.md` minimal portant les invariants du §2 et les règles du §12. |

Board intègre les capacités des autres dépôts par des adaptateurs et des contrats versionnés. Les simulateurs servent au développement, mais ne suffisent pas à déclarer une intégration livrée.

## 4. Modèle fonctionnel cible

### 4.1 Objets

| Objet | Contenu et responsabilité |
|---|---|
| Espace | Membres, accès, rattachement Atlas, environnements et contenus partagés. |
| Environnement | Connexions effectives, paramètres, droits de déploiement et release active. |
| Connexion logique | Référence stable utilisée par les analyses, par exemple `finance`. |
| Liaison de connexion | Configuration et référence de secret propres à un environnement. |
| Référence métier | Identité Atlas, version et éventuelle déclinaison ; correspondance avec le modèle exécutable. |
| Métrique adhoc | Calcul structuré, identité stable, révisions et référence au cycle de promotion externe. |
| Analyse | Requête structurée, métriques, dimensions, filtres, période, calculs contextuels avec leur périmètre et présentation par défaut. |
| Dashboard | Pages ou sections, composants, références d’analyses et filtres communs. |
| Thème | Typographie, couleurs, espacements, formats et valeurs visuelles par défaut. |
| Exécution | Contexte autorisé, statut, résultat borné, grain, règles de réagrégation, composantes nécessaires, complétude, fraîcheur et preuves disponibles. |
| Release | Manifeste immuable des versions de contenus et dépendances déployées. |
| Promotion | Passage d’une release vers un environnement, paramètres résolus, contrôles et journal. |

Les objets ont une identité logique stable et des révisions immuables. La requête, la présentation du visuel et la disposition dans la page sont sauvegardées séparément.

### 4.2 Exploration et réutilisation

- Sélection de métriques et dimensions, filtres et périodes ; seules les combinaisons prises en charge sont exécutables.
- Résultat sous forme de tableau ou de graphique ; accès à la définition métier et aux preuves disponibles.
- Tout ce qui est affiché a une provenance (invariant I4 hérité de `main`) : chaque visuel porte au minimum l’`evidence_id`, le `sql_hash`, le statut de certification des sources et l’âge de la donnée, tels que renvoyés par `SemanticEvidence`. Un calcul contextuel (§4.6) affiche en plus l’exécution source et son périmètre.
- Une analyse peut être personnelle ou partagée et alimenter plusieurs dashboards.
- Modifier une analyse réutilisée affiche ses consommateurs ; l’utilisateur peut créer une nouvelle révision ou une copie indépendante.
- Les explorations d’un lecteur ne modifient pas la définition partagée ; une sauvegarde personnelle exige le droit de création.
- Une future entrée en langage naturel produit le même objet d’analyse inspectable et modifiable.

### 4.3 Droits et contexte de consultation

Les restrictions de sécurité et les filtres d’exploration sont distincts. Enlever un filtre ne peut jamais élargir les droits du lecteur. Partager un contenu n’accorde aucun droit sur ses données.

Le backend établit l’identité et le contexte autorisé. Les identités, entités ou rôles reçus du navigateur ne sont pas des preuves d’autorisation.

Le choix entre identité déléguée à la source et compte de service avec politiques imposées doit être documenté par connecteur. Un compte de service ne permet pas de prétendre que le RLS natif de la source représente automatiquement le lecteur.

Tout cache doit être isolé par espace, environnement, version de requête, paramètres et contexte effectif d’autorisation. Une évolution de droits doit invalider ou rendre inaccessibles les résultats précédemment autorisés. Les exports et prévisualisations suivent les mêmes règles.

Clé et fraîcheur du cache (hérité de `main`) : la clé naturelle d’un résultat est le `sql_hash` de l’evidence, combiné au contexte d’autorisation effectif ; l’invalidation s’appuie sur les hashs de définition des métriques et des sources renvoyés par l’evidence. Une route de lecture de ces hashs sans exécution (SK-09, §13) rend la vérification peu coûteuse. Sans elle, un résultat en cache ne peut être servi qu’avec son âge affiché.

### 4.4 Métriques adhoc et promotion métier

Board conserve une définition structurée et transmet des événements d’usage au système de promotion. Une simple égalité de libellés ne suffit pas à identifier deux métriques ; la détection doit inclure le contexte sémantique et les dépendances du calcul.

Les seuils, décisions et états de promotion appartiennent au mécanisme de l’écosystème. Board affiche ces états et assure la continuité des références lorsqu’une métrique rejoint Atlas. Une modification de sens nécessite une nouvelle version et une migration explicite des consommateurs.

La promotion métier d’une métrique et la promotion technique d’une release entre environnements sont deux cycles indépendants.

Ce que le Plan 44 de skifer appelle « métrique candidate » n’est pas la « métrique adhoc » de Board. Une candidate skifer est une **question en langage naturel** que l’agent certifié ne sait pas résoudre, convertie par LLM en schéma de pipeline, exécutée et rendue « non certifiée » ; sa validation compte des runs de candidates et des événements d’usage internes au moteur. Une métrique adhoc Board est un **calcul structuré** défini sans LLM sur un résultat sémantique. Pour que la seconde entre dans le cycle de la première, il faut côté skifer : une forme de candidate acceptant une définition structurée externe, une route ou un mécanisme d’ingestion (D6 révisée exclut toute API en v1), et un retour d’état lisible par Board. Aucun des trois n’est planifié. C’est l’attendu SK-10 du §13, et le lot 10 n’est livrable qu’après.

### 4.5 Répartition des calculs

| Niveau | Exemples | Définition et exécution |
|---|---|---|
| Métier | CA net, marge, clients actifs | Définition gouvernée dans Atlas ou candidate créée dans Board ; validation et exécution analytique sous la responsabilité de Skifer, avec push-down vers la source lorsque possible. |
| Contextuel | Total de la sélection, regroupement, sous-total, part du résultat affiché | Définition sauvegardée dans l’analyse ; calcul dans Board lorsque le contrat du résultat le permet, sinon nouvelle requête au moteur. |
| Présentation | Arrondi d’affichage, unité, couleur conditionnelle, étiquette | Configuration du visuel et exécution dans Board. |

Une métrique adhoc doit pouvoir être exécutée avant sa promotion dans Atlas : le contrat cible prévoit une définition structurée temporaire, validée par Skifer et soumise aux mêmes restrictions d’accès. La disponibilité de cette capacité doit être vérifiée au lot 00. La promotion conserve la sémantique d’exécution ; un changement de sens crée une nouvelle version.

Board possède une couche de calcul contextuel distincte du moteur de rendu graphique. ECharts reçoit les résultats préparés ; ses transformations ne constituent pas une définition métier parallèle. Cette couche peut calculer dans le navigateur sur les données déjà autorisées, sans appel réseau pour chaque sélection. Son placement technique et ses limites de volume seront précisés dans les spécifications.

### 4.6 Agrégations contextuelles et contrat des résultats

Exemple : sélectionner trois régions peut immédiatement afficher leur CA cumulé et leur part dans le résultat chargé, si le montant est additif sur cette dimension et que le résultat contient les données nécessaires.

Les opérations autorisées dépendent de la métrique et des dimensions :

| Nature de la mesure | Règle de réagrégation |
|---|---|
| Montant additif | Somme sur les dimensions déclarées compatibles, sans double comptage. |
| Moyenne | Recalcul à partir de la somme et de l’effectif ; pas de moyenne simple de moyennes. |
| Taux ou ratio | Recalcul à partir du numérateur et du dénominateur selon leur propre règle d’agrégation. |
| Nombre distinct | Pas de somme des comptes par groupe ; nouvelle requête sauf représentation de fusion explicitement prise en charge. |
| Stock ou autre mesure semi-additive | Agrégation selon les dimensions autorisées ; une somme dans le temps n’est pas présumée valide. |

Le contrat retourné par Skifer doit fournir le grain du résultat, les opérations et dimensions compatibles, les composantes nécessaires et autorisées, ainsi que l’état de complétude (pagination, troncature, top N et périmètre couvert). L’absence d’une règle ne vaut pas autorisation de sommer. Les règles de précision numérique, de valeurs nulles et de dénominateur nul doivent être définies pour conserver la cohérence entre Board et le moteur.

État réel de ce contrat dans skifer (§3.1) : le modèle sémantique porte déjà `additivity`, `non_additive_dimensions` et `grain`, ce qui couvre les lignes « montant additif » et « semi-additif » du tableau. Il ne porte **ni ratio, ni métrique dérivée, ni composantes** : les lignes « moyenne » et « taux ou ratio » n’ont aucune définition sur laquelle s’appuyer, et le résultat de requête ne renvoie ni grain ni règles. Ce contrat n’est donc pas « à lire » au lot 00 : c’est une **évolution du modèle sémantique et de la réponse de requête de skifer**, à demander avec un propriétaire (SK-11, §13). En attendant, Board ne réagrège localement que les métriques `additive` sur leurs dimensions compatibles, et renvoie tout le reste au moteur.

Chaque calcul précise son périmètre : **sélection courante**, **résultat chargé** ou **ensemble du périmètre filtré**. Un total sur une page ou un top N peut être affiché comme tel, mais jamais présenté comme le total complet. Pour une part du total, le dénominateur et les filtres d’exploration conservés ou retirés sont explicites. Le RLS n’est jamais retiré.

Si les données sont insuffisantes ou la réagrégation incompatible, Board demande au moteur un résultat au grain et au périmètre requis. Si cette opération n’est pas prise en charge, le calcul est déclaré indisponible avec une explication ; aucune approximation silencieuse n’est produite.

Les composantes intermédiaires retournées au navigateur respectent elles aussi les droits du lecteur. Tout calcul local conserve la référence de l’exécution source et son périmètre ; il ne reçoit pas artificiellement un statut de certification métier. Un changement d’identité, de droits ou de contexte invalide également les résultats contextuels associés.

La définition des calculs contextuels, leur ordre d’application et leurs règles de périmètre sont versionnés avec l’analyse et transportés dans les releases. Les sélections temporaires du lecteur restent personnelles, sauf sauvegarde explicite d’une exploration.

## 5. Environnements et déploiement

### 5.1 Paramètres

Les paramètres de déploiement sont déclarés avec un type, un caractère obligatoire ou optionnel, une éventuelle valeur par défaut et des contraintes. Ils ne sont pas modifiables par les filtres du dashboard.

| Référence | DEV | TEST | PROD |
|---|---|---|---|
| Connexion logique `finance` | Connexion DEV | Connexion TEST | Connexion PROD |
| Catalogue | `finance_dev` | `finance_test` | `finance_prod` |
| Schéma | `analytics` | `analytics` | `analytics` |
| Authentification | Référence de secret DEV | Référence de secret TEST | Référence de secret PROD |

La substitution est typée et validée ; elle ne repose pas sur des remplacements libres de chaînes dans du SQL. Une liaison cible doit être compatible avec les champs et modèles attendus.

### 5.2 Contenu d’une release

Une release fige dashboards, analyses, calculs adhoc, thèmes, composants visuels, paramètres déclarés et références métier. Les dépendances transitives sont incluses ou référencées par version vérifiable.

Elle ne transporte ni données, ni caches, ni secrets. Elle ne déploie pas automatiquement des pipelines Skifer ou des définitions Atlas : les versions nécessaires doivent exister dans la cible, sinon le déploiement échoue avec un diagnostic explicite.

### 5.3 Parcours

1. Choisir les contenus et calculer leurs dépendances.
2. Comparer la release avec l’état cible ; identifier les impacts et conflits.
3. Résoudre les paramètres et liaisons de connexion.
4. Vérifier les autorisations, dépendances, schémas et compatibilités.
5. Exécuter les contrôles de recette requis.
6. Autoriser l’activation selon le droit de déploiement de la cible.
7. Activer atomiquement la release et conserver son journal.

Un échec laisse la release active inchangée. Les mises à jour concurrentes sont détectées. Un retour arrière réactive une release antérieure après vérification de ses dépendances ; il ne restaure pas les données des plateformes sources.

## 6. Visualisation et personnalisation

### 6.1 Choix à valider

| Option | Licence | Positionnement |
|---|---|---|
| Apache ECharts | Apache-2.0 | Candidat initial : variété de graphiques, thèmes, interactions et séries personnalisées. |
| Vega / Vega-Lite | BSD-3-Clause | Alternative pour une grammaire déclarative et des compositions avancées. |
| visx | MIT | Alternative pour des composants React construits sur mesure, avec davantage de développement. |

La V1 doit utiliser un seul moteur graphique principal. Une interface de rendu interne laisse une possibilité d’extension sans imposer plusieurs moteurs dès le départ.

### 6.2 Trois niveaux de personnalisation

1. **Composition** : sections, colonnes, conteneurs imbriqués, textes, images, fonds, dimensions, espacements, filtres et comportement responsive.
2. **Graphiques** : axes, échelles, légendes, formats, couleurs conditionnelles, seuils, annotations, infobulles, sélection et navigation vers une analyse.
3. **Réutilisation** : thèmes, modèles de pages et composants approuvés, versionnés et transportables dans les releases.

Les valeurs sont héritées du thème, puis ajustables sur le dashboard et le composant. Une personnalisation visuelle ne doit pas changer silencieusement le calcul métier.

La V1 privilégie un éditeur structuré par conteneurs. Le positionnement libre au pixel, les scripts arbitraires et une place de marché de composants ne sont pas requis pour la première livraison. Les extensions programmées passent par un mécanisme maîtrisé ; aucun JavaScript saisi par un auteur ne s’exécute librement dans la session des lecteurs.

### 6.3 Prototype de décision

Éprouver ECharts sur un graphique combiné, un waterfall, une heatmap, un KPI enrichi et une sélection filtrant une autre vue. Inclure thème personnalisé, redimensionnement, clavier, alternative tabulaire et export visuel si retenu.

Le prototype mesure le temps de rendu, les interactions et la mémoire sur des tailles de résultats et un nombre de tuiles définis avant l’essai. Il produit une décision argumentée ; les objectifs chiffrés de performance restent à fixer au lot 00.

## 7. Architecture cible

```text
Navigateur Board
  Exploration · éditeur · consultation · déploiements
                         │
Backend Board authentifié
  Espaces et droits · contenus versionnés · exécutions
  Connexions · paramètres · releases · événements d’usage
          │                    │                    │
    Adaptateur Atlas    Adaptateur Skifer    [Connexions Board]
    Définitions         Requêtes / preuves   option A du §3.3,
    Versions            Promotion métier     non retenue par ce plan
```

La troisième branche n’existe que si l’arbitrage du §3.3 retient l’option A. Dans les options B et C, Board n’a qu’une frontière vers les données, l’adaptateur Skifer, qui reprend les règles du `SkiferClient` de `main` (§3.4).

La frontière fonctionnelle des calculs est fixée aux §4.5–4.6. Le lot 00 doit préciser sa réalisation : transmission du contexte et des connexions Board au moteur, contrat de réagrégation et intervention éventuelle d’un composant Atlas. Il doit aussi définir comment les compilateurs Atlas et Skifer garantissent la cohérence d’un même KPI. Aucun chemin direct ni calcul contextuel ne doit contourner les politiques retenues.

Proposition de socle à confirmer : frontend React/TypeScript, backend Python/FastAPI pour la proximité avec l’écosystème, base transactionnelle PostgreSQL pour les métadonnées Board. Le déploiement des services, le fournisseur d’identité et le mécanisme de stockage des secrets restent à sélectionner.

Orientation « stack orientée données » (§10.1) : le backend n’est pas un CRUD devant une base, c’est une chaîne de traitement de données. Conséquences proposées : résultats de requête reçus et conservés en **Arrow**, jamais convertis en JSON ligne à ligne ; **DuckDB embarqué** dans le backend pour les calculs contextuels (§4.6), le cache de résultats clé `sql_hash` et les sous-totaux, sur des tables Arrow déjà autorisées ; transport **Arrow IPC** vers le navigateur ; côté client, lecture Arrow native et un composant de tableau et pivot conçu pour le colonnaire (Perspective, FINOS, Apache-2.0, déjà identifié par `main`) à côté d’ECharts pour les graphiques ; PostgreSQL ne porte que l’index des contenus, les releases, le journal et les événements. Si la variante A′ du §3.3 est retenue, DuckDB sert aussi d’exécuteur local et de cible de transpilation, comme dans Atlas (ADR 0004).

Les requêtes longues sont représentées par des exécutions suivies et annulables. Les limites de résultats et délais sont explicites ; une troncature ne peut pas être présentée comme un total complet. Les traces permettent de relier l’analyse, l’environnement, l’exécution et les preuves retournées sans journaliser les secrets.

## 8. Lots de développement

Les tailles sont relatives : S = limité, M = plusieurs composants, L = transverse. Elles ne constituent pas un calendrier.

| Lot | Livrable | Dépendances | Taille |
|---|---|---|---|
| 00 | Contrats d’intégration, décisions techniques et périmètre V1 | — | M |
| 01 | Prototype de personnalisation et choix graphique | 00, partie visualisation | M |
| 02 | Socle web, identité, espaces et environnements | 00 | L |
| 03 | Connexions, paramètres et exécution autorisée | 02 | L |
| 04 | Catalogue Atlas et correspondances exécutables | 00, 02 | M |
| 05 | Exploration visuelle sur données réelles | 01, 03, 04 | L |
| 06 | Analyses versionnées et calculs adhoc | 05 | L |
| 07 | Éditeur de dashboards et thèmes | 01, 06 | L |
| 08 | Partage, consultation et interactions | 03, 07 | M |
| 09 | Promotion DEV/TEST/PROD | 02, 03, 04, 06, 07 | L |
| 10 | Intégration du cycle de promotion des métriques | 06, contrat externe disponible | M |
| 11 | Recette de bout en bout et pilote | 08, 09, 10 | L |

### Lot 00 — Cadrage et contrats

**Travaux** : vérifier les API réellement disponibles, choisir l’accès partagé à Atlas, définir la correspondance KPI/modèle exécutable, le contexte d’identité, le contrat des résultats, les paramètres et le protocole de promotion métier. Fixer les parcours V1, volumes de référence et objectifs de performance. Décider la stack et l’hébergement.

Le contrat des résultats inclut grain, règles de réagrégation par dimension, composantes autorisées, précision et complétude. Définir le protocole de retour au moteur lorsqu’un calcul contextuel ne peut pas être exécuté dans Board.

Le lot 00 se scinde en deux parties qui n’ont pas le même propriétaire. **00a, décisions que Board prend seul** : arbitrage du §3.3, stack, hébergement, fournisseur d’identité, stockage des contenus (§10), parcours et volumes V1. **00b, attendus externes** : les deux documents du §13, un pour skifer, un pour Atlas, chacun avec un propriétaire côté dépôt cible. Le simulateur de l’API skifer et la suite de contrat de `main` (§3.4) sont remis en service dans ce lot.

**Acceptation** : décisions enregistrées ; exemples de requêtes et réponses versionnés ; une métrique Atlas reliée sans ambiguïté à un calcul exécutable ; état réel du système de promotion documenté ; stratégie RLS démontrable avec deux lecteurs. Chaque capacité absente a un responsable et un lot de dépendance externe.

### Lot 01 — Prototype graphique

**Travaux** : réaliser les cinq cas du §6.3 dans une page composée, tester les personnalisations et le comportement responsive, comparer une alternative seulement si un besoin clé échoue.

**Acceptation** : un thème change les visuels sans modifier les analyses ; les sélections produisent des événements exploitables par Board ; les limites de rendu et d’accessibilité sont documentées ; décision de bibliothèque enregistrée.

### Lot 02 — Socle partagé

**Travaux** : authentification, sessions, espaces, appartenance, autorisations, environnements, persistance et migrations. Coque de navigation avec espace et environnement visibles.

**Acceptation** : deux espaces sont isolés côté API ; un lecteur ne peut pas écrire ; les droits de déploiement sont vérifiés côté serveur ; les environnements d’un même espace possèdent des configurations distinctes. Une base vierge peut être initialisée et une base existante migrée.

### Lot 03 — Connexions et exécution

**Travaux** : registre de connexions logiques et liaisons par environnement, secrets côté serveur, test de connexion, propagation d’identité, exécution suivie, annulation, limites et preuves. Pas de cache partagé avant démonstration de son isolation.

**Acceptation** : deux lecteurs avec des droits différents reçoivent uniquement leurs données ; un filtre retiré ne change pas ces droits ; le navigateur ne reçoit aucun secret ; connexion expirée, délai dépassé et résultat tronqué sont explicitement distingués ; une annulation est propagée selon les capacités du connecteur.

Les résultats et composantes de réagrégation respectent le même contexte d’autorisation. Les métadonnées de grain et de complétude sont présentes ; une demande de total hors de la sélection ne retire jamais le RLS.

### Lot 04 — Catalogue métier

**Travaux** : recherche par domaine et synonyme, métriques, dimensions, versions, variantes, état de disponibilité et correspondances avec les connexions et modèles.

Dépendance externe : le catalogue Atlas est le plan 0005 d’Atlas, non commencé (§3.2). L’API Atlas actuelle n’expose que les espaces. Le lot peut démarrer sur les documents YAML d’un dépôt d’espace lus directement (format pivot, ADR 0002), mais n’est pas livré tant qu’il ne consomme pas un catalogue Atlas réel.

**Acceptation** : chaque métrique exécutable possède une référence métier traçable ; une référence non résolue est signalée ; une indisponibilité d’Atlas a un comportement explicite ; une analyse épinglée à une version ne bascule pas silencieusement vers la dernière.

### Lot 05 — Exploration

**Travaux** : sélection des métriques/dimensions, filtres typés, périodes, tableaux, premiers graphiques, diagnostics de combinaisons incompatibles et inspection des preuves.

Implémenter la couche d’agrégation contextuelle de Board : regroupements, sous-totaux, total de sélection et parts de total, avec contrôle des règles et retour au moteur si nécessaire. Afficher le périmètre de chaque résultat dérivé.

**Acceptation** : un utilisateur réalise une analyse de bout en bout sur une source réelle sans écrire de SQL ; les résultats correspondent à une requête de référence ; les états chargement, vide, refus, erreur et troncature sont traités ; le changement de contexte ne réaffiche pas un résultat devenu non autorisé.

Cas de recette supplémentaires (les cas « moyenne pondérée » et « ratio recalculé » supposent SK-11 livré, §4.6 ; sans lui ils se recettent par retour au moteur) : somme d’une sélection compatible sans requête ; moyenne pondérée sur groupes de tailles différentes ; ratio recalculé ; refus de sommer des comptes distincts et un stock dans le temps sans règle adaptée ; total d’un résultat tronqué clairement limité au résultat chargé ; retour au moteur pour le total complet ; cohérence numérique entre calcul local et requête de référence. Un changement de droits invalide aussi les résultats dérivés.

### Lot 06 — Analyses et adhoc

**Travaux** : sauvegarde, révisions, duplication, références stables, calculs structurés dans le périmètre retenu, empreinte sémantique et événements d’usage durables.

Sauvegarder les définitions et périmètres des calculs contextuels avec l’analyse, séparément des sélections temporaires. Inclure ces définitions dans le versionnement et le manifeste de release.

**Acceptation** : une analyse sauvegardée peut être réouverte avec la même intention ; un calcul invalide ou une combinaison de granularités non prise en charge est refusé ; deux calculs de même nom mais de sens différent ne sont pas fusionnés ; les événements sont identifiables pour déduplication et reprise.

Une analyse partagée puis promue entre environnements conserve les mêmes règles d’agrégation contextuelle et de dénominateur, tout en recalculant sur les données autorisées du lecteur dans l’environnement cible.

### Lot 07 — Composition des dashboards

**Travaux** : sections et conteneurs, déplacement/redimensionnement, analyses référencées, blocs éditoriaux, filtres communs, thèmes, propriétés avancées, annuler/rétablir et aperçu responsive.

**Acceptation** : deux mises en page très différentes peuvent utiliser les mêmes analyses ; modifier le thème ne change pas les résultats ; la sauvegarde/relecture conserve la composition ; les cibles des filtres sont explicites ; le dashboard est utilisable au clavier et à différentes largeurs.

### Lot 08 — Consultation et partage

**Travaux** : droits de lecture/création, liens internes, ouverture d’une analyse depuis un visuel, sélection croisée, explorations personnelles et impacts des révisions.

**Acceptation** : un lien partagé ne contourne pas les droits ; les données sont évaluées pour le lecteur ; une exploration ne modifie pas le dashboard partagé ; la révocation d’un accès est effective. Tout export inclus respecte les mêmes restrictions et indique son contexte.

### Lot 09 — Pipeline de déploiement

**Travaux** : manifeste de release, fermeture des dépendances, diff, paramètres typés, précontrôles, droit de promotion, activation atomique, historique et retour arrière.

**Acceptation** : le même dashboard utilise les connexions DEV/TEST/PROD sans édition de son calcul ; une dépendance ou un paramètre manquant bloque l’activation ; une analyse modifiée en DEV n’affecte pas PROD ; un échec conserve la release active ; une concurrence est détectée ; aucun secret ou résultat n’est transféré.

### Lot 10 — Cycle de promotion métier

**Travaux** : transmission fiable des usages au système existant, affichage des statuts, retour de l’identité Atlas et migration des références.

**Acceptation** : une utilisation répétée est reconnue par le mécanisme externe ; les reprises ne doublent pas les événements ; une promotion conserve les consommateurs lorsque le sens est inchangé ; une définition modifiée exige une migration explicite. Aucun seuil de promotion concurrent n’est inventé dans Board.

Si le service externe manque, l’adaptateur et sa file d’événements peuvent être développés, mais ce lot et le parcours de promotion ne sont pas considérés comme livrés.

État au 31 octobre 2026 : le service externe manque. Le Plan 44 n’a aucun code, exclut toute API en v1 (D6 révisée) et ne prévoit pas de candidate d’origine externe (§4.4). Le lot 10 dépend de SK-10 (§13).

### Lot 11 — Pilote et exploitation

**Travaux** : parcours complet sur source réelle, tests multi-utilisateurs, charge représentative, observabilité, sauvegarde/restauration, documentation auteur/lecteur/administrateur et exploitation.

**Acceptation** : recette du parcours de référence, isolation démontrée, budgets de performance respectés, restauration des métadonnées et retour arrière vérifiés, erreurs diagnostiquables. La couverture réellement livrée du cycle de promotion est explicitement indiquée.

## 9. Jalons

| Jalon | Résultat observable |
|---|---|
| A — Fondations validées | Contrats et prototype graphique approuvés ; limites de l’écosystème identifiées. |
| B — Première analyse réelle | Un utilisateur authentifié explore une métrique Atlas via une connexion Board avec ses droits. |
| C — Création et partage | Analyses réutilisables, calculs adhoc et dashboard personnalisé consultable par plusieurs lecteurs. |
| D — Livraison contrôlée | Promotion DEV → TEST → PROD, paramètres, diff, historique et retour arrière. |
| E — Pilote complet | Usages reliés au cycle de promotion métier et recette d’exploitation terminée. |

Le chemin principal suit 00 → 02 → 03/04 → 05 → 06 → 07 → 08/09 → 11. Le prototype graphique peut avancer après le cadrage visuel ; le lot 10 dépend aussi de la disponibilité externe du système de promotion.

## 10. Arbitrages à fermer

| Question | Conséquence | Échéance |
|---|---|---|
| **Qui exécute et qui détient les connexions ?** (§3.3, options A, B, C ; proposition : B puis C) | Tout le reste : lots 03, 05, 06, 09, attendus externes, nature du backend Board. **Premier arbitrage, avant tout autre.** | Lot 00a, en premier |
| Adhoc limité aux modèles métier ou assemblage de tables accessibles ? | Périmètre du constructeur, jointures, granularités et sécurité. | Lot 00, avant 05/06 |
| Comment Atlas est-il accessible depuis le backend partagé ? Atlas est local-first (un clone Git et une base DuckDB par espace sur le poste), le mode hébergé est « à l’usage » (brief §12). | Lecture directe du dépôt Git de l’espace par Board (format pivot), service Atlas hébergé, ou bibliothèque `skifer_atlas` embarquée. | Lot 00b |
| Contenus Board : YAML sur git (invariant I5 de `main`, cohérent avec Atlas où une sauvegarde = une PR) ou PostgreSQL avec révisions et releases (§4.1, §7) ? | Modèle de gouvernance, diff, revue, outillage ; cohérence avec Atlas. Les deux ne sont pas exclusifs : la release du §5.2 peut être un manifeste YAML versionné même si l’index vit en base. | Lot 00a |
| Trois systèmes d’identité : Atlas = compte GitHub et `governance.yaml` ; skifer = identité OS ; Board = SSO à choisir. Comment un même lecteur est-il reconnu dans les trois ? | Propagation d’identité, RLS, décompte des validations, auditabilité. | Lots 00/02 |
| Environnements : skifer connaît `LOCAL / DEV / QA / PROD`, Board écrit `DEV / TEST / PROD`, Atlas n’en a pas (une déclinaison pointe vers sa source réelle). Qui fait foi pour la source d’un KPI dans un environnement donné ? | Nommage, paramètres de déploiement (§5.1), cohérence des releases avec les déclinaisons Atlas. | Lot 00a |
| Quel mécanisme d’identité et de RLS pour le premier connecteur ? | Exactitude et isolation des résultats. | Lots 00/03 |
| Quel est l’état réel du service de promotion des métriques ? | Contrats, dépendances et calendrier du lot 10. | Lot 00 |
| Quelles règles de validation des déploiements en PROD ? | Droit simple ou approbation distincte ; politique configurable à préciser. | Avant lot 09 |
| Version Atlas épinglée ou suivi contrôlé des évolutions ? | Stratégie de migration et reproductibilité. | Lots 00/04 |
| Quels volumes, nombre de tuiles et temps de réponse cibles ? | Dimensionnement et critères de performance. | Lot 00 |
| Quelle profondeur de personnalisation dès la V1 ? | Liste des contrôles graphiques et types de composants à figer après prototype. | Lot 01 |

### 10.1 Orientations du porteur, 31 octobre 2026

Réponses données à la revue des arbitrages. Une orientation n’est pas encore une décision : elle fixe la direction dans laquelle le lot 00a doit instruire.

| Arbitrage | Orientation | Conséquence immédiate |
|---|---|---|
| Qui exécute, qui détient les connexions (§3.3) | **Hésitation entre A et B, à discuter.** La variante A′ (skifer en bibliothèque, connecteurs Board) est à instruire comme forme concrète de A. | Le lot 00a présente A′ et B côte à côte sur les mêmes critères : où vit le RLS, où vivent les secrets, qui livre SK-01, combien de compilateurs à terme. |
| Stockage des contenus Board : git ou base | Aucun avis. | Proposition du plan : **git comme source de vérité des contenus** (analyses, dashboards, thèmes, manifestes de release en YAML), **base comme index et état d’exécution** (releases actives, journal, cache, événements). Cohérent avec Atlas et avec l’orientation 3. |
| Accès à Atlas | **Atlas est local-first, mais la vérité est le YAML sur git, donc exploitable.** | Board lit directement le dépôt git de l’espace Atlas (clone ou API de l’hébergeur). AT-01 devient une convention de lecture du dépôt, pas une API Atlas. Le lot 04 n’attend plus le plan 0005 d’Atlas pour démarrer. |
| Identité | Aucun avis. | Proposition du plan : un fournisseur OIDC d’entreprise pour Board ; le compte de l’hébergeur git (identité Atlas) est une **liaison** du profil Board, pas une identité concurrente ; skifer reçoit un `RequestContext` construit par Board depuis les claims. Le RLS se décide avec le point 1. |
| Périmètre de l’adhoc | **Pour le moment, les tables certifiées.** | L’adhoc porte sur les modèles sémantiques **et** sur les datasets certifiés par skifer (data products avec certification), jamais sur une table non certifiée. L’explorateur expose la certification comme filtre d’éligibilité. |
| Environnements | **Un environnement, c’est surtout des paramètres de connexion.** | Les contenus sont identiques entre environnements ; seule la liaison de connexion et ses paramètres changent. Le nommage est libre par espace. La release transporte des contenus, l’environnement fournit les liaisons. |
| Version Atlas | **La moindre modification d’un KPI Atlas doit être visible sur Board, et lever une erreur si besoin.** | **Suivi, pas épinglage.** Board suit la version courante d’Atlas, affiche chaque changement sur les analyses consommatrices, et passe le visuel en erreur (référence non résolue ou sens modifié) plutôt que de servir un résultat ambigu. La reproductibilité d’une release passe par le hash de la définition au moment de l’activation, pas par un épinglage éditorial. |
| Volumes et performance | **À étudier à l’usage ; on monitore d’abord.** | Pas d’objectifs chiffrés au lot 00. Le lot 02 livre la télémétrie (durée par exécution, lignes, taille, tuiles par dashboard) ; les seuils sont fixés après le pilote. |
| Stack | **Orientée données, optimisée pour le traitement de données.** | Résultats en colonnaire (Arrow) de bout en bout, moteur analytique embarqué côté backend (DuckDB ou Polars) pour les calculs contextuels et le cache, transport Arrow IPC vers le navigateur, tableaux et pivots haute performance côté client. Détail au §7, à confirmer. |

Décisions complémentaires du 31 octobre 2026, à l’issue du plan 01 :

- **Lecture d’Atlas par dépendance au paquet `skifer_atlas`**, épinglé par commit git. Board réutilise validation, résolution des variantes et empreinte `sha256:atlas1:` ; c’est l’empreinte qui permet de lever une erreur dès qu’un KPI change (orientation « suivi, pas épinglage »). Par transitivité, Board embarque `skifer` v4.0.0 sans extra Spark, ce qui rapproche de fait la variante A′ du §3.3 sans la trancher.
- **Frontend en Vite** (React, TypeScript). Le développement frontend attend les maquettes.

Deux arbitrages n’ont pas été discutés et restent ouverts : règles de validation en PROD (avant le lot 09) et profondeur de personnalisation V1 (lot 01).

### 10.2 Décisions du porteur, 2 novembre 2026

Prises sur la base des attendus relus dans le code ([skifer](attendus/skifer.md), [Atlas](attendus/atlas.md)). Elles remplacent les propositions correspondantes du §3.3 et du §10.1.

| # | Arbitrage | Décision | Conséquence |
|---|---|---|---|
| D-1 | Qui exécute (§3.3) | **A′ : skifer en bibliothèque dans Board, le résolveur de skifer produit le SQL dans le dialecte cible** (Databricks SQL, DuckDB). Board exécute ce SQL avec ses connecteurs et ne touche jamais à son texte : ni transpilation, ni ajout. | La proposition « B puis C » du §3.3 est abandonnée, et la décision D10 de `main` (aucun import `skifer`) tombe. La frontière unique est la bibliothèque skifer, isolée dans un seul module de Board, comme `skifer_atlas` (plan 04, C2). Côté skifer, SK-01 se réduit à un point d’extension public pour le backend, au dialecte cible du résolveur et à la règle de `sql_hash` ; SK-02 se réduit au refus d’accès structuré. SK-08 (RLS dans le planner) reste côté skifer. Les identifiants de connexion vivent dans un coffre côté serveur de Board. |
| D-2 | Identité | **OIDC générique**, émetteur configurable. Le vérificateur est strict : émetteur, audience, expiration sans tolérance, scopes, sur le modèle de `mcp/auth.py` de skifer. Le jeton de la personne est transmis à Databricks quand la fédération existe. | Lot 02. Le compte de l’hébergeur git reste une liaison du profil. Sans fédération, la RLS vient de skifer (SK-08) ; Board ne pose jamais lui-même une restriction. |
| D-3 | Stockage des contenus | **Git comme vérité des contenus** (analyses, dashboards, thèmes, manifestes de release en YAML), **base comme index et état** (releases actives, journal, cache, événements). | Lots 06 à 09. Board écrit dans le dépôt de contenus avec une identité de service. |
| D-4 | Bibliothèque graphique | **ECharts, rendu SVG par défaut** ; ADR 0001 acceptée. | Le canvas est réservé aux tuiles très denses, sans changer les constructeurs. |
| D-5 | Forme étroite des graphiques | **Acceptée** ; les seuils de 760 px (coque) et 480 px (graphiques) entrent dans les tokens du design system. | Un point de plan à venir : tokens, concordance et usages. |
| D-6 | Calcul du total de sélection | **Backend Board**, une seule implémentation des règles (plan 01). | Lot 05 ; la latence de l’aller-retour y est mesurée. |

Restent ouverts : le portage des attendus vers `../skifer` et `../skifer-atlas` (propriétaires, forme), les objectifs chiffrés de performance (ADR 0001, point 3), les règles de validation en PROD. La profondeur de personnalisation V1 est fermée le 6 novembre 2026 : personnalisation graphique sémantique resserrée ([plan 19](roadmap/19_composition_dashboards_plan.md), B9).

## 11. Hors périmètre initial

- Skifer-vault partagé entre produits.
- Place de marché publique de composants et scripts arbitraires d’auteurs.
- Déploiement automatique de pipelines ou de définitions Atlas depuis Board.
- Multiplication des moteurs graphiques et des connecteurs avant validation du premier parcours.
- Envois planifiés, abonnements et rafraîchissements sous comptes de service : à concevoir séparément avec leur contexte de droits.
- Assistant en langage naturel complet : extension du même modèle d’analyse après stabilisation du parcours visuel. Skifer fournit déjà `GenBIAgent`, `AgenticHub` et un serveur MCP read-only (§3.1) : l’extension les consomme, elle ne les redessine pas.
- Positionnement libre au pixel et collaboration simultanée de plusieurs éditeurs : évolutions possibles, non requises pour le pilote.
- Reporting (exports PDF, abonnements, alertes) et KPI packs déclaratifs, prévus par la roadmap de `main` : reportés, pas abandonnés. Les briques skifer existent (`HistoryExporter`, `AlertDispatcher`).

## 12. Règles de réalisation

Avant chaque lot, produire une spécification courte comprenant les contrats, les parcours, les erreurs, les migrations et les critères de recette. Consigner les arbitrages dans des décisions d’architecture. Développer des tranches utilisables de bout en bout et vérifier les intégrations réelles dès qu’elles sont disponibles.

Les tests doivent porter en priorité sur les frontières : isolation entre utilisateurs/espaces/environnements, exactitude analytique, conservation des versions, intégrité des promotions et absence de fuite par le cache ou les exports.

Un lot terminé possède un livrable démontrable, ses contrôles pertinents, une documentation d’usage et des limites explicites. Ce plan ne vaut pas validation des arbitrages ouverts ni preuve que les fonctions des autres dépôts sont déjà disponibles.

## 13. Attendus externes

Mise à jour du 2 novembre 2026 (lot 00b) : chaque attendu est détaillé, avec l’état relu dans le code et ce qui change sous A′ et sous B, dans [attendus skifer](attendus/skifer.md) et [attendus Atlas](attendus/atlas.md). Ces documents ajoutent AT-05 à AT-07 et signalent cinq défauts de skifer qui touchent le fail-closed. Le tableau ci-dessous reste le résumé ; l’état « rien n’existe » ne vaut plus pour AT-01, couvert en bibliothèque.

Rien de ce qui suit n’existe au 31 octobre 2026. Chaque ligne doit devenir un plan dans le dépôt cible, avec un propriétaire, avant que le lot Board qui en dépend soit déclaré livré. Les SK-01 à SK-09 reprennent `docs/roadmap/00_attendus_skifer.md` de `main` (commit `63697c9`), qui en détaille la surface ; SK-10, SK-11 et les attendus Atlas sont ajoutés par cette révision. Ne rien démarrer dans `../skifer` ni `../skifer-atlas` sans accord explicite : les deux dépôts ont un chantier en cours.

### Côté skifer

| Réf. | Attendu | Lots Board dépendants |
|---|---|---|
| SK-01 | Backend d’exécution de la couche sémantique sans Spark : Databricks SQL (Statement Execution API) en production, DuckDB en local. Transpilation du Spark SQL de `QueryResolver` (sqlglot). | 03, 05 |
| SK-02 | API REST distante sur `AgentReadyDataService` : bind non-loopback derrière un bearer vérifié par un vérificateur injecté (comme `mcp/auth.py`), `POST /query` renvoyant `{columns, rows, evidence, truncated}`, erreurs typées (`SemanticAccessDenied` avec `decision` et `reasons`, jamais de lignes), pagination, suite de contrat partagée (SK-02.7). | 03, 05 |
| SK-03 | Tri et top-N dans `SemanticQuery`. | 05 |
| SK-04 | Événements d’usage émis par Board : soit une route d’ingestion de `SemanticUsageEvent` avec scope dédié, soit (préféré dans `main`) un en-tête `surface` transmis par Board et enregistré par skifer à chaque `query()`. | 06, 10 |
| SK-05 | Endpoint agent utilisable à distance (`GenBIAgent` derrière SK-02 ou MCP HTTP). | hors V1 |
| SK-06 | Réutilisation des briques de reporting. | hors V1 |
| SK-07 | Modèles sémantiques template pour les KPI packs. | hors V1 |
| SK-08 | Identité : vérificateur OIDC produisant un `RequestContext` depuis les claims ; identités de service par `consumer_class` ; **RLS** déclaré dans le modèle sémantique, injecté par le planner avant compilation, visible dans `normalized_filters` avec une origine `policy`. | 02, 03, 08 |
| SK-09 | Lecture des hashs de définition (modèle, sources) sans exécution, `ETag` souhaité. | 05 (cache) |
| SK-10 | Candidate de métrique d’origine externe : accepter une définition structurée (pas une question), un mécanisme d’ingestion compatible avec D6 révisée du Plan 44, un retour d’état lisible par Board, continuité d’identité à la promotion. | 10 |
| SK-11 | Contrat de réagrégation : métriques ratio ou dérivées avec numérateur et dénominateur, exposition des composantes (`avg` = somme et effectif), grain du résultat, dimensions et opérations compatibles, complétude au-delà de `truncated`. | 05, 06 |

### Côté Atlas

| Réf. | Attendu | Lots Board dépendants |
|---|---|---|
| AT-01 | Accès à un espace Atlas depuis un backend partagé (plan 0005 : clone Git, catalogue indexé), sous une forme hébergeable ou lisible directement depuis le dépôt Git de l’espace. | 04 |
| AT-02 | Mapping d’un KPI Atlas (document, `version`, déclinaison) vers un modèle sémantique skifer et ses métriques, dans le format pivot, avec empreinte vérifiable des deux côtés. | 04, 05 |
| AT-03 | État de disponibilité d’une version de KPI (publiée, proposition en cours, retirée) exposé au catalogue. | 04, 09 |
| AT-04 | Si l’option C du §3.3 est retenue : compilateur du plan 0007 remonté dans le moteur (ADR 0003) comme backend Spark-free, à la place ou en complément de SK-01. | 03 |

## 14. Références

- [Skifer](https://github.com/morzu117/skifer) et [API](https://github.com/morzu117/skifer/tree/main/src/skifer/api/routes).
- [Skifer Atlas](https://github.com/morzu117/skifer-atlas), [documentation du cœur](https://github.com/morzu117/skifer-atlas/blob/main/core/README.md) et [plans](https://github.com/morzu117/skifer-atlas/blob/main/docs/plans/README.md) (0001 à 0004 fusionnés au 30 octobre 2026).
- Atlas, décisions : [0002 graphe dans le YAML Skifer](https://github.com/morzu117/skifer-atlas/blob/main/docs/decisions/0002-graphe-dans-le-yaml-skifer.md), [0003 modèle développé dans Atlas puis remonté](https://github.com/morzu117/skifer-atlas/blob/main/docs/decisions/0003-modele-developpe-dans-atlas-puis-remonte.md), [0004 compilation et exécution](https://github.com/morzu117/skifer-atlas/blob/main/docs/decisions/0004-compilation-sqlglot-execution-par-atlas.md), [0005 stockage local et gouvernance](https://github.com/morzu117/skifer-atlas/blob/main/docs/decisions/0005-stockage-local-et-gouvernance-versionnee.md).
- [Skifer — Plan 44](https://github.com/morzu117/skifer/blob/main/docs/roadmap/44_metric_candidates_plan.md) et ses [11 specs](https://github.com/morzu117/skifer/tree/main/docs/roadmap/44_metric_candidates) : « rien n’est implémenté » au 31 octobre 2026, D6 révisée (ni API ni application en v1).
- Board, branche `main` au commit `63697c9` : `docs/roadmap/00_roadmap.md`, `docs/roadmap/00_attendus_skifer.md`, `docs/roadmap/01_skifer_board_foundation_plan.md` (décisions D1 à D21), `docs/dashboard_yaml_spec.md`.
- [Apache ECharts](https://github.com/apache/echarts), [styles](https://echarts.apache.org/handbook/en/concepts/style/) et [séries personnalisées](https://echarts.apache.org/handbook/en/how-to/custom-series/).
- [Vega](https://github.com/vega/vega), [Vega-Lite](https://github.com/vega/vega-lite) et [visx](https://github.com/airbnb/visx).
