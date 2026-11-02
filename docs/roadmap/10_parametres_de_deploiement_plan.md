# Plan 10 — Paramètres de déploiement (lot 02, cinquième tranche)

Date : 2 novembre 2026 · Statut : **à réaliser**. Cinquième tranche du lot 02 (« socle partagé »), après les environnements et le droit de déployer (plan 09). Choix du porteur du 2 novembre, qui suit les recommandations : **déclarations et valeurs en base pour l'instant**, **cinq types fermés sans secret ni connexion**, **une valeur se modifie avec le rôle administrateur et le droit de déployer dans l'environnement**, **une configuration incomplète se montre, une valeur n'est jamais invalidée en silence**. Claude développe ; les tests sont écrits par un agent Claude distinct (plan 03, T1).

Plan parent : [plan de développement](../plan-de-developpement.md), §4.1 (objet Environnement), §5.1 (paramètres), §5.2 (contenu d'une release), §8 lot 02 (« les environnements d'un même espace possèdent des configurations distinctes »), §10.1 (« un environnement, c'est surtout des paramètres de connexion »), §10.2 D-3 (contenus dans git). Écrans : [écrans et fonctionnalités](../ecrans-et-fonctionnalites.md), §9 (« Paramètres de déploiement déclarés »), §5 (un filtre ne cible jamais un paramètre). Design : `docs/design/RULES.md`, `DESIGN-SYSTEM.md`.

## 1. Point de départ

- Un espace a trois environnements fixes, `DEV`, `TEST`, `PROD`, et des droits de déployer par environnement (plan 09). L'écran « Environnements » les montre en pipeline.
- Rien ne distingue encore la configuration d'un environnement de celle d'un autre : c'est le dernier critère d'acceptation du lot 02.
- Les connexions logiques, leurs liaisons par environnement et les références de secret appartiennent au lot 03 (D-1 : Board détient les connexions, dans un coffre côté serveur). Les releases et leur activation appartiennent au lot 09.

## 2. Décisions

| # | Décision | Écartée |
|---|---|---|
| P1 | **Déclarations et valeurs en base**, comme configuration de l'espace, au même titre que les droits de déployer. La release du lot 09 en figera une copie : déclarations et valeurs résolues (§5.2). Si le dépôt de contenus des lots 06 à 09 reprend les déclarations, une migration les y portera. | Écrire dès maintenant les déclarations dans git (D-3) : le dépôt de contenus et l'identité de service qui y écrit n'existent pas encore. |
| P2 | **Cinq types fermés.** `text` (longueur maximale, de 1 à 1024), `integer` (minimum et maximum facultatifs, dans ±(2⁵³ − 1) pour être exacts dans le navigateur), `boolean`, `choice` (de 1 à 50 valeurs distinctes, chacune de 1 à 128 caractères), `identifier` (format fixe `[A-Za-z_][A-Za-z0-9_]{0,127}`, pour un catalogue ou un schéma). Aucune expression régulière libre. Une valeur est une donnée typée, jamais un fragment de requête : Board ne la substitue dans aucun texte (§5.1). | Références de secret et connexions logiques : lot 03, avec le coffre et les connecteurs. Expression régulière libre : coût de validation non borné, et contrainte illisible pour l'administrateur. |
| P3 | **Déclaration.** Un nom unique dans l'espace (`[a-z][a-z0-9_]{0,62}`, immuable : renommer, c'est déclarer un autre paramètre), un type et ses contraintes, obligatoire ou facultatif, une valeur par défaut facultative qui respecte les contraintes, une description facultative (jusqu'à 200 caractères). Au plus 100 paramètres par espace. | Nom modifiable : les références des analyses (lot 06) suivraient un nom mouvant. |
| P4 | **Résolution par environnement.** La valeur d'un environnement est sa valeur propre, sinon la valeur par défaut. Un paramètre obligatoire sans l'une ni l'autre est **manquant** et rend l'environnement **incomplet** ; un paramètre facultatif sans l'une ni l'autre est **absent**, ce qui est permis. L'état de chaque paramètre est rendu par le serveur (`value`, `default`, `missing`, `absent`) ; le navigateur ne le recalcule pas. | — |
| P5 | **Rien n'est invalidé en silence.** Changer une déclaration (type, contraintes, défaut) d'une façon qui rendrait invalide une valeur existante est refusé (`409 values_incompatible`), avec les environnements en cause ; on vide d'abord ces valeurs. Rendre un paramètre obligatoire est permis : les environnements sans valeur deviennent incomplets, et l'écran le dit. Retirer une déclaration retire ses valeurs, dans la même transaction, avec le journal. | Invalider les valeurs et les signaler : une configuration fausse resterait en base, à corriger plus tard. |
| P6 | **Droits.** Lire déclarations et valeurs : administrateurs de l'espace et de la plateforme, comme les accords. Déclarer, modifier ou retirer une déclaration : les mêmes. **Poser ou vider une valeur dans un environnement : rôle administrateur dans l'espace et droit d'y déployer** (plan 09, V3) : changer un paramètre de PROD, c'est modifier la production, et « qui peut toucher la PROD » se lit sur une seule liste. L'administration de la plateforme sans rôle lit les valeurs, ne les modifie pas. Le serveur rend, pour chaque environnement, si la session peut y modifier les valeurs. | Tout administrateur modifie toutes les valeurs : contournerait le droit de déployer. |
| P7 | **Journal.** `parameter_declared`, `parameter_changed` (avant et après), `parameter_removed`, `value_set` (environnement, avant, après), `value_cleared`, dans le journal de l'espace (plan 08, E10). Une écriture sans changement n'est pas journalisée (plan 08, E12). | — |
| P8 | **Refus à codes fermés.** `parameter_not_found` (404), `parameter_exists` (409), `values_incompatible` (409, avec `environments`), `parameter_limit` (409), `invalid_request` avec le champ en cause (valeur hors contraintes comprise), `forbidden` (403, `required: "admin"` ou `required: "deploy"` avec l'environnement), `local_mode` (409), `space_not_found` (404). | — |
| P9 | **Mode local.** Sans base, les paramètres ne se gèrent pas (`409 local_mode`, plan 08, E11) ; l'écran le dit. | Paramètres en mémoire en mode local : perdus à chaque redémarrage, ils feraient croire à une configuration. |
| P10 | **Hors de cette tranche** : références de secret et connexions (lot 03) ; usage des paramètres par les analyses et interdiction de les cibler par un filtre (lots 05 et 06) ; blocage de l'activation d'une release sur un environnement incomplet (lot 09) ; télémétrie du lot 02 (plan 11). | — |

## 3. Sous-tâches

Chaque point est un commit `feat(plan10-x.y)` avec son entrée de changelog. Claude relit les tests, lance le gate complet et commite.

### 10.1 — Modèle, migration et magasin

Créés : révision `0005`, `apps/api/src/skifer_board/spaces/parameters.py` (modèle et validation). Modifiés : `spaces/store.py`, `spaces/access.py`, `state/schema.py`.

- Modèle pur : types et contraintes (P2), validation d'une déclaration et d'une valeur, résolution par environnement et complétude (P4), compatibilité d'une déclaration avec des valeurs existantes (P5).
- Tables `deploy_parameters` (espace, nom, type, contraintes, obligatoire, défaut, description, auteurs et dates) et `parameter_values` (paramètre, environnement, valeur, auteur, date ; une valeur par paramètre et environnement, clé étrangère vers `space_environments`). Valeurs et contraintes en JSON typé, jamais en texte libre interprété.
- Magasin : lire les déclarations et valeurs d'un espace ; déclarer, modifier, retirer ; poser et vider une valeur. Chaque écriture en une transaction qui verrouille l'espace, avec le journal (P7) ; écriture sans changement non journalisée.

Tests : validation de chaque type à ses bornes ; résolution sur toutes les combinaisons (valeur, défaut, obligatoire, facultatif) ; compatibilité ; limite de 100 ; isolation de deux espaces ; journal ; concurrence de deux écritures ; migration d'une base vierge et d'une base en `0004` peuplée.

Écarts de réalisation :
- Une valeur est rangée par espace, nom et environnement, sans identifiant technique : le nom est immuable (P3). Clés étrangères vers la déclaration et vers `space_environments`, sans suppression en cascade : le retrait efface les valeurs lui-même, dans sa transaction.
- Un texte, un choix et une description refusent les caractères de contrôle et les demi-paires de substitution, que la base refuserait ; un texte a au moins un caractère (vider une valeur est un acte distinct). Les caractères de format (bidirectionnels, largeur nulle) restent admis. `max_length` compte les caractères Unicode, pas les unités UTF-16 du navigateur : l'écran de 10.3 devra compter de la même façon.
- Vider une valeur absente n'a aucun effet et n'est pas journalisé, comme une écriture sans changement (E12).
- Le retrait d'un paramètre journalise sa déclaration et les valeurs retirées.
- `configuration` lit déclarations et valeurs sous un verrou partagé sur l'espace : une lecture attend l'écriture en cours et ne voit jamais un état intermédiaire. Les déclarations sont triées par Python, pas par la collation de la base.
- Une déclaration relue de la base est validée de nouveau ; une ligne invalide n'est pas montrée.
- Le magasin valide lui-même le nom d'un paramètre déclaré (`InvalidParameter`, champ `name`), en plus de la route à venir.
- Le droit de poser une valeur est `Access.sets_values` : rôle administrateur et droit de déployer. En mode local il vaut les trois environnements, comme `deploy`, mais toute opération sur les paramètres y est refusée (`local_mode`, P9).
- Tests écrits par un agent Claude indépendant (449 tests, dont un ajouté par Claude pour la validation du nom dans le magasin) ; douze régressions volontaires attrapées, aucun défaut trouvé.

### 10.2 — Routes

Modifiés : `spaces/web.py`. Exemples versionnés dans `contracts/espaces/`.

- `GET /api/spaces/{espace}/parameters` : déclarations, et pour chaque environnement les valeurs, leur état résolu (P4), sa complétude et si la session peut y modifier les valeurs (P6).
- `POST /api/spaces/{espace}/parameters`, `PUT` et `DELETE /api/spaces/{espace}/parameters/{nom}` : déclarations.
- `PUT` et `DELETE /api/spaces/{espace}/parameters/{nom}/values/{environnement}` : valeurs.
- Le journal raconte déclarations et valeurs.

Tests : chaque route avec chaque rôle, avec et sans droit de déployer, non-membre et administration de la plateforme seule ; chaque refus de P8 ; mode local ; exemples produits par le serveur réel.

### 10.3 — Écran « Paramètres »

Créés : `apps/web/src/spaces/` (écran d'administration). Modifiés : onglets, route, coque.

- Écran « Paramètres » (`#/espaces/<id>/parametres`), troisième onglet de l'administration de l'espace.
- Grille : une ligne par paramètre (nom, type et contraintes, obligatoire, défaut), une colonne par environnement dans l'ordre `DEV | TEST | PROD` avec la valeur et son état (« valeur propre », « par défaut », « manquant », « absent ») ; au-dessus de chaque colonne, la complétude de l'environnement.
- Déclarer, modifier, retirer un paramètre (retrait confirmé, il retire les valeurs) ; poser ou vider une valeur là où le serveur l'autorise, avec un contrôle adapté au type ; un refus est rendu avec sa raison, `values_incompatible` avec les environnements en cause.
- Rappel : un paramètre n'est jamais un secret, et changer une valeur demande le droit de déployer dans l'environnement.

Tests : composants, axe, parcours Playwright, captures.

### 10.4 — Complétude dans le pipeline et journal

Modifiés : écran « Environnements », journal partagé.

- Chaque carte du pipeline dit si l'environnement est complet, sinon combien de paramètres y manquent, avec un lien vers « Paramètres ».
- Le journal de l'espace raconte déclarations et valeurs, sur les trois écrans.

Tests : composants, axe, parcours Playwright, captures.

## 4. Rayon d'impact

Paquet `skifer_board.spaces`, révision `0005`, `contracts/espaces/`, écrans d'administration d'un espace et leurs onglets, journal partagé. Aucune réponse existante ne change de forme.

## 5. Hors de cette tranche

- **Références de secret, connexions logiques et liaisons** par environnement : lot 03.
- **Usage des paramètres** par les analyses, et refus d'un filtre qui en cible un : lots 05 et 06.
- **Blocage de l'activation** d'une release sur un environnement incomplet, paramètres résolus dans le manifeste : lot 09.
- **Déclarations dans le dépôt de contenus** : à reprendre si les lots 06 à 09 y placent les contenus.
- **Télémétrie** du lot 02 : plan 11.

## 6. Risques

| Risque | Parade |
|---|---|
| Une valeur de paramètre sert à glisser du texte dans une requête. | Types fermés, `identifier` à format fixe ; Board ne substitue aucune valeur dans un texte (P2), et l'usage arrive avec le lot 06 sous la même règle. |
| Un administrateur range un secret dans un paramètre `text`. | Rappel permanent sur l'écran ; les secrets arrivent avec le coffre du lot 03. Board ne peut pas le détecter de façon fiable et ne prétend pas le faire. |
| Une modification de déclaration rend fausse une configuration de PROD. | Refusée tant qu'une valeur deviendrait invalide (P5), testée. |
| Un administrateur sans droit de déployer modifie la PROD par un défaut. | Changer un défaut change la résolution de tous les environnements qui n'ont pas de valeur propre : c'est un acte de déclaration, réservé aux administrateurs, journalisé avec l'avant et l'après. Le risque est accepté pour cette tranche ; le lot 09 figera les valeurs résolues dans chaque release, et une release active ne changera pas sous un nouveau défaut. |
| Une base migrée perd la cohérence entre valeurs et environnements. | Clé étrangère vers `space_environments`, migration testée sur une base en `0004` peuplée. |

## 7. Vérification

`pnpm run check` complet. Pour chaque sous-tâche, une régression volontaire, puis rétablie, confirme que le filet l'attrape.
