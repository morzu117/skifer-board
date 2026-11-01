# Plan 05 — Catalogue Atlas, versions et écarts (04b)

Date : 1er novembre 2026 · Statut : **planifié**. Suite du plan 04 sans arbitrage nouveau, en attendant ceux qui bloquent les lots 02, 03 et 05 (§3.3 du plan de développement, fournisseur d'identité, stockage des contenus). Claude développe, les tests sont écrits par un autre que l'auteur du code (plan 03, T1).

Plan parent : [plan de développement](../plan-de-developpement.md), lot 04 (« versions, variantes ») et orientation du 31 octobre (« la moindre modification d'un KPI Atlas doit être visible sur Board »). Écran : [écrans et fonctionnalités](../ecrans-et-fonctionnalites.md), §2.2 « Versions : historique, écart avec la dernière ». Prédécesseur : [plan 04](04_catalogue_atlas_plan.md).

## 1. Ce qu'Atlas fournit, vérifié au commit `fe334267`

| Capacité | Où | Comportement constaté sur un dépôt de test |
|---|---|---|
| Versions d'un document | `skifer_atlas.repo.versions.versions(repo, id)` | Liste des tags `doc/<id>/v<n>`, de la plus ancienne à la plus récente : version, commit, date du commit avec fuseau, nom de l'auteur (jamais son adresse), message. Liste vide pour un document sans tag ou inconnu. Lecture seule : `for-each-ref`, `rev-list`, `log`. |
| Écart entre deux versions | `skifer_atlas.sheet.version_diff(repo, id, base, other)` | Rapport de diff du plan 0003 d'Atlas, relation `version` : `identical`, empreintes des deux versions, écarts nœud par nœud avec type, champs modifiés (avant, après), classification, sévérité et message rédigé par Atlas, résumé par sévérité. Version non taguée ou document inconnu : `RepoError("not_found")`. Concept : `RepoError("invalid_document")`, un concept n'a pas de graphe. Deux fois la même version : `identical`. |

Une version courante peut ne pas être taguée : Atlas pose le tag à la fusion d'une proposition, et `sync` rattrape les fusions faites directement sur l'hébergeur. Board ne pose aucun tag (C1 du plan 04).

## 2. Décisions

| # | Décision | Écartée |
|---|---|---|
| V1 | **Historique lu à chaque demande dans le clone**, par Atlas, après remise à jour de l'index (plan 04, C3). La réponse porte la provenance de l'index : commit et date de lecture. Le document doit exister dans l'index, sinon 404. | Copier l'historique dans la base de Board : seconde source, à invalider. |
| V2 | **Pas d'historique ancien.** Si le clone ne peut pas être lu, l'historique est indisponible avec sa raison ; la fiche reste servie depuis le dernier index. Aucune liste de versions n'est servie sans relecture du clone. | Servir un historique mémorisé : un tag ajouté depuis serait absent sans que rien ne le dise. |
| V3 | **Version courante dite telle quelle.** La fiche compare la version de l'index à la liste des tags. Si elle n'y figure pas, l'écran dit « version courante non taguée » et ne propose aucun écart avec elle. | Comparer au contenu courant hors tag : Atlas ne l'expose pas, et ce serait réécrire son diff. |
| V4 | **Écart avec la dernière version taguée**, pour un KPI, à la demande de la personne, version par version. Le rapport d'Atlas est relayé sans réinterprétation : messages, classifications et sévérités sont ceux d'Atlas, en valeurs fermées ; une valeur inconnue est une erreur de contrat, jamais une sévérité devinée. Les alignements de nœuds (`pairs`) ne sont pas relayés : ils ne s'affichent pas. | Recalculer un écart dans Board : seconde implémentation du diff. |
| V5 | **Les expressions sont du texte d'Atlas.** Un écart peut citer une expression de calcul (`montant_ttc - montant_taxes`). Board l'affiche comme une valeur de la définition ; il ne l'interprète, ne l'exécute et ne la stocke jamais (invariant §2). | Masquer les expressions : l'écart deviendrait illisible. |
| V6 | **Deux routes en lecture.** `GET /api/catalog/{id}/versions` et `GET /api/catalog/{id}/diff?base=<n>&other=<n>`. Codes fermés : `document_not_found` (404), `version_not_found` (404), `diff_not_supported` (400, un concept), `invalid_parameter` (400), `history_unavailable` (503, avec `problem` et `detail`), `diff_unavailable` (422, une version taguée dont le graphe ne se résout pas, avec le message d'Atlas). | Une route par version : rien à afficher qui ne soit déjà dans la liste. |
| V7 | **Exemples versionnés** dans `contracts/catalogue/`, produits une fois par le serveur réel sur l'espace de test, comme au plan 04 (C10). | — |

## 3. Sous-tâches

Chaque point est un commit `feat(plan05-x.y)` avec son entrée de changelog. Claude relit les tests, lance le gate complet et commite.

### 5.1 — Lecture des versions et des écarts

Modifiés : `apps/api/src/skifer_board/catalog/{model,atlas,service,__init__}.py`.

- `CatalogService.versions(id)` : `VersionsPage` (provenance, identifiant, version courante, versions) ou `HistoryUnavailable` (raison, détail) ou `None`.
- `CatalogService.diff(id, base, other)` : `DiffPage` (provenance, rapport) ou une raison fermée de refus.
- Seul `catalog/atlas.py` importe `skifer_atlas` ; le contrôle d'architecture du plan 04 reste vrai.

Tests : dépôts construits en test avec des tags `doc/<id>/v<n>` ; versions dans l'ordre ; version courante non taguée ; document sans tag ; écart cosmétique et écart à vérifier ; versions identiques ; version inconnue ; concept ; clone supprimé ; aucun fichier ni tag écrit dans le clone.

### 5.2 — Routes HTTP

Modifiés : `apps/api/src/skifer_board/server.py`. Créés : exemples `contracts/catalogue/versions*.json`, `ecart*.json`.

Tests : chaque code fermé, structure identique aux exemples versionnés.

### 5.3 — Versions dans la fiche

Modifiés : `apps/web/src/catalogue/*`.

- Section « Versions » de la fiche : de la plus récente à la plus ancienne, numéro, date, auteur, message ; la version courante est signalée, ou dite non taguée.
- Pour un KPI, chaque version antérieure propose « Écart avec la v<n> » : résumé par sévérité, puis chaque écart avec sa sévérité en texte et pas seulement en couleur, son message et ses champs avant et après. « Aucun écart » pour deux versions identiques.
- États : chargement, historique indisponible avec sa raison, écart indisponible avec le message d'Atlas, erreur.

Tests : décodeur, composants et accessibilité axe, parcours Playwright sur les exemples versionnés, captures de référence.

## 4. Rayon d'impact

Paquet `skifer_board.catalog`, module `server`, dossier web `catalogue`, `CHANGELOG.md`. Aucune dépendance nouvelle. L'index structurel n'existe pas pour ce dépôt ; aucun rayon d'impact outillé ne peut être établi.

## 5. Risques

| Risque | Parade |
|---|---|
| `version_diff` relit tout l'espace (`analyze`) à chaque appel. | Appel à la demande seulement, jamais au chargement de la fiche ; mesuré au besoin. |
| Le rapport de diff d'Atlas évolue (`DIFF_SCHEMA_VERSION`). | Valeurs fermées côté Board, une valeur inconnue est une erreur visible ; montée de commit annoncée au changelog. |
| Le nom d'auteur d'un commit est une donnée personnelle. | Atlas n'expose que le nom, jamais l'adresse ; Board ne le stocke pas. |

## 6. Vérification

`pnpm run check` complet. Par sous-tâche, un test volontairement cassé, puis rétabli, confirme que le filet attrape la régression.
