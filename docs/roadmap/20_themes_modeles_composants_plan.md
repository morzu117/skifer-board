# Plan 20 — Thèmes, modèles de page et composants approuvés (lot 07b)

Date : 13 novembre 2026 · Statut : **20.1 à 20.5b réalisées**, 20.5c à réaliser. Second plan du lot 07, ouvert sur la composition des dashboards du [plan 19](19_composition_dashboards_plan.md). Il clôt le lot 07.

Le porteur a fait ses choix le 13 novembre, en suivant les recommandations :
- **tout le lot 07b dans ce plan** ;
- **thèmes en palette fermée de tokens** ;
- **approbation pour l'usage partagé** ;
- **modèle de page = squelette, composant approuvé = référence versionnée**.

Le développement de chaque tranche est confié à Codex (gpt-6.1-terra), puis relu par Claude Sonnet 5.5 avant commit. C'est la demande du porteur depuis le 11 novembre. L'orchestrateur rédige les consignes, vérifie les gates, relit les captures, commite, ouvre la demande de fusion et la fusionne.

Sources :
- [plan de développement](../plan-de-developpement.md) : §4.1 (Thème), §6.2 (trois niveaux de personnalisation), §8 lot 07 et §10.2 (D-3, D-4, D-5) ;
- [écrans](../ecrans-et-fonctionnalites.md) : §0.2–0.5, §5.3 (Nouveau dashboard), §7 (Thèmes, modèles de page et composants) et la matrice des rôles ;
- [design system](../design/DESIGN-SYSTEM.md), [règles](../design/RULES.md) et `docs/design/tokens.json` ;
- [décision 0001](../decisions/0001_bibliotheque_graphique.md) ;
- plans [02](02_socle_web_et_prototype_graphique_plan.md), [18](18_analyses_versionnees_plan.md) et [19](19_composition_dashboards_plan.md).

## 1. Point de départ

- **Dépôt de contenus.** Il connaît deux genres fermés, `analysis` et `dashboard` (B1 du plan 19). Il garantit :
  - des révisions immuables ;
  - la révision attendue à chaque écriture ;
  - un verrou entre processus ;
  - l'historique et le diff structurel.

  L'index vit en base, et la dernière migration est la 0016.
- **Format des dashboards.** `board.dashboard/v1` ne porte ni thème ni couleur. Ses composants sont fermés : `analysis`, `kpi`, `text` et `separator`. L'héritage de présentation va du thème à l'analyse, puis au dashboard et au composant (B9, `resolveVisual` et `resolveKpi`). Le niveau « thème » est aujourd'hui l'un des deux thèmes graphiques codés en dur, Skifer clair ou Skifer ardoise (`charts/theme.ts`), choisi par l'écran.
- **Thèmes graphiques.** Ce sont des rôles visuels résolus depuis les tokens (`docs/design/tokens.json`, plan 02 W8), avec des contrastes vérifiés : 3:1 pour les marques et 4,5:1 pour le texte (`MARK_ROLES`, `TEXT_ROLES`, `contrastRatio`). Aucune couleur n'est écrite dans `apps/web`.
- **Ce qui manque.** Il n'existe aucun écran Thèmes, aucun modèle de page ni aucun composant approuvé. Le dialogue « Nouveau dashboard » ne propose ni modèle ni thème. L'entrée de navigation « Thèmes » du §1 des écrans n'existe pas.
- **Rôles.** Les rôles d'espace sont `reader`, `creator` et `admin`. Les releases (lot 09) n'existent pas encore.

## 2. Décisions

