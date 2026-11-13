# Plan 20 — Thèmes, modèles de page et composants approuvés (lot 07b)

Date : 13 novembre 2026 · Statut : **à réaliser**. Second plan du lot 07, ouvert sur la composition des dashboards du [plan 19](19_composition_dashboards_plan.md). Il clôt le lot 07.

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
