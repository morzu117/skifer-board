# Attendus de Board envers Atlas

Date : 2 novembre 2026 · Lot 00b du [plan de développement](../plan-de-developpement.md) (§13, côté Atlas) · Propriétaire côté Atlas : **à désigner**.

Ce document dit ce que Board attend de `skifer-atlas`, ce qui existe déjà et ce que Board fait en attendant. Il est écrit dans ce dépôt seulement : rien n'est demandé ni ouvert dans `../skifer-atlas` sans accord explicite. Chaque attendu accepté devient un plan dans le dépôt d'Atlas, avec un propriétaire, avant que le lot Board qui en dépend soit déclaré livré.

## 1. Base vérifiée

- Board épingle `skifer-atlas` au commit `fe334267` (sous-dossier `core`), lu en bibliothèque par le seul module `skifer_board.catalog.atlas` ([plan 04](../roadmap/04_catalogue_atlas_plan.md), C2).
- État relu le 2 novembre 2026 sur `origin/main` au commit `c49b66a`, qui ajoute le plan 0028 d'Atlas (base partagée entre processus, ADR 0032). Les plans 0001 à 0028 d'Atlas sont listés dans `docs/plans/README.md`.
- Les constats ci-dessous citent le code d'Atlas à ce commit. Aucun n'a été vérifié contre un dépôt GitHub réel ni contre une plateforme de données.

L'arbitrage du §3.3 est tranché le 2 novembre 2026 : **A′**, skifer en bibliothèque dans Board (plan de développement, §10.2, D-1). Les mentions « sous B » sont conservées pour l'historique.

## 2. Synthèse

| Réf. | Attendu | État au `c49b66a` | Dépend du §3.3 | Lots Board |
|---|---|---|---|---|
| AT-01 | Lire un espace depuis un backend partagé | **Couvert** en bibliothèque sur un clone | non | 04 |
| AT-02 | Correspondance KPI Atlas → modèle sémantique skifer | **Absent** | oui, pour la vérification de l'empreinte | 04, 05 |
| AT-03 | Disponibilité d'une version : publiée, proposition en cours, retirée | **Partiel** : statut de document, propositions lisibles seulement par l'hébergeur | non | 04, 09 |
| AT-04 | Compilateur du plan 0007 remonté dans le moteur | Compilateur **présent dans Atlas**, non remonté | seulement si l'option C est retenue | 03 |
| AT-05 | Une base nommée `index.duckdb` reste utilisable | **Défaut présent** | non | 04 |
| AT-06 | Date de construction de l'index lisible par une fonction | **Absent** : la colonne existe, aucune fonction ne la lit | non | 04 |
| AT-07 | Paquet de lecture sans connecteurs ni serveur | **Absent** : un seul paquet | oui, pour le poids de `skifer` | 04 |

## 3. Détail

### AT-01 — Lire un espace depuis un backend partagé

**Attendu.** Board, application web partagée, lit le catalogue d'un espace sans application de bureau ni poste personnel.

**Constat.** Couvert pour la lecture. Board lit un clone local de l'espace, dont le chemin est configuré, et appelle Atlas en bibliothèque. L'index est construit dans le répertoire d'état de Board :

- `skifer_atlas.index.build.ensure_index(repo, db)` reconstruit l'index quand le commit du clone ou la version de schéma change ;
- `skifer_atlas.index.search` sert la recherche, les facettes, la fiche et les dépendances ;
- `skifer_atlas.repo.versions.versions` et `skifer_atlas.sheet.version_diff` servent l'historique et les écarts ([plan 05](../roadmap/05_versions_atlas_plan.md)).

Les fonctions de propositions (`skifer_atlas.proposals`) ne sont pas utilisables ainsi : `open_context(workspace_id)` exige un espace enregistré par Atlas, un jeton de l'hébergeur et un compte courant.

**Board en attendant.** Rien : le lot 04 est livré sur cette base. La synchronisation du clone est une opération d'exploitation, hors du lot 04 (C1) ; elle n'attend rien d'Atlas.

**Montée de commit de Board (plan 13).** Depuis `c49b66a`, l'ouverture d'une base attend jusqu'à 10 secondes puis lève `RepoError("index_busy")`. Board épingle `db9e9df6`, qui complète la reconnaissance du verrou, et relaie ce code comme une indisponibilité distincte d'un clone illisible. Une base occupée n'est pas rouverte pour chercher l'ancien index.

### AT-02 — Correspondance KPI Atlas → modèle sémantique skifer

**Attendu.** Pour un KPI Atlas (document, `version`, déclinaison), savoir quel modèle sémantique skifer et quelles métriques le calculent, dans le format pivot. Une empreinte vérifiable des deux côtés doit prouver que la correspondance vise toujours la même définition.

**Constat.** Absent des deux dépôts.

- Atlas ne contient aucune référence à un modèle sémantique : `model/` importe seulement le catalogue d'opérations de skifer (`skifer.core.op_catalog`).
- L'ADR 0002 d'Atlas l'explique : le modèle sémantique ne décrit que des métriques sur une table, alors que le graphe d'Atlas a une topologie libre.

**Board en attendant.** Aucun KPI n'est exécutable ; le catalogue le dit (`availability`, plan 04). Board ne pose aucune correspondance lui-même : ce serait une seconde source de vérité.

**Sous A′.** Board lit le modèle sémantique avec la bibliothèque skifer et recalcule l'empreinte côté skifer lui-même.

**Sous B.** L'empreinte côté skifer doit être lisible sans exécution (SK-09, [attendus skifer](skifer.md)).