| # | Décision | Conséquence vérifiable |
|---|---|---|
| C1 | **Trois genres de plus.** Le dépôt de contenus ajoute les genres fermés `theme`, `page_template` et `component`, chacun avec son répertoire (`themes/`, `templates/`, `components/`), son schéma, ses messages de commit, son historique et son diff structurel. Les garanties du plan 19 sont inchangées, et aucun chemin n'est construit depuis une valeur non validée. | Les suites des plans 18 et 19 passent sans changement de leurs attentes. Des tests croisés vérifient qu'une écriture d'un genre ne touche aucun autre genre. |
| C2 | **Format `board.theme/v1`, en palette fermée.** Un thème déclare :<br>• une **base** (`skifer-clair` ou `skifer-ardoise`), qui fixe la surface ;<br>• les **rôles des marques** : série, secondaire, sélection, seuil, positif, négatif, total ;<br>• une **palette catégorielle** de 2 à 8 couleurs distinctes ;<br>• une **palette séquentielle** de 3 à 7 paliers de luminance monotone ;<br>• une **palette divergente** au nombre impair de paliers, de 3 à 7, avec un centre neutre ;<br>• une **typographie** : familles des tokens et échelle `compacte`, `normale` ou `grande` ;<br>• une **densité d'espacement** : `compacte`, `normale` ou `aérée` ;<br>• les **formats de nombres et de dates**, en listes fermées ;<br>• des **valeurs par défaut par type de graphique** (légende, format des nombres, infobulle).<br>Chaque couleur est un **nom de token**, jamais une valeur. Le catalogue des tokens admissibles par base et par rôle, avec leurs contrastes sur la surface de la base (3:1 pour les marques, 4,5:1 pour le texte), est calculé depuis `docs/design/tokens.json`. Le serveur et le web lisent ce même catalogue. | Le schéma refuse toute valeur hexadécimale. Un token sous le seuil de contraste est refusé par le serveur et absent des choix du web. La même table de contrastes est vérifiée des deux côtés. Les bornes des palettes sont testées. |
| C3 | **Le dashboard choisit son thème.** `board.dashboard/v1` gagne deux champs facultatifs :<br>• `theme`, sous la forme `{theme_id, revision}` ;<br>• `template`, sous la forme `{template_id, revision}`, une provenance seulement informative.<br>Il gagne aussi le composant `component` (C6). Un dashboard sans `theme` est rendu avec Skifer clair, comme aujourd'hui. Le format reste en v1 : aucune release ne l'a encore figé, et toutes les révisions déjà écrites restent valides.<br>Le thème remplace le niveau « thème » de l'héritage B9. Ses défauts par type de graphique entrent dans `resolveVisual` et `resolveKpi`. Dans l'éditeur et les aperçus, les tuiles sont rendues avec le thème du dashboard. Les autres écrans gardent le choix d'affichage clair ou ardoise. | Les fixtures v1 du plan 19 restent valides. Un changement de thème laisse la requête soumise identique, octet pour octet, ainsi que les valeurs de données des options. L'origine « Thème » est affichée avec le nom du thème. |
| C4 | **Approbation pour l'usage partagé.** Thèmes, modèles et composants suivent un même cycle.<br>• **Création.** Un créateur ou un administrateur crée une révision, à l'état **brouillon**. Les brouillons ne sont visibles que de leur auteur et des administrateurs.<br>• **Approbation.** Un administrateur approuve une révision précise, avec la révision attendue. L'approbation est un contenu git : un fichier d'approbations par objet, qui garde l'approbateur, l'instant et la révision. Elle est indexée en base et réindexable.<br>• **Nouvelle révision.** Elle redevient un brouillon, et la révision approuvée précédente reste utilisable.<br>• **Usage.** Un dashboard **partagé** ne référence que des révisions approuvées. Sinon, le serveur refuse avec `unapproved_reference` et la liste des composants en cause. Un dashboard **personnel** peut aussi référencer les brouillons de son propriétaire.<br>• **Suppression.** Elle est refusée tant qu'un dashboard en consomme la révision courante (`content_in_use`) : les consommateurs visibles sont listés, les autres sont seulement comptés, comme pour `analysis_in_use`. | Une matrice croise rôle, état (brouillon ou approuvé), visibilité du dashboard et action. Un test de fuite vérifie qu'un brouillon n'est visible de personne d'autre que son auteur et des administrateurs. La réindexation depuis le dépôt vierge retrouve les approbations. |
| C5 | **Modèle de page = squelette.** `board.page_template/v1` reprend la mise en page d'un dashboard : sections, rangées, colonnes et largeurs, conteneurs, textes, séparateurs. Il reprend aussi les filtres communs, avec dimension, opérateur et valeurs, mais **sans cibles**.<br>Les visuels et KPI y deviennent des **emplacements** (`slot`, avec le genre attendu, visuel ou KPI, et un libellé), sans analyse ni présentation propre. Un modèle se crée depuis un dashboard existant ; l'extraction est une fonction pure, testée.<br>« Nouveau dashboard » propose un modèle approuvé, ou un brouillon de l'auteur pour un dashboard personnel, ainsi qu'un thème. Le modèle est **copié** dans le nouveau dashboard, qui garde la provenance `template`. Un emplacement non rempli est un problème bloquant à la sauvegarde. | Extraction d'un modèle : aucun identifiant d'analyse ni aucune cible ne subsiste. Un dashboard créé depuis un modèle a la même structure. Un emplacement vide bloque l'enregistrement. |
| C6 | **Composant approuvé = référence versionnée.** `board.component/v1` est un visuel ou un KPI nommé : une analyse **partagée** épinglée `{analysis_id, revision}` et sa présentation sémantique (B9).<br>• **Insertion.** Un dashboard l'insère par le composant `component`, sous la forme `{component_id, revision}`. Le composant n'a pas de surcharge locale. « Détacher » le recopie en visuel ordinaire, ce qui s'annule en une étape.<br>• **Nouvelle révision.** Une nouvelle révision du composant ne modifie aucun dashboard. L'éditeur signale l'écart et propose de comparer, d'adopter ou de garder la révision, comme pour une analyse (B5).<br>• **Exécution.** La tuile s'exécute avec l'analyse du composant, aux mêmes conditions que B8 : la borne de 40 composants exécutables, les refus rendus tels quels, une référence non résolue jamais exécutée. | Un composant référençant une analyse personnelle est refusé. Un composant inséré soumet la même requête que le visuel équivalent. Détacher s'annule en une étape. L'adoption d'une révision est testée. |
| C7 | **Droits.** Créer et réviser exige les rôles `creator` ou `admin`, et seul `admin` approuve. Une révision approuvée est lisible par tout membre qui a un rôle de création. Le même filtre s'applique à chaque route, et le mode local comme un non-membre sont refusés. Un thème ou un composant ne donne aucun droit sur les données : chaque tuile reste exécutée avec l'identité de la personne qui ouvre le dashboard. | Matrice rôle × état × action par route. Tests de fuite sur le modèle des plans 18 et 19. |
| C8 | **Fermeture des dépendances.** Une fonction pure du serveur calcule les dépendances d'un dashboard : ses analyses, son thème, ses composants et, à travers eux, leurs analyses, chacun avec sa révision. Elle sert déjà aux consommateurs, et le lot 09 l'utilisera pour l'inclusion dans les releases. La colonne « par environnement » de la liste des thèmes vient aussi au lot 09, ce que l'écran dit. | Tests de fermeture sur des graphes de dépendances, cycles impossibles par construction. |
| C9 | **Écrans.**<br>• **Navigation.** L'entrée **Thèmes** regroupe Thèmes, Modèles de page et Composants.<br>• **Liste des thèmes.** Elle montre le nom, la révision, l'état et le nombre de dashboards qui l'utilisent.<br>• **Éditeur de thème.** Il propose base, rôles, palettes, typographie, densité, formats et défauts par type de graphique, chaque choix pris dans le catalogue admissible. Son **aperçu** porte sur un dashboard de référence aux **données d'exemple embarquées**, sans aucune exécution, et un bandeau le dit.<br>• **Approbation.** Un administrateur voit le diff structurel avec la révision approuvée précédente.<br>• **Modèles et composants.** Ils ont leurs listes et leur historique. Depuis l'éditeur de dashboard, on peut « Enregistrer comme modèle » et « Enregistrer comme composant ».<br>• **Nouveau dashboard.** Le dialogue gagne le modèle et le thème.<br>• **Éditeur de dashboard.** Le thème se choisit dans les propriétés du dashboard. La palette insère un composant approuvé. Les propriétés d'un composant offrent Détacher, et son écart de révision est rendu.<br>Tous les états du §0.2 sont couverts. | Tests de composants à 100 %, Axe sous les deux bases, parcours Playwright et captures ordinateur et téléphone. |

## 3. Tranches et commits

Chaque tranche a ses tests, une entrée dans `CHANGELOG.md` sous `Unreleased` et un commit `feat(plan20-20.x)`. Les tests sont hors réseau, sans clé ni cluster, sur des dépôts git et des bases jetables. À la demande du porteur du 9 novembre, chaque tranche web apporte, dans son propre commit, ses tests unitaires, ses tests de non-régression et ses parcours Playwright. La suite e2e complète passe, lancée seule, avant la relecture.

### 20.1 — Genres, formats et catalogue des tokens

- Les trois genres sont ajoutés au dépôt (C1).
- Les formats `board.theme/v1`, `board.page_template/v1` et `board.component/v1` ont leur JSON Schema, leurs fixtures valides et invalides, et leur sérialisation canonique.
- Le catalogue des tokens admissibles est calculé depuis `docs/design/tokens.json`, avec ses contrastes (C2), et publié en contrat `contracts/themes/tokens.v1.json`. Un test vérifie qu'il est à jour.
- Le fichier d'approbations a son format (C4).
- L'extension facultative de `board.dashboard/v1` porte `theme`, `template` et le composant `component` (C3, C6).
- L'extraction d'un modèle depuis un dashboard (C5) et la fermeture des dépendances (C8) sont des fonctions pures.

### 20.2 — Index, droits, routes et approbation

- La migration 0017 crée l'index des trois genres, des approbations et des références des dashboards vers les thèmes et les composants, avec réindexation complète.
- Les routes de chaque genre se placent sous `/api/spaces/{space_id}/themes`, `…/page-templates` et `…/components` : créer, lister, lire une révision, créer une révision, supprimer, historique, diff et approuver (C4, C7).
- Les références des dashboards sont validées : thème, composants, emplacements et règle `unapproved_reference`. Les consommateurs et le refus `content_in_use` sont branchés.
- Les contrats d'exemple sont produits par le serveur réel, avec la télémétrie des nouvelles opérations et les tests de permissions, de mode local et de confidentialité.

### 20.3 — Contrat web

Cette tranche livre les décodeurs stricts et les clients des routes 20.2. Le catalogue des tokens est décodé côté web, et sa table de contrastes est vérifiée contre `charts/theme.ts`.

### 20.4 — Modèle d'édition

