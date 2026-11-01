# Plan 04 — Catalogue Atlas, première tranche (04a)

Date : 1er novembre 2026 · Statut : **planifié**. Suite du lot 01 sur accord du porteur (« si c’est ok on continue et on applique toujours cette philosophie ») : Claude développe, Codex écrit les tests (plan 03, T1).

Plan parent : [plan de développement](../plan-de-developpement.md), lot 04, §10.1 (« Accès à Atlas », « Version Atlas ») et attendus AT-01 à AT-03. Écran : [écrans et fonctionnalités](../ecrans-et-fonctionnalites.md), §2.

## 1. État d’Atlas, vérifié le 1er novembre 2026

Le §3.2 du plan de développement décrit Atlas au 30 octobre : catalogue « planifié (0005) ». Ce n’est plus vrai. `origin/main` de `skifer-atlas`, commit `fe334267`, contient le plan 0005 et la suite. Ce que ce plan utilise, lu dans le code :

| Capacité | Où | Ce que Board en tire |
|---|---|---|
| Index d’un espace | `skifer_atlas.index.build` : `ensure_index(repo, db)` reconstruit l’index DuckDB quand le commit du clone ou la version de schéma change ; `build_index` est transactionnel. | L’index se construit depuis un clone, dans une base que Board choisit. |
| Lecture du catalogue | `skifer_atlas.index.search` : `catalog(q, domain, owner, status, kind)`, `facets`, `document`, `dependencies`. | Recherche par libellé, identifiant, synonyme et description, sans accents ; facettes ; fiche avec diagnostics et déclinaisons ; références et impact. |
| Statut d’un document | `validated`, `draft`, `needs_curation`, `invalid`. Un document invalide est indexé avec ses diagnostics, jamais ignoré. | Le statut Atlas et ses diagnostics s’affichent tels quels. |
| Empreinte | `sha256:atlas1:…` par document. | Provenance d’une définition. |
| Versions | Tags git `doc/<id>/v<n>`. | Historique, hors de cette tranche. |
| Correspondance KPI → modèle sémantique skifer (AT-02) | **Absente** des deux dépôts. | Aucun KPI ne peut être déclaré exécutable. |
| Disponibilité d’une version (AT-03) | Partielle : le statut existe ; « proposition en cours » et « retirée » ne sont pas exposés. | Seul le statut Atlas est montré. |

Défaut constaté, non corrigé ici : avec DuckDB 2.0, une base nommée `index.duckdb` prend le nom de catalogue `index`, qui entre en collision avec le schéma `"index"` d’Atlas ; la construction échoue (« Ambiguous reference to catalog or schema "index" »). Board nomme sa base autrement et le signale au porteur pour Atlas.

## 2. Décisions