**Dans les deux cas,** la correspondance et l'empreinte côté Atlas viennent d'Atlas.

**Questions ouvertes pour Atlas.**

- Où vit la correspondance : dans le document KPI, dans un document dédié, ou dans le dépôt du modèle sémantique ?
- Qui la valide : par une proposition, comme toute modification ?
- Que devient-elle quand la version du KPI change ?

### AT-03 — Disponibilité d'une version de KPI

**Attendu.** Le catalogue distingue une version publiée, une version en cours de proposition et une version retirée. Board s'en sert pour le catalogue (lot 04) et pour la promotion des contenus (lot 09).

**Constat.** Partiel.

- **Statut de document.** L'index porte `validated`, `draft`, `needs_curation` et `invalid`. Le modèle de document (`model/document.py`) ne déclare que `draft` et `needs_curation`. Board les relaie (`AtlasStatus`).
- **Publication.** Une version publiée est une version taguée `doc/<id>/v<n>` (plan 05 de Board, V3).
- **Retrait.** Aucun statut ni tag de retrait n'existe.
- **Proposition en cours.** Elle n'existe que comme pull request chez l'hébergeur. `proposals.status.list_proposals` interroge l'hébergeur avec le jeton de l'espace. La branche `prop/<stem>-<n>` est visible dans un clone après fetch, mais son état (ouverte, approuvée, refusée) ne l'est pas.

**Board en attendant.** Le catalogue affiche le statut de l'index et la version courante, taguée ou non. Il n'affiche ni « proposition en cours » ni « retirée ».

**Attendu précis.**

- Un statut de retrait porté par le dépôt : champ du document ou tag.
- Une lecture de l'état des propositions qui n'exige pas le jeton d'un utilisateur. Ce peut être un état écrit dans le dépôt, ou une fonction qui accepte un jeton de service fourni par l'appelant.

### AT-04 — Compilateur remonté dans le moteur (option C seulement)

**Attendu.** Seulement si l'option C du §3.3 est retenue : le compilateur d'Atlas devient un backend sans Spark de skifer (ADR 0003 d'Atlas), à la place ou en complément de SK-01.

**Constat.** Le compilateur existe dans Atlas.

- `skifer_atlas.compile` expose `compile_document` et `DIALECTS = ("databricks", "snowflake", "duckdb")`.
- `skifer_atlas.run` exécute sur DuckDB local.

Il n'est pas remonté dans skifer. Il compile un graphe Atlas, pas une `SemanticQuery`.

**Board en attendant.** Rien. Board n'appelle pas ce compilateur : ce serait une seconde frontière vers les données, contraire à l'invariant d'une frontière unique.

### AT-05 — Une base nommée `index.duckdb` reste utilisable

**Constat.** Le schéma de l'index s'appelle `"index"` (`index/schema.py`). Sous DuckDB 2.0, une base ouverte depuis `index.duckdb` prend le nom de catalogue `index`. La construction échoue alors avec « Ambiguous reference to catalog or schema "index" » (constaté au plan 04 de Board).

Atlas nomme ses propres bases `atlas.duckdb` (`workspaces.py`) et n'est pas touché. Tout appelant qui choisit ce nom l'est. Le défaut est toujours présent à `c49b66a`.

**Board en attendant.** Sa base s'appelle `catalogue.duckdb` (`catalog/service.py`, `INDEX_FILE`).

**Attendu.** Au choix :

- qualifier les tables par le catalogue courant ;
- renommer le schéma ;
- refuser explicitement ce nom de fichier.

### AT-06 — Date de construction de l'index

**Constat.**

- La table `"index".index_meta` porte `built_at` (UTC).
- `index.schema.index_state` ne renvoie que le commit et la version de schéma, et aucune autre fonction ne lit `built_at`.
- Board n'écrit pas de SQL (invariant §2). Il note donc lui-même la date de sa dernière lecture réussie dans un fichier à côté de la base, pour la provenance d'un index servi en `stale`.

**Attendu.** Une fonction qui renvoie `(commit, built_at, schema_version)`. Board pourra alors dire l'âge réel de l'index, et non la date à laquelle il l'a lu.

### AT-07 — Paquet de lecture sans connecteurs ni serveur

**Constat.** `core/pyproject.toml` déclare un seul paquet. Ses dépendances obligatoires sont :

- `fastapi`, `uvicorn` ;
- `keyring`, `snowflake-connector-python` ;
- `platformdirs` ;
- `skifer`, épinglé par Board en `v4.0.0`.

Board, qui ne fait que lire un clone, les installe toutes.

**Effets.**

- Le connecteur Snowflake et le trousseau n'ont pas leur place sur un serveur qui ne s'y connecte pas.
- `skifer` est installé dans Board par Atlas, quel que soit l'arbitrage du §3.3. Un contrôle d'architecture vérifie qu'aucun module de Board ne l'importe, mais il est présent.

**Sous A′.** Board importera skifer de toute façon ; seul compte alors l'alignement des deux versions de skifer, celle d'Atlas et celle de Board.

**Sous B.** Board ne devrait pas embarquer skifer du tout.

**Attendu.** Des extras (`[server]`, `[connectors]`) ou un paquet de lecture séparé : modèle, index, versions et diff.

## 4. Ce que Board ne demande pas

- Écrire dans un espace : Board ne pose ni tag ni branche (plan 04, C1).
- Un service Atlas hébergé : la lecture d'un clone suffit pour le catalogue.
- La comparaison chiffrée d'Atlas (plan 0009) : Board ne la relaie pas, faute de comparaisons dans sa base (plan 04).