Module pur, sans écran :
- la construction d'un `ChartTheme` depuis un thème et le catalogue ;
- l'héritage par type de graphique dans `resolveVisual` et `resolveKpi` ;
- les commandes de l'éditeur de thème avec annuler et rétablir ;
- les commandes du dashboard : choisir le thème, insérer, détacher et adopter un composant, remplir un emplacement ;
- l'instanciation d'un modèle ;
- les nouveaux problèmes : emplacement vide, référence non approuvée dans un dashboard partagé, écart de révision d'un composant.

### 20.5 — Écrans

Comme 19.5, en trois commits :
- `feat(plan20-20.5a)` livre l'entrée Thèmes, la liste et l'éditeur de thème avec son aperçu, ainsi que l'approbation avec diff ;
- `feat(plan20-20.5b)` livre les modèles de page et les composants (listes, création depuis un dashboard, approbation), le dialogue « Nouveau dashboard » avec modèle et thème, et dans l'éditeur le thème, les composants, « Détacher », l'écart de révision et les emplacements ;
- `feat(plan20-20.5c)` livre le parcours d'acceptation complet du §4 et les captures (C9).

## 4. Acceptation du plan

Le parcours d'acceptation se déroule ainsi :
1. Un créateur crée un brouillon de thème en ne choisissant que des tokens admissibles. Un token sous le seuil de contraste ne lui est pas proposé, et le serveur le refuse.
2. Il l'applique à son dashboard personnel. Les visuels changent, mais ni les résultats ni les requêtes soumises.
3. Le même brouillon est refusé dans un dashboard partagé (`unapproved_reference`). Un administrateur l'approuve en voyant le diff, puis le dashboard partagé l'accepte.
4. Le créateur enregistre un dashboard comme modèle de page : ni analyse ni cible n'y subsiste. Il crée un nouveau dashboard depuis ce modèle et ce thème, et remplit ses emplacements.
5. Un composant approuvé est inséré, s'exécute comme le visuel équivalent, puis est détaché et rattaché par annuler. Sa nouvelle révision est signalée, comparée puis adoptée.
6. La suppression d'un thème ou d'un composant utilisé est refusée avec ses consommateurs.

Les vérifications transverses sont les suivantes :
- Les brouillons ne fuient vers personne d'autre que leur auteur et les administrateurs.
- L'historique, le diff et les approbations sont relus depuis git, et l'index se reconstruit depuis le dépôt.
- Aucune couleur brute, aucun SQL ni aucune requête n'est écrit dans un thème, un modèle ou un composant.
- Tout est utilisable au clavier, aux trois largeurs et sous les deux bases.

À la fin de ce plan, le lot 07 est déclaré livré.

## 5. Risques et hors périmètre

| Risque | Mesure prévue |
|---|---|
| Un thème rend un graphique illisible. | Palette fermée de tokens, contrastes calculés et vérifiés au serveur comme au web ; aucune valeur saisie. |
| Un thème ou un composant change un calcul. | Présentation et requête séparées dans les formats ; test d'identité de la requête soumise. |
| Un brouillon fuit vers un dashboard partagé ou un autre membre. | Règle `unapproved_reference` au serveur ; visibilité des brouillons restreinte ; tests de fuite par route. |
| Une approbation se perd ou diverge de l'index. | Approbation versionnée dans git avec révision attendue ; réindexation testée. |
| Un modèle emporte des analyses ou des cibles hors de leur contexte. | Extraction pure en emplacements, sans identifiant d'analyse ni cible ; test sentinelle. |
| La généralisation de l'adaptateur casse les analyses ou les dashboards. | Suites des plans 18 et 19 inchangées et passées avant toute écriture des nouveaux genres. |

Hors périmètre :
- inclusion dans les releases et colonne « par environnement » (lot 09), la fermeture des dépendances étant prête ;
- couleurs libres, polices importées et images ;
- composants programmés et place de marché ;
- consultation, partage et exports (lot 08) ;
- dépendances entre filtres et interactions entre visuels (lot 08) ;
- métriques adhoc (SK-11).

## Réalisation

### 20.1 — Genres, formats et catalogue des tokens

Développé par Codex (gpt-6.1-terra), en petites étapes successives, puis relu par Claude Sonnet 5.5 : une revue, puis une contre-revue. Cette tranche couvre le serveur et les contrats, sans route ni migration.

*Genres (C1).* Le dépôt de contenus (`content/repository.py`) ajoute les genres fermés `theme`, `page_template` et `component`, chacun dans son répertoire (`themes/`, `templates/`, `components/`), avec son message de commit, son historique et son diff structurel. Les garanties du plan 19 sont inchangées. Des tests croisés vérifient l'isolation des cinq genres, à la création comme à la révision.

*Catalogue des tokens (C2).*
- `content/token_catalog.py` calcule, depuis `docs/design/tokens.json`, les tokens admissibles par base, avec leur luminance et leur contraste sur la surface. La base `skifer-clair` a pour surface `surface`, et la base `skifer-ardoise` le token `slate900`.
- Les seuils sont inclusifs : 3:1 pour une marque, 4,5:1 pour un texte. La formule est celle de `charts/theme.ts`.
- Le résultat est publié dans `contracts/themes/tokens.v1.json` et se régénère par `uv run python -m skifer_board.content.token_catalog`.
- Un test échoue si le contrat est périmé, quel que soit l'ordre des tests. Le test du point d'entrée intercepte ses écritures et n'écrit jamais dans le dépôt.

*Format `board.theme/v1` (C2).* Le schéma `contracts/themes/theme.v1.json` est fermé. Chaque couleur est un nom de token, et toute valeur `#RRGGBB` est refusée par une sentinelle. Les textes libres, nom et description, restent du texte. Les énumérations de légende, de format des nombres et d'infobulle référencent celles du dashboard (`$ref`). Les valeurs d'énumération sont en anglais, comme dans le reste du dépôt : `compact`, `normal`, `large`, `airy`.

La validation serveur (`content/theme.py`) contrôle :
- **l'admissibilité** de chaque token pour sa base et son rôle (`token_not_admissible`) ;
- **la palette catégorielle** : de 2 à 8 couleurs, sans deux tokens de même valeur (`duplicate_color`) ;
- **la palette séquentielle** : de 3 à 7 paliers de luminance strictement monotone (`not_monotone`) ;
- **la palette divergente** : un nombre impair de paliers, de 3 à 7 (`even_diverging`). Son centre est `neutral.fg` ou `neutral.bg`, les deux tokens que le design nomme neutres, à condition d'être admissibles sur la base (`non_neutral`). Les deux extrémités sont du même côté du centre, avec une monotonie stricte vers lui (`diverging_sides`).

*Modèle et composant (C5, C6).*
- `board.page_template/v1` réutilise les définitions du dashboard. Il ajoute l'emplacement `slot` (genre attendu et libellé) et des filtres sans cibles. Il n'admet aucun composant d'analyse, de KPI ou de composant approuvé, et les règles de structure et de bornes du dashboard s'y appliquent.
- `board.component/v1` porte un visuel ou un KPI, une référence `{analysis_id, revision}` et sa présentation. Le contrôle de l'analyse vient en 20.2.
- Les deux formats ont une sérialisation canonique, un diff et des sentinelles contre tout champ SQL, de requête ou de couleur. Leur validation est dans `content/structured_format.py`.

