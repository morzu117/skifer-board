# Plan 01 — Socle du dépôt et calculs contextuels

Date : 31 octobre 2026 · Statut : **1.1 à 1.3 implémentées**, gate vert. Lancé sur accord du porteur (« tu peux commencer le développement, on verra à ce moment-là les choix à prendre »).

Plan parent : [plan de développement](../plan-de-developpement.md), §4.6 et §7. Écrans concernés : [écrans et fonctionnalités](../ecrans-et-fonctionnalites.md), §3.2.

## 1. Intention

Démarrer par ce qui ne dépend d’aucun arbitrage ouvert, en particulier pas de l’arbitrage A′ ou B du §3.3 :

1. un dépôt outillé avec un gate unique ;
2. la **couche de calcul contextuel** du §4.6 : à partir d’un résultat déjà autorisé, en colonnaire, et des règles des métriques telles que skifer les déclare, calculer total de sélection, sous-totaux et parts du total, ou dire pourquoi c’est impossible et quelle requête le moteur devrait recevoir.

C’est la capacité distinctive du Board et elle est indépendante de qui exécute : qu’il s’agisse d’une API skifer ou d’un connecteur Board, le résultat arrive sous la même forme.

## 2. Décisions de ce plan

| # | Décision | Écartée |
|---|---|---|
| P1 | **uv workspace** à la racine, membre `apps/api`, paquet `skifer_board`, Python 3.12. Gate par scripts `package.json` racine (`pnpm run check`), comme sur `main` (D1 : `make` absent du poste Windows). | `Makefile`. |
| P2 | **Arrow (`pyarrow`) comme format pivot des résultats** (orientation « stack orientée données », §10.1). Le calcul contextuel opère sur `pyarrow.Table` avec `pyarrow.compute`, sans conversion en lignes Python. | Pandas : copie et perte des types décimaux ; DuckDB dès maintenant : inutile pour des agrégations de résultat, il arrivera avec le cache. |
| P3 | **Aucune chaîne SQL dans Board, y compris pour le calcul local.** Les agrégations locales passent par l’API de calcul d’Arrow, pas par du SQL sur DuckDB. L’invariant « Board n’émet jamais de SQL » reste vérifiable par simple lecture. | SQL DuckDB local : défendable techniquement, mais brouille l’invariant. |
| P4 | **Les règles des métriques sont lues dans la forme du modèle sémantique skifer** (`name`, `type`, `additivity`, `non_additive_dimensions`), par un parseur de dictionnaire. Aucun import `skifer`. | Importer `skifer` : c’est précisément l’arbitrage A′, pas encore rendu. |
| P5 | **Le type d’agrégation prime sur l’additivité déclarée.** Un `count_distinct` n’est jamais sommé, même déclaré `additive`. Un `avg` n’est réagrégé que si ses composantes (somme, effectif) sont fournies, ce que skifer ne fait pas encore (SK-11). `min` et `max` se réagrègent par `min` et `max`. | Faire confiance à `additivity` seule : skifer la met à `additive` par défaut. |
| P6 | **Une agrégation qui ne regroupe rien est toujours permise.** Si chaque groupe de sortie ne contient qu’une ligne, aucune réagrégation n’a lieu et toute métrique passe. Une dimension non additive n’interdit que les groupes où elle prend plusieurs valeurs. | Refuser par principe dès qu’une dimension non additive est retirée : refuserait « total des trois régions sélectionnées sur un seul mois ». |
| P7 | **Une impossibilité est un résultat, pas une exception.** Les opérations rendent soit un résultat dérivé (valeurs, périmètre, règle, `evidence_id` source, caractère partiel), soit une indisponibilité (raison fermée, explication, requête à demander au moteur). Les exceptions sont réservées aux erreurs de programmation et aux contrats invalides. | Lever une exception : l’écran doit afficher « demander au moteur », c’est un état normal. |
| P8 | **Le résultat doit être à grain unique.** Deux lignes de même clé de dimensions sont refusées à la construction (ligne de sous-total ou doublon), c’est la garde « sans double comptage ». | Dédoublonner silencieusement. |
| P9 | **Précision** (fixée à la 1.3) : sommes, minimums et maximums gardent le type Arrow de la colonne, décimaux exacts compris (une somme décimale s’élargit à `decimal128(38, s)`) ; moyennes pondérées et parts sont rendues en `float64`. Nuls : sémantique SQL, une somme sur aucune valeur non nulle est nulle. Dénominateur nul ou nul au sens SQL : part nulle et note `zero_or_null_denominator`, jamais l’infini. | Moyenne décimale à l’échelle Spark (`scale + 4`) : à reprendre si un écart avec le moteur est mesuré au lot 05. |