| # | Décision | Écartée |
|---|---|---|
| C1 | **Lecture d’un clone local d’un espace Atlas, en lecture seule** (orientation §10.1 : « Board lit directement le dépôt git de l’espace »). Le chemin du clone est configuré. Board ne fait ni `fetch`, ni `pull`, ni écriture dans le clone : la synchronisation du clone est une opération d’exploitation, hors de cette tranche. | API d’Atlas : sidecar de bureau sur `127.0.0.1`, jeton de session Tauri, non hébergeable. Clone géré par Board : ajoute identifiants et réseau avant que l’identité soit tranchée. |
| C2 | **Atlas en bibliothèque, épinglé par commit.** `skifer-atlas` en source git au commit `fe334267`, sous-dossier `core`. uv n’applique pas les sources d’une dépendance : Board déclare aussi `skifer` en source git `v4.0.0`, comme Atlas. Un seul module, `skifer_board.catalog.atlas`, importe `skifer_atlas`. Aucun module de Board n’importe `skifer` : l’arbitrage A′ reste ouvert (plan 01, P4). Un test le vérifie. | Relire les YAML avec un parseur Board : seconde validation, qui divergera de celle d’Atlas. |
| C3 | **Index dans une base DuckDB propre à Board**, `catalogue.duckdb` dans un répertoire d’état configuré, hors du clone. Le SQL est celui d’Atlas, dans le code d’Atlas ; Board n’en écrit aucun (invariant §2). L’index n’est jamais une source de vérité : il se reconstruit depuis le clone. | Base dans le clone : écrirait dans l’espace. |
| C4 | **Disponibilité fermée, par KPI.** `executable` si une correspondance AT-02 existe ; `unresolved` sinon, avec la raison `mapping_absent` (AT-02 n’existe pas) ou `not_validated` (statut Atlas autre que `validated`). Dans cette tranche, aucun KPI n’est `executable` : l’écran le dit, sans simuler de correspondance. Un concept n’a pas de disponibilité : ce n’est pas une métrique. | Afficher « exécutable » pour un KPI validé : approximation silencieuse. |
| C5 | **Atlas indisponible est un état du catalogue, pas d’une ligne.** Clone absent, dépôt illisible ou échec de git : le catalogue est servi depuis le dernier index connu, avec son commit, sa date de construction et la raison. Sans index antérieur, le catalogue est indisponible, jamais vide. La disponibilité de chaque ligne reste celle de l’index. | Remplacer la disponibilité de chaque ligne par « Atlas indisponible » : perd l’état réel de la ligne. |
| C6 | **Provenance.** Chaque réponse porte le commit indexé, la date de la dernière lecture réussie du clone, la fraîcheur (`fresh`, `stale`) et, en `stale`, la raison. Chaque document porte son empreinte. | — |
| C7 | **Pas de convergence.** `catalog` d’Atlas calcule une convergence depuis les comparaisons chiffrées stockées dans la base locale de l’utilisateur Atlas. La base de Board n’en contient aucune : la valeur serait fausse. Board ne la lit pas. | La relayer : dirait « jamais comparé » à tort. |
| C8 | **Suivi, pas épinglage** (§10.1). Le catalogue montre la version courante. La détection d’un changement de version pour les analyses consommatrices attend qu’il existe des analyses (lots 05 et 09). | Épinglage par défaut (écrans §2.2) : remplacé par l’orientation du 31 octobre. |
| C9 | **API HTTP.** FastAPI, deux routes en lecture : `GET /api/catalog` (paramètres `q`, `domain`, `owner`, `status`, `kind`) et `GET /api/catalog/{id}`. Écoute sur `127.0.0.1` par défaut. Pas d’identité avant le lot 02 : le catalogue est en lecture pour tous les rôles (écrans §13), et la pastille le dit déjà. Une erreur est une réponse JSON à code fermé, jamais une trace. | Pas de serveur avant le lot 02 : l’écran ne pourrait lire que des données figées. |
| C10 | **Contrat partagé.** Un exemple de réponse versionné, lu par un test Python, qui compare sa structure à la sérialisation réelle, et par un test web, qui le décode. Le décodeur web refuse une réponse malformée et affiche une erreur, jamais une donnée partielle. | Générer les types : outillage disproportionné pour deux routes. |
| C11 | **Écran sans maquette.** Composition des composants existants selon `RULES.md` §5.7, comme `02-analyses.html` : carte de filtres, tableau, tiroir de fiche. Navigation par ancre (`#/catalogue`), la page prototype reste à `#/`. | Routeur externe : inutile pour deux pages. |

## 3. Sous-tâches

Chaque point est un commit `feat(plan04-x.y)` avec son entrée de changelog. Claude développe et installe l’outillage ; Codex écrit les tests sans modifier le code de production ; Claude relit, lance le gate complet et commite (plan 03, T1).

### 4.1 — Lecture du catalogue

Fichiers créés : `apps/api/src/skifer_board/catalog/{__init__,model,atlas,service}.py`. Modifiés : `apps/api/pyproject.toml` (dépendances `skifer-atlas`, sources git), `uv.lock`, `pyproject.toml` (mypy : `skifer_atlas` sans annotations).

- Configuration : chemin du clone et répertoire d’état.
- `CatalogService.list(...)` et `.get(id)` rendent des objets typés : entrée, fiche, déclinaisons, références, provenance, disponibilité.
- États : `fresh` ; `stale` avec raison (`repository_missing`, `repository_unreadable`) ; `unavailable` sans index.