*Approbations (C4).*
- **Format.** Il est défini dans `contracts/approvals/approvals.v1.json`. Le fichier `approvals/<genre>/<espace>/<id>.yaml` liste les révisions approuvées, chacune avec son approbateur et son instant, en ordre strictement croissant.
- **Écriture.** `content/approvals.py` et le dépôt ajoutent une approbation sous verrou, avec la révision attendue de l'objet. Ils refusent une révision inexistante, un genre hors des trois et une révision déjà approuvée (`already_approved`). La concurrence est testée.

*Extension de `board.dashboard/v1` (C3, C6).*
- Le format reçoit deux champs facultatifs, `theme` `{theme_id, revision}` et `template` `{template_id, revision}`, ainsi que le nœud `{type: "component", component: {component_id, revision}}`. Ce nœud compte dans les 40 composants exécutables et peut être ciblé par un filtre commun.
- Toutes les fixtures du plan 19 restent valides. Une valeur de `theme` non structurée garde le refus `unknown_field`.
- La sentinelle « aucun champ SQL, requête ou style » interdit de nouveau tout nom contenant `theme` ou `template`, sauf les quatre noms exacts admis.
- Le test web qui compare les champs du schéma reconnaît les deux références facultatives. Le décodeur web vient en 20.3.

*Fonctions pures (C5, C8)*, dans `content/composition.py`.
- **Extraction d'un modèle.** Les visuels, KPI et composants deviennent des emplacements, dont le libellé est borné à 80 caractères. Les composants résolus sont fournis en paramètre. Les filtres perdent leurs cibles, et aucun identifiant d'analyse ni de composant ne subsiste.
- **Fermeture des dépendances.** Elle rend les analyses (directes et via les composants), le thème et les composants, triés et dédoublonnés. Un composant absent est refusé (`unresolved_component`).

*Codes.* Les nouveaux codes sont déclarés comme constantes dans `content/errors.py`, en ensembles fermés testés : `THEME_CODES`, `PAGE_TEMPLATE_CODES`, `COMPONENT_CODES`, `THEME_RULES` et `APPROVAL_CODES`.

*État transitoire assumé.* Jusqu'à 20.2, les routes de dashboard existantes acceptent les nouveaux champs sans vérifier l'existence, l'approbation ni les droits. Les nœuds composant n'entrent pas encore dans l'index des consommateurs, et le décodeur web ne les connaît pas. La branche n'est fusionnée qu'en fin de plan. Le rôle `unselectedEdge` du web sera dérivé en 20.4.

*Vérification.*
- **Revue.** La première revue a relevé huit points, tous corrigés :
  - un test du point d'entrée qui réécrivait le contrat ;
  - les côtés de la palette divergente ;
  - les couleurs dupliquées ;
  - des mutations survivantes ;
  - une sentinelle trop large ;
  - le discriminant `type` ;
  - les `$ref` ;
  - les codes fermés.
- **Contre-revue.** Elle a rendu fiable le test de tri de la fermeture, dont la mutation survivait selon `PYTHONHASHSEED`. Elle a aussi ajouté trois tests : une révision attendue mal formée, une révision approuvée illisible et la casse hexadécimale des doublons.
- **Mutations.** Deux survivantes restent justifiées : la borne des textes libres, choix acté, et un mutant équivalent sur l'égalité de luminance.
- **Gate complet.**
  - Python : 7 252 tests, couverture de 100 %.
  - Web : 3 882 tests, couverture de 100 %, build compris.
  - Bout en bout : 745 parcours passés, 1 ignoré.
  - Le contrat `tokens.v1.json` est inchangé après la suite.

### 20.2 — Index, droits, routes et approbation

Développé par Codex (gpt-6.1-terra) en petites étapes successives, de a à e, puis relu par Claude Sonnet 5.5 : une revue, puis une contre-revue.

*Index (C1, C4, C8).*
- La migration `0017_shared_content_index` crée :
  - une table commune `shared_content_index` pour les trois genres, avec une colonne `kind` contrainte ;
  - `content_approvals` ;
  - `dashboard_theme_references` et `dashboard_component_references`, supprimées en cascade avec la ligne du dashboard.
- Les colonnes propres au composant (genre attendu, analyse épinglée) sont contraintes à n'exister que pour lui.
- La provenance `template` n'est pas indexée comme une consommation : un modèle de page n'a jamais de consommateur.
- La réindexation reconstruit, dans une seule transaction, les analyses, les dashboards, les trois genres, les approbations et les références. Elle est idempotente.

*Routes (C4, C7).*
- `content/shared_web.py` est un seul module paramétré par genre, sous `/api/spaces/{space_id}/themes`, `…/page-templates` et `…/components`. Ses routes : créer, lister, lire, réviser, supprimer, historique, diff, approuver et lire les approbations. Les formes, codes et en-têtes sont ceux des dashboards.
- Les règles d'accès sont dans `content/shared_access.py`.
  - **Brouillons.** L'auteur et les administrateurs voient tous les brouillons. Un autre créateur ne voit que les révisions approuvées, et sa « révision courante » est la dernière qui lui est visible.
  - **Inexistence.** Un brouillon d'autrui et un objet inexistant donnent la même réponse, corps et en-têtes compris.
  - **Refus.** Un lecteur reçoit `forbidden`, un non-membre un 404, et le mode local `local_mode`.
  - **Approbation.** Elle est réservée à `admin`. La révision attendue est contrôlée sous verrou, et `already_approved` renvoie un 409. La réponse porte le diff avec la plus grande révision approuvée inférieure.
- **Source des approbations.** Git fait foi : les décisions ne lisent que git, et l'index ne sert qu'à la liste et à `index_stale`.
- **Historique.** Il garde les numéros réels, qui sont publics. Un trou dans la suite des numéros est donc assumé.

*Références des dashboards (C3, C4, C6).*
- **Contrôle à l'écriture.** `content/dashboard_shared.py` refuse un thème ou un composant introuvable, avec `theme_not_found` ou `component_not_found` au pointeur.
- **Approbation exigée.** Un dashboard partagé n'accepte que la révision approuvée exacte, sinon `unapproved_reference`. Un dashboard personnel accepte aussi les brouillons de son propriétaire, et un brouillon d'autrui y est traité comme introuvable.
- **Lecture.** Elle embarque les documents épinglés du thème et des composants (`resolved`), passés au même filtre. Les lecteurs n'ont pas accès aux routes des thèmes.
- **Composant.**
  - Son analyse doit être partagée.
  - Le nœud se résout vers l'analyse et la présentation du composant, compte dans la borne de 40 et peut être ciblé par un filtre.
  - Une référence non résolue rend la tuile indisponible, sans jamais l'exécuter.
- **Écritures concurrentes.** Une écriture qui dépend de références exige la tête git de sa validation. Si cette tête a bougé, la validation et l'écriture sont relancées une fois, puis la réponse est `revision_conflict` (`stale`). La raison interne `head_changed` n'est jamais exposée.

*Consommateurs.*
- **`content_in_use`.** La suppression d'un thème ou d'un composant dont la révision courante est consommée est refusée avec ce code, au format de `analysis_in_use` : les consommateurs visibles sont listés, les autres seulement comptés.
- **`analysis_in_use`.** Il compte aussi les composants et les dashboards qui consomment l'analyse à travers eux.
- **Index illisible.** Le refus reste fail-closed : un 503 `content_unavailable`, selon la règle de la Réalisation 19.2.
- **Liste.** Elle compte les contenus illisibles au lieu d'échouer.