## 3. Sous-tâches

### 1.1 — Squelette du dépôt et gate

Fichiers créés : `pyproject.toml` (workspace, ruff, mypy strict, pytest, couverture), `apps/api/pyproject.toml`, `apps/api/src/skifer_board/__init__.py`, `apps/api/src/skifer_board/py.typed`, `apps/api/tests/test_smoke.py`, `package.json`, `.python-version`, `.gitignore`, `.gitattributes`, `.editorconfig`, `CHANGELOG.md`, `CLAUDE.md` (invariants et conventions, minimal), `uv.lock`.

Acceptation : `pnpm run check` vert sur un dépôt fraîchement cloné après `uv sync --locked`.

### 1.2 — Contrat de résultat et règles des métriques

Fichiers créés : `apps/api/src/skifer_board/contextual/{__init__,rules,contract}.py`, tests associés.

- `MetricRule` et sa lecture depuis une métrique de modèle skifer ; erreurs de contrat explicites (type inconnu, additivité invalide, `semi_additive` sans dimension, `non_additive_dimensions` sur une métrique `additive`).
- `ResultContract` : dimensions du grain, règles par métrique, complétude (`complete`, `truncated`, `top_n`), `evidence_id`.
- `ContextualResult` : table Arrow et contrat ; vérifie colonnes présentes, métriques numériques, grain unique.

### 1.3 — Opérations contextuelles

Fichiers créés : `apps/api/src/skifer_board/contextual/operations.py`, tests associés.

- `aggregate(result, metric, group_by=(), selection=None, scope=...)` : total de sélection (`group_by` vide et sélection), sous-total (`group_by` partiel), total du résultat chargé.
- `share_of_total(...)` : part de chaque groupe dans le total de la sélection ou du résultat chargé ; dénominateur nul rendu nul et signalé.
- Périmètre `filtered_perimeter` : servi localement seulement si le résultat est complet ; sinon indisponibilité avec la requête à poser au moteur.
- Cas de recette repris du lot 05 : somme d’une sélection compatible ; moyenne pondérée avec composantes ; refus de sommer des comptes distincts ; refus de sommer un stock dans le temps, accepté sur un seul mois ; total d’un résultat tronqué étiqueté partiel ; retour au moteur pour le total complet ; valeurs nulles ; décimaux exacts.

Couverture : 100 % des branches de `skifer_board.contextual`, comme le seuil appliqué au client de `main` (D19).

## 4. Rayon d’impact

Dépôt vide de code : aucun appelant existant. L’index structurel (`codegraph`) n’existe pas encore pour ce dépôt ; aucun rayon d’impact ne peut être établi par l’outil, et aucun n’est nécessaire pour une création.

## 5. Risques

| Risque | Parade |
|---|---|
| `pyarrow` sans annotations de types bloque `mypy --strict`. | Stubs `pyarrow-stubs` en dépendance de dev ; à défaut, surcharge `ignore_missing_imports` limitée à `pyarrow`, signalée. |
| Somme décimale mal gérée par Arrow selon la version. | Test dédié sur `decimal128` ; version minimale épinglée. |
| Les règles skifer évoluent (SK-11). | Le parseur ignore les clés inconnues et ne déduit rien d’absent ; les composantes d’`avg` sont une option, pas une hypothèse. |

## 6. Choix qui restent ouverts et que ce plan ne prend pas

- Accès aux documents Atlas : dépendre du paquet `skifer_atlas` (épinglé par commit git, comme Atlas épingle `skifer`) pour réutiliser validation et empreinte `sha256:atlas1:`, ou lire le YAML sans lui. Prochain plan.
- Frontend : Vite ou Next.js. Prochain plan, avec le prototype graphique du lot 01.
- Forme d’entrée des résultats : réponse HTTP skifer (option B) ou table Arrow d’un connecteur (option A′). La couche contextuelle prend une table Arrow et un contrat, les deux options s’y raccordent.

## 7. Vérification

`pnpm run check` : ruff (lint et format), mypy strict, pytest avec seuil de couverture, puis contrôle YAML et présence de `## [Unreleased]` dans le changelog.