Écart de réalisation : Atlas n'expose aucune fonction qui lise la date de construction de l'index, et la lire dans `index_meta` serait écrire du SQL. Board enregistre donc lui-même, dans `catalogue-lecture.json` du répertoire d'état, le commit et la date de la dernière lecture réussie du clone, par remplacement atomique. Si ce fichier manque ou ne porte pas sur le commit de l'index, le dernier index n'est pas servi : son âge serait inconnu.

Tests (Codex) : dépôts d’espace créés par `git init` dans `tmp_path`, sans réseau. Recherche et facettes ; KPI valide, brouillon, invalide avec diagnostics ; déclinaisons ; références et impact ; reconstruction après un nouveau commit ; clone supprimé après un premier index (servi `stale`) ; clone absent sans index (`unavailable`) ; aucun fichier écrit dans le clone ; aucun import `skifer` hors `skifer_atlas`.

### 4.2 — API HTTP

Fichiers créés : `apps/api/src/skifer_board/server.py`, `contracts/catalogue.example.json`. Modifiés : dépendances `fastapi`, `uvicorn` ; `httpx` en développement.

Tests (Codex) : routes, filtres, document inconnu en 404 à code fermé, catalogue indisponible en 503 à code fermé, réponse `stale` en 200 avec sa provenance, structure identique à l’exemple versionné.

### 4.3 — Écran Catalogue

Fichiers créés : `apps/web/src/catalogue/*`. Modifiés : `App.tsx` (navigation par ancre, section Catalogue livrée), proxy `/api` de Vite en développement.

- Recherche, filtres domaine, propriétaire, statut Atlas et type ; tableau libellé, type, domaine, version, déclinaisons, disponibilité, statut ; tiroir de fiche : description, synonymes, propriétaire, empreinte, diagnostics, déclinaisons, références et impact.
- États : chargement, vide, erreur, Atlas indisponible (bandeau avec âge de l’index), catalogue indisponible.
- Aucune action d’écriture : « Proposer une modification » relève d’Atlas et n’est pas affiché tant que l’adresse de l’espace n’est pas configurée.

Tests (Codex) : décodeur, composants et accessibilité axe sous les deux thèmes, parcours Playwright avec l’API simulée par `page.route` depuis l’exemple versionné, captures de référence. Claude exécute les parcours (plan 03, écart 3.3).

## 4. Rayon d’impact

Nouveau paquet `skifer_board.catalog`, nouveau module `server`, nouveau dossier web `catalogue`. Fichiers partagés modifiés : `apps/api/pyproject.toml`, `pyproject.toml`, `uv.lock`, `apps/web/src/App.tsx`, `apps/web/vite.config.ts`, `CHANGELOG.md`. L’index structurel n’existe pas pour ce dépôt ; aucun rayon d’impact outillé ne peut être établi.

## 5. Risques

| Risque | Parade |
|---|---|
| Atlas change son schéma d’index ou ses fonctions. | Épinglage par commit, adaptateur unique, tests sur dépôts réels construits en test. Une montée de commit est un commit annoncé au changelog. |
| Dépendances lourdes amenées par Atlas (`snowflake-connector-python`, `keyring`, `sqlglot`). | Acceptées pour cette tranche et listées ici. Le jour où Atlas publie un paquet de lecture plus étroit, Board en change. |
| `ensure_index` lance git en sous-processus sur chaque lecture. | Mesuré au besoin ; un délai de fraîcheur pourra être ajouté, annoncé comme tel, jamais silencieux. |
| Accès concurrent à la base DuckDB. | Verrou par base, tenu par Atlas dans le processus ; un seul processus serveur dans cette tranche. |
| La raison `mapping_absent` sur tous les KPI fait croire à un défaut de Board. | Libellé explicite : « correspondance avec un modèle sémantique non définie (Atlas, AT-02) ». |

## 6. Vérification

`pnpm run check` complet. Par sous-tâche, un test volontairement cassé, puis rétabli, confirme que le filet attrape la régression.