*Contrats, confidentialité et télémétrie.*
- Les exemples sont produits par le serveur réel : 20 pour les thèmes, 18 pour les modèles et 20 pour les composants, plus trois exemples de dashboard et d'analyse. Leur mise à jour est testée.
- Une sentinelle vérifie l'absence de valeur hexadécimale, de SQL et de jeton dans les contrats, les réponses et les journaux.
- Les nouveaux codes et opérations entrent dans les ensembles fermés de la télémétrie.
- Une matrice récapitulative croise rôle, état, propriétaire, visibilité du dashboard et action.

*Alignement web.*
- Le commit doit garder le gate web vert. Les modules web existants décodent donc déjà strictement :
  - `theme`, `template` et le nœud `component` ;
  - `resolved`, avec les documents de thème (`src/themes/document.ts`) et de composant (`src/components-lib/document.ts`) ;
  - les refus `unapproved_reference` et `content_in_use`, et le consommateur `component` ;
  - les diffs de thème, de modèle et de composant ;
  - les règles `theme_not_found` et `component_not_found`.
- Un inventaire figé des codes du serveur est comparé à ceux du web.
- Un composant s'affiche pour l'instant indisponible, avec sa raison. Son rendu viendra en 20.4 et 20.5.

*Reporté à 20.3 et 20.4.*
- Avec B8, c'est le web qui exécute les tuiles. Restent donc à faire côté web :
  - la composition de la requête d'une tuile composant, identique octet pour octet à celle du visuel équivalent, y compris avec un filtre commun ;
  - la requête inchangée par un changement de thème ;
  - les refus `DENY` et `REQUIRE_HUMAN` d'une tuile composant, rendus tels quels.
- La raison fermée `component_unavailable`, au lieu de `analysis_unavailable`, est prévue en 20.3.

*Vérification.*
- **Arbitrage en cours de tranche.** Une première version relisait git quand l'index était en panne et changeait une attente du plan 19. Elle a été ramenée au fail-closed, avec le test d'origine restauré.
- **Revue Sonnet.** Elle n'a trouvé aucune fuite. Sur 33 mutations, 28 étaient tuées. Elle a relevé :
  - un 500 à l'approbation d'un identifiant mal formé ;
  - deux règles sans test : la révision approuvée exacte et l'épinglage de `resolved` ;
  - la lecture courante d'un autre créateur ;
  - la double source des approbations ;
  - la base du diff d'approbation ;
  - du code dupliqué.

  S'y ajoute l'exposition de `head_changed`, que j'ai relevée moi-même. Tout a été corrigé.
- **Contre-revue.** Elle a repéré une liste qui avalait une panne de git, ce qui était une approximation silencieuse. Désormais, seuls les contenus abîmés sont comptés, et une panne de git rend un 503. Un test sans effet a été renforcé. Sur 20 mutations, 18 sont tuées. Les 2 survivantes sont :
  - un mutant équivalent, une condition de tête redondante et justifiée ;
  - la mutation que ce test renforcé tue désormais.
- **Gate complet.**
  - Python : 7 490 tests, couverture de 100 %.
  - Web : 3 898 tests, couverture de 100 %, build compris.
  - Bout en bout : 745 parcours passés et 1 ignoré.
  - Aucune exclusion de couverture nouvelle.

### 20.3 — Contrat web

Développé par Codex (gpt-6.1-terra) en sous-étapes, de a à b3, puis relu par Claude Sonnet 5.5 : une revue, puis une contre-revue. Un redémarrage de la machine a interrompu la dernière sous-étape. Le travail conservé dans le worktree a été repris et vérifié.

*Catalogue des tokens (C2).*
- `src/themes/catalog.ts` importe statiquement le contrat `contracts/themes/tokens.v1.json` et le décode strictement. Le décodeur vérifie :
  - les clés, les surfaces et les luminances ;
  - la cohérence des contrastes ;
  - l'ensemble exact des tokens admissibles par base et par rôle.
- Les fonctions pures `admissible` et `contrastOf` refusent un nom hors catalogue, y compris un nom hérité de l'objet comme `constructor`.
- Un test recalcule chaque contraste depuis les valeurs des tokens avec `contrastRatio` de `charts/theme.ts`. Il retrouve les mêmes ensembles admissibles que le serveur aux seuils inclusifs de 3:1 et 4,5:1. Un catalogue incohérent est refusé.

*Clients et décodeurs.*
- `src/themes/`, `src/page-templates/` et `src/components-lib/` contiennent les clients des routes 20.2 : créer, lister, lire, réviser, supprimer, historique, diff, approuver, approbations et consommateurs.
- Les trois clients s'appuient sur une fabrique commune, `src/shared-content/`, qui reprend `call` de `spaces/admin.ts`. Elle porte l'ETag, l'annulation, la perte de session ou d'espace et la lecture exacte des entiers.
- Les décodeurs de succès et de refus sont stricts. `head_changed` n'est jamais accepté, et `already_approved` est distingué.
- Le diff accepte l'égalité JSON quand le serveur sépare `1` de `1.0`.
- Les 20 exemples des thèmes, les 18 des modèles et les 20 des composants sont décodés et comptés exactement. L'écart réel d'un modèle est comparé à la réponse de la route réelle.

*`component_unavailable`.*
- La tuile d'un composant bloqué porte désormais cette raison fermée, au lieu de `analysis_unavailable` : composant non approuvé dans un dashboard partagé, introuvable ou illisible.
- Une analyse indisponible derrière un composant résolu garde `analysis_unavailable`.
- Le serveur, le contrat `lire-composant-indisponible.json`, le décodeur, les libellés, l'aperçu et les problèmes de l'éditeur sont alignés.
- Un inventaire figé des codes du serveur pour les trois genres est comparé aux ensembles du web.

*Vérification.*
- **Revue.** Sonnet a appliqué 45 mutations : 27 ont été tuées. Elle a relevé :
  - un diff de composant rejeté à tort à cause de `1.0` ;
  - des effets de session et d'espace non testés ;
  - la lecture exacte non testée ;
  - le refus d'un catalogue incohérent non testé ;
  - deux cas de `component_unavailable` sans test ;
  - la duplication des clients et quelques points mineurs.

  Tout a été corrigé.
- **Contre-revue.** Les survivantes à corriger sont tuées, et la factorisation ne perd rien : 16 des 19 mutations de la fabrique commune sont tuées. Deux tests mineurs restent, sans régression : l'identifiant d'une réponse différent de celui demandé, et `expected` à `text` dans un diff de modèle. Ils sont ajoutés en tête de 20.4.
- **Gate complet.**
  - Python : 7 492 tests, couverture de 100 %.
  - Web : 3 971 tests, couverture de 100 %, build compris.
  - Bout en bout : 745 parcours passés et 1 ignoré.
  - Aucune exclusion de couverture nouvelle.

### 20.4 — Modèle d'édition

Développé par Codex (gpt-6.1-terra) en sous-étapes, de a à c3e, puis corrigé en deux temps. Relu par Claude Sonnet 5.5 : une revue, puis une contre-revue. La tranche reste un module pur, sans écran nouveau. Les deux tests mineurs reportés de 20.3 sont faits en tête : l'identifiant de la réponse est contrôlé, et `expected` vaut `text` dans un diff de modèle.

*Thème graphique (C2, C3).*
- `src/themes/chartTheme.ts` construit un `ChartTheme` depuis un thème et le catalogue des tokens, sans aucune couleur écrite. Les rôles des marques et ceux du texte sont appliqués, avec leurs contrastes vérifiés.
- Les rôles `unselectedFill` et `unselectedEdge` n'existent pas dans le format. Leur valeur est donc dérivée, dans cet ordre :
  1. celle de la base ;
  2. sinon la grille ou la série, si elle atteint 3:1 ;
  3. sinon le bord de la base.
- Un token inconnu ou une palette invalide donne une erreur fermée.
- **Dashboard.** `dashboardChartTheme` rend le thème du dashboard. Si ce thème n'est pas lu, est illisible ou est refusé, le dashboard est rendu en Skifer clair avec l'avertissement `theme_unavailable` au pointeur `/theme`. Le repli n'est jamais silencieux, et l'éditeur ne plante pas.
- **Champs pas encore rendus.** Les palettes catégorielle et divergente, l'échelle typographique et la densité n'ont pas d'équivalent dans `ChartTheme` : aucun graphique actuel ne les utilise. Ils sont validés et enregistrés. L'éditeur de 20.5a le dira sur chaque champ, et `id` et `label` restent ceux de la base.

*Héritage (C3).*
- Les défauts du thème par type de graphique, ainsi que ses formats, entrent dans `resolveVisual` et `resolveKpi` au niveau « thème » de B9.
- Ils s'appliquent aux tuiles, aux propriétés et à l'aperçu de l'éditeur, avec l'origine « Thème : nom ».

*Règle des palettes : amendement de la règle serveur de 20.1.*
- **Ce qui change.** 20.1 exigeait 3:1 de chaque palier séquentiel et divergent. C'était contraire au design du plan 02 : `SKIFER_CLAIR.sequential` commence par un palier pâle, et l'échelle y est ordonnée par contraste croissant.
- **Règle retenue, identique au serveur et au web :**
  - **catégorielle** : inchangée, 3:1 et couleurs distinctes ;
  - **séquentielle** : des tokens du catalogue, chaque contraste avec la surface au moins **1,10 fois** celui du palier précédent, et un dernier palier à au moins 3:1 ;
  - **divergente** : un nombre impair de paliers, un centre neutre (`neutral.fg` ou `neutral.bg`) sans exigence de contraste, et la même progression d'au moins 1,10 sur chaque aile vers des extrémités à au moins 3:1.
- **Pourquoi le facteur 1,10.** Sans lui, des paliers presque indiscernables étaient admis. Les palettes Skifer passent, avec un rapport minimal de 1,134.
- **Parité.** La constante est vérifiée des deux côtés. Les fixtures reproduisent exactement Skifer clair et Skifer ardoise et sont acceptées par le serveur. Les fixtures invalides couvrent l'égalité de contraste, l'écart insuffisant et les bords.
- Un thème valide en 20.1 peut donc être refusé, ce que le CHANGELOG dit.

*Éditeur de thème.* `src/themes/edition.ts` fournit :
- un réducteur pur avec annuler et rétablir sur 100 états ;
- `themeProblems`, à parité avec les fixtures invalides du serveur ;
- `choicesFor`, qui ne propose que les tokens admissibles.

*Commandes du dashboard (C3, C5, C6).*
- `set_theme`, `insert_component` et `adopt_component_revision`.
- `detach_component` garde l'identifiant du nœud et les cibles des filtres, et s'annule en une étape.
- `fill_slot` contrôle le genre de l'emplacement, et le genre réel d'un composant résolu. Il garde l'identifiant du nœud.
- `instantiateTemplate` copie un modèle avec de nouveaux identifiants : aucun identifiant de la source ne subsiste.
- **Emplacements.** Le nœud `slot` n'existe que dans le brouillon web. La création et la révision sont refusées localement tant qu'il en reste un (`empty_slot`). Le serveur, lui, refuse le nœud.

*Problèmes.*
- `empty_slot`, bloquant.
- `unapproved_reference` pour un dashboard partagé.
- `component_revision_behind`, avec comparaison et adoption.
- `component_unavailable`.
- `theme_unavailable`, non bloquant.

*Références.*
- `useReferenceStates` lit les états et les documents des thèmes et des composants, y compris ceux ajoutés localement.
- **Changement de contexte.** Aucun état n'est réutilisé entre deux contextes : un aller-retour A → B → A attend la nouvelle réponse. `useOutcome` accepte pour cela une clé objet, sans effet sur ses autres usages.
- Une erreur de lecture laisse la référence non résolue.
- Pour une référence inchangée, l'éditeur prend d'abord ce que le serveur a résolu, puis les documents lus.

*Exécution des composants (C6, B8).*
- Une tuile composant soumet la même requête que le visuel équivalent, et partage son refus : `DENY` ou `REQUIRE_HUMAN` avec une seule soumission.
- Un composant non résolu n'est jamais soumis.
- Un changement de thème laisse les corps de requête soumis identiques octet pour octet, ainsi que les valeurs des options une fois retirées les seules clés de couleur et de police. C'est vérifié sur `value`, `bars`, `line` et `grouped_bars`.

*Vérification.*
- **Revue.** Sonnet a appliqué 47 mutations : 36 tuées, 11 survivantes. Elle a relevé :
  - **bloquant** : des rôles de texte ignorés en silence ;
  - **importants** :
    - une exception de rendu sur un thème refusé ;
    - un test d'invariance qui comparait un objet à lui-même ;
    - la monotonie stricte non testée ;
    - les identifiants du gabarit peu contrôlés ;
    - les défauts du thème non branchés sur les tuiles ;
  - quelques mineurs.

  Tout a été corrigé, et le facteur 1,10 a été ajouté sur sa recommandation.
- **Contre-revue.** Toutes les corrections sont vérifiées : 40 des 47 nouvelles mutations sont tuées, dont toutes celles du facteur 1,10 au serveur et au web. Les survivantes étaient des trous de test, désormais comblés :
  - les défauts du thème dans les propriétés, le canevas et l'aperçu ;
  - l'identifiant conservé par `fill_slot` ;
  - un composant local illisible, bloquant et jamais soumis ;
  - l'absence de défauts d'un thème refusé pendant le repli.
- **Limite connue.** Un thème non résolu dans un dashboard partagé n'est qu'un avertissement dans l'éditeur. Le serveur reste juge du refus à l'enregistrement.
- **Gate complet.**
  - Python : 7 505 tests, couverture de 100 %.
  - Web : 4 041 tests, couverture de 100 %, build compris.
  - Bout en bout : 745 parcours passés et 1 ignoré.
  - Aucune exclusion de couverture nouvelle.

### 20.5a — Entrée Thèmes, liste, éditeur, aperçu et approbation

Développé par Codex (gpt-6.1-terra) en sous-étapes : a, puis b1 à b4, puis c, et deux passes de design. Relu par Claude Sonnet 5.5 : une revue, puis une contre-revue.

Une session Codex neuve a pris le relais à partir de b1. Reprise depuis le plan 20.1, l'ancienne consommait plusieurs millions de tokens par passe et s'arrêtait après un fragment.

Une pause demandée par le porteur, puis un redémarrage, ont interrompu la seconde passe de design. Le travail conservé dans le worktree a été vérifié (`check:web` et la spec), puis terminé.

*Navigation et liste (C9).*
- L'entrée « Thèmes » se place après Dashboards.
  - Routes : `#/espaces/{space}/themes`, `…/themes/nouveau` et `…/themes/{id}`.
  - Elle est ouverte à `creator` et `admin`. Elle est fermée avec « sans rôle » pour le rôle `reader`, et avec « mode local » en mode local.
  - Dans les tests existants, seules les énumérations des entrées ont changé.
- La liste donne pour chaque thème :
  - le nom ;
  - le propriétaire ;
  - la révision et le commit ;
  - l'état, avec l'écart entre révision approuvée et brouillon ;
  - l'index ;
  - le nombre de dashboards qui l'utilisent.
- Ce nombre se lit ligne par ligne par la route des consommateurs, en comptant aussi ceux que la personne ne voit pas. Un échec affiche « indisponible » avec sa raison, jamais 0.
- Une note annonce la colonne « par environnement » pour le lot 09.

*Éditeur (C2, C9).*
- **Organisation.** Les champs sont regroupés en sections repliables, et chaque choix de token est une liste compacte avec sa pastille, en variable CSS, et son contraste.
- **Seuils.** Un token sous le seuil n'est jamais proposé là où le seuil s'applique. Les paliers intermédiaires et le centre divergent proposent tous les tokens connus, et la règle des palettes juge.
- **Base.** Un changement de base ne remplace aucun choix en silence : un token devenu inadmissible est signalé.
- **Nom.** Un nom vide est accepté pendant la saisie et signalé `name_required`.
- **Champs pas encore rendus.** Les palettes catégorielle et divergente, l'échelle typographique et la densité portent « enregistré, pas encore rendu par les graphiques de Board ».
- **Édition.**
  - Annuler et rétablir, par les boutons et au clavier.
  - Une garde de sortie protège un brouillon modifié.
  - L'enregistrement se fait en création, ou en révision avec la révision attendue.
- **Refus, rendus tels quels et sans nouvel essai.** `revision_conflict` propose « Recharger » et n'écrase rien. Sont aussi rendus `invalid_theme`, avec ses chemins, `forbidden`, `not_owner` et `local_mode`. Une erreur réseau ne fait pas perdre le brouillon.
- **Historique.** Il donne les révisions, et la lecture d'une révision ancienne en lecture seule. Un historique vide est une rupture de contrat, rendue en erreur.

*Aperçu (C9).*
- Il porte sur un dashboard de référence aux données d'exemple embarquées : une valeur, des barres, une ligne et des barres groupées.
- Aucun appel réseau, un bandeau permanent, et aucun export.
- Il est rendu avec `chartThemeOf`, les défauts et les formats du thème. Il affiche exactement ce qu'afficherait une tuile de dashboard.
- Il est indisponible, avec sa raison, tant qu'il reste un problème. La base du thème décide de la surface.
- Sur ordinateur, il reste à côté des champs et défile. Sur téléphone, un lien y mène.

*Format de date du thème (C2, C3).*
- Il s'applique aux axes temporels et aux infobulles, dans l'aperçu comme dans les tuiles des dashboards. La date et l'heure d'un horodatage sont séparées.
- Le format par défaut garde le rendu d'avant, octet pour octet, et les données et les requêtes ne changent pas.
- Le format « Court », qui est le défaut, le dit dans l'éditeur.

*Approbation et suppression (C4).*
- **Approbation.** Elle est réservée à l'administrateur.
  - L'écran montre le diff structurel avec la révision approuvée précédente, ou « Première approbation » avec un résumé.
  - Elle se fait avec la révision attendue. Un diff périmé ou un brouillon modifié la désactive.
  - Les refus sont rendus tels quels. Un succès relit le thème et la liste.
- **Suppression.** Elle passe par une confirmation. Le refus `content_in_use` liste les dashboards visibles, avec leur lien, et compte les autres.

*Bout en bout.*
- `e2e/serveur-themes.ts` part des exemples réels des routes, et consigne toute demande hors scénario, révisions attendues comprises.
- `e2e/themes.spec.ts` compte 42 parcours sur ordinateur et téléphone. Ils couvrent les étapes 1, 3 (diff et approbation) et 6 du §4, les états, le clavier seul et Axe sous les deux bases. Les étapes 2 et 3 côté dashboard viendront en 20.5b.
- Captures : la liste, l'éditeur, l'aperçu seul et l'approbation, sur ordinateur et téléphone.

*Vérification.*
- **Design.** Les premières captures ont été ouvertes avant toute revue. L'éditeur faisait 5 700 px sur ordinateur, avec des murs de boutons radio, des boutons natifs, des clés brutes du schéma et l'aperçu en bas de page. Deux passes de design l'ont ramené à l'idiome de l'éditeur de dashboard.
- **Revue.** Sonnet a appliqué 45 mutations, dont 31 tuées, et n'a trouvé aucune violation d'invariant. Elle a relevé :
  - le rendu par défaut des KPI des dashboards changé. C'était une erreur de ma consigne, et ce rendu a été rétabli ;
  - un décodeur d'historique assoupli sans raison ;
  - un horodatage collé « 2026T12 » ;
  - quatre trous de test ;
  - des mineurs de texte, de mise en page et de CHANGELOG.

  Tout a été corrigé.
- **Contre-revue.** OK pour commit. Les mutations survivantes de la revue sont tuées, comme dix nouvelles. Seule survit une mutation sur le minimum de l'historique, que le test refuse pour une autre raison. À durcir plus tard en vérifiant l'erreur de contrat.
- **Non-régression.** Le gate complet a révélé trois specs e2e existantes qui énuméraient les entrées de navigation, ou qui en dépendaient : `catalogue`, `parcours` et les captures téléphone d'`executions`. Seul « Thèmes » y est ajouté. J'ai vérifié que la navigation est la seule différence de ces captures.
- **Gate complet.**
  - Python : 7 505 tests, couverture de 100 %.
  - Web : 4 122 tests, couverture de 100 %, build compris.
  - Bout en bout : 787 parcours passés et 1 ignoré.
  - Aucune exclusion de couverture nouvelle.

### 20.5b — Modèles de page, composants, Nouveau dashboard, et thème et composants dans l'éditeur

Développé par Codex (gpt-6.1-terra) en sous-étapes d1 à d5, avec une passe de design à chaque étape d'écran. Relu par Claude Sonnet 5.5 : une revue, puis une contre-revue.

Deux sessions Codex se sont succédé : la première à partir de d1 et jusqu'à d2, puis une session neuve à partir des retouches de d2. Le porteur a demandé deux pauses en cours de tranche. Les commits intermédiaires « en cours » ont été réunis dans ce commit.

*Modèles et composants dans l'entrée Thèmes (C4, C7, C9).*
- Les onglets Thèmes, Modèles de page et Composants partagent la liste de 20.5a (`ContentListPage`). L'onglet courant est marqué. Routes : `#/espaces/{space}/modeles[/{id}]` et `…/composants[/{id}]`.
- Une même fiche (`shared-content/ContentPage`) sert aux deux genres :
  - la révision du nom et de la description, avec la révision attendue ;
  - l'historique, et la lecture d'une révision ancienne ;
  - l'approbation par l'administrateur, avec le diff et des chemins en français, ou « Première approbation » avec un résumé ;
  - la suppression, avec ses consommateurs.
- La fiche d'un modèle montre son squelette en lecture seule : sections, rangées, colonnes, emplacements, textes, séparateurs, conteneurs et filtres communs sans cibles.
- La fiche d'un composant montre son genre, l'analyse épinglée, avec son identifiant, et sa présentation sémantique. Elle n'exécute rien et le dit.

*Enregistrer comme modèle, comme composant (C5, C6).*
- `extractTemplate` porte en TypeScript l'extraction `extract_template` du serveur. Un exemple produit par le serveur réel (`contracts/page_templates/extraction/`) est vérifié des deux côtés : l'extraction donne le même modèle, octet pour octet.
  - Aucune analyse, aucune cible ni aucune référence de composant ne subsiste.
  - Un composant non résolu, ou un modèle que le contrat refuse, est un refus typé, rendu dans le dialogue. Rien n'est deviné.
- « Enregistrer comme modèle » se trouve dans la barre d'actions. Il n'est désactivé, avec sa raison, que par des modifications non enregistrées, un problème bloquant ou un composant non lu. Un dashboard ouvert en lecture seule s'extrait aussi : le serveur reste juge.
- « Enregistrer comme composant » se trouve dans les propriétés d'un visuel ou d'un KPI.
  - Il reprend l'analyse épinglée et la présentation propre du nœud, sans les défauts du thème ni du dashboard.
  - Une analyse personnelle est refusée localement, avec sa raison.

*Thème et composants dans l'éditeur (C3, C6).*
- **Thème.** La liste « Thème » est dans les propriétés du dashboard : approuvés seulement pour un dashboard partagé, plus les brouillons de l'auteur pour un personnel. Le choix est annulable.
  - Un thème épinglé hors des choix courants garde son nom et sa raison : ancienne révision approuvée, ou brouillon interdit en partagé.
  - Le refus `unapproved_reference` est rendu avec ses chemins.
- **Palette.** La section « Composants approuvés » suit la même règle de visibilité.
- **Tuile composant.**
  - Elle porte le badge « Composant : nom rN » et n'a pas de surcharge locale.
  - « Détacher » s'annule en une étape.
  - L'écart de révision se compare, s'adopte ou se garde. Dans un dashboard partagé, seule une révision approuvée plus récente s'adopte, et sinon la raison est affichée.
- **Emplacements.** Un emplacement vide est une tuile pointillée, avec son libellé, son genre attendu et le problème bloquant `empty_slot`. « Remplir » ne propose que des analyses ou des composants du bon genre, et dit pourquoi les analyses personnelles manquent en partagé.
- **Arbitrage.** Le libellé d'origine « Composant » de l'héritage B9 du plan 19, qui désigne la surcharge propre d'une tuile, devient « Tuile » : « composant » désigne désormais le contenu réutilisable. La clé interne est inchangée. C'est le seul changement d'attente des plans 18 et 19.
- **Références.** Les références inchangées gardent leur état pendant une relecture, puisque les révisions épinglées sont immuables. Une insertion n'annule plus l'exécution des autres composants, et un refus n'est jamais masqué par un succès antérieur.

*Nouveau dashboard avec modèle et thème (C3, C5).*
- Le dialogue gagne les listes facultatives « Modèle de page » et « Thème », avec la même règle de visibilité.
  - Changer de visibilité signale un brouillon devenu interdit et bloque la création, sans le retirer en silence.
  - Une liste en lecture ou en erreur le dit, propose « Réessayer » et permet de créer sans.
- **Avec un modèle, rien n'est créé au serveur.**
  - Le dialogue dit « Ouvrir le brouillon » et annonce que le dashboard sera créé au premier enregistrement.
  - L'éditeur s'ouvre sur un brouillon local jamais enregistré, « Issu du modèle Exemple · r1 ». Il est protégé par une garde de sortie, et l'enregistrement est bloqué tant qu'un emplacement est vide.
  - Le premier enregistrement crée le dashboard, avec ses provenances `template` et `theme`. La sortie est bloquée pendant la création, et la garde reste levée une fois la création faite.
- Sans modèle, le comportement est inchangé.

*Bout en bout.*
- Les specs `modeles-composants`, `enregistrer-contenus`, `editeur-contenus`, `emplacements` et `nouveau-modele` couvrent :
  - les étapes 2 à 5 du §4 côté dashboard ;
  - un corps de requête soumis identique sous thème ;
  - Axe sous les deux bases.
- Le parcours des emplacements passe par le vrai chemin (Nouveau dashboard, puis modèle, puis brouillon local), et non par un état injecté.
- Captures sur ordinateur et téléphone : les listes et les fiches avec approbation, les deux dialogues « Enregistrer comme… », l'éditeur avec thème et tuile composant, l'emplacement vide, le dialogue « Nouveau dashboard » et le brouillon local issu d'un modèle.

*Vérification.*
- **Design.** Chaque étape d'écran a été ouverte en capture avant la revue. Les défauts relevés ont tous été corrigés :
  - un onglet courant sans marque ;
  - des titres internes plus gros que leur carte ;
  - un bouton désactivé étiré en bloc ;
  - une tuile composant sans nom ;
  - un « Créer et ouvrir » trompeur alors que rien n'est créé ;
  - une provenance de modèle absente.
- **Tests lents.** Deux tests d'éditeur dépassaient 5 s sous charge. Ils ont été découpés sans changer aucun délai, et la revue a fait rétablir les assertions perdues au découpage.
- **Revue.** Aucune violation d'invariant. Elle a relevé :
  - une garde de sortie qui pouvait se réarmer après la création du brouillon local ;
  - un thème épinglé affiché « indisponible » à tort ;
  - l'adoption d'une révision brouillon dans un dashboard partagé ;
  - des tests sans assertion ;
  - neuf mineurs, dont un filtre silencieux des analyses personnelles, une restriction locale sur l'extraction d'un dashboard en lecture seule, et un décodeur de refus des modèles élargi sans motif, rétabli comme en 20.3.

  Tout a été corrigé.
- **Contre-revue.** OK pour commit, et les 13 points sont vérifiés dans le code et les tests. Un seul test antérieur change d'attente, `useReferenceStates.test.tsx` : la révision approuvée vient désormais de la lecture courante du composant, et l'ancien mock contredisait le contrat. Quatre mineurs restent pour 20.5c :
  - un `leave()` vers l'adresse courante ne réarme pas la garde ;
  - « rien n'a été envoyé au serveur » s'affiche encore après une création refusée ou non confirmée ;
  - le retour de `useReferenceStates` n'est pas mémoïsé ;
  - pendant une relecture, un ancien succès reste affiché jusqu'à la réponse.
- **Non-régression.** Le gate a révélé que les captures de l'acceptation du plan 19 (`dashboards-acceptation`) dataient d'avant 20.5a. L'entrée « Thèmes » restait sous la tolérance de 1 %, mais les deux listes facultatives du dialogue « Nouveau dashboard » la dépassent. Les 20 captures de cette spec ont été régénérées. J'ai vérifié que seuls y apparaissent les ajouts du plan 20 : l'entrée « Thèmes », « Enregistrer comme modèle », la section « Composants approuvés », « Enregistrer comme composant » et les deux listes du dialogue. Aucune assertion n'a changé.
- **Gate complet.** Une erreur de lint (`any` dans une assertion) a été corrigée avant le gate final.
  - Python : 7 506 tests, couverture de 100 %.
  - Web : 4 304 tests, couverture de 100 %, build compris.
  - Bout en bout : 849 parcours passés et 1 ignoré.
  - Aucune exclusion de couverture nouvelle, et aucun `eslint-disable`.
