# Plan 19 — Composition des dashboards (lot 07a)

Date : 6 novembre 2026 · Statut : **19.1 à 19.5a réalisées**, 19.5b et 19.5c à réaliser. Premier plan du lot 07, ouvert sur les analyses versionnées du [plan 18](18_analyses_versionnees_plan.md). Choix du porteur du 6 novembre, qui suivent les recommandations : **composition seulement**, thèmes, modèles de page et composants approuvés au plan 20 (lot 07b) ; **personnalisation graphique sémantique resserrée**, ce qui ferme pour la V1 l'arbitrage « profondeur de personnalisation » du §15 des écrans ; **tuiles exécutées avec les données de l'éditeur**. Pour chaque commit, le développement est confié à un agent tiré au sort entre Codex (gpt-6.1-terra) et Claude Sonnet 5.5, puis relu par l'autre avant commit ; l'orchestrateur commite, ouvre la demande de fusion et la fusionne.

Sources : [plan de développement](../plan-de-developpement.md), §4.1, §6.2, §8 lot 07 et §10.2 (D-3, D-4, D-5) ; [écrans](../ecrans-et-fonctionnalites.md), §0.2–0.5, §5 et §14 ; [maquette de l'éditeur](../design/mockups/03-editeur-dashboard.html) ; [décision 0001](../decisions/0001_bibliotheque_graphique.md) ; plans [02](02_socle_web_et_prototype_graphique_plan.md), [17](17_explorateur_plan.md) et [18](18_analyses_versionnees_plan.md).

## 1. Point de départ

- Une analyse (plan 18) est une requête déclarative versionnée dans le dépôt de contenus, avec ses calculs contextuels et une présentation par défaut (`value`, `bars`, `line`, `grouped_bars`). Son exécution porte une référence `{analysis_id, revision}` vérifiée par le serveur, qui contrôle l'existence, la visibilité et le modèle.
- L'adaptateur git du plan 18 ne connaît qu'un genre de contenu : il n'écrit que `analyses/<space_id>/<analysis_id>.yaml`. L'index des analyses vit en base (migration 0013), la dernière migration est la 0015.
- La suppression d'une analyse interroge déjà `analysis_consumers(space_id, analysis_id)` ; ce point d'injection rend toujours une liste vide. L'onglet Consommateurs de la fiche est donc vide.
- ECharts en rendu SVG est retenu (D-4), avec un constructeur pur par graphique et un thème en rôles visuels (plan 02, W7 et W8). La forme étroite des graphiques sous 480 px et le seuil de coque de 760 px sont dans les tokens (D-5).
- Les rôles d'espace sont `reader`, `creator` et `admin` (plan 08). Aucun écran Dashboards n'existe ; l'entrée de navigation est annoncée « à venir ».

## 2. Décisions

| # | Décision | Conséquence vérifiable |
|---|---|---|
| B1 | **Dépôt de contenus à plusieurs genres.** L'adaptateur git du plan 18 est généralisé à des genres fermés, `analysis` et `dashboard`, chacun avec son répertoire (`analyses/`, `dashboards/`), son schéma et ses messages de commit. Garanties inchangées : révisions immuables, révision attendue, verrou entre processus, mise à jour conditionnelle de la référence, historique et diff structurel. Aucun chemin n'est construit depuis une valeur du navigateur non validée. | Toute la suite du plan 18 passe sans modification de ses attentes ; tests croisés : une écriture de dashboard ne touche aucune analyse et inversement. |
| B2 | **Format `board.dashboard/v1`.** Un fichier YAML par dashboard, `dashboards/<space_id>/<dashboard_id>.yaml`, identifiants UUID générés par le serveur, JSON Schema `contracts/dashboards/dashboard.v1.json` source de vérité, validé côté serveur et décodé strictement côté web. Il contient : identité, nom, description, visibilité (`personal` ou `shared`), propriétaire (émetteur et sujet), défauts de présentation du dashboard, filtres communs et un arbre de mise en page. L'arbre : des **sections** (titre facultatif) contenant des **rangées** de **colonnes** sur une grille de 12 (largeur par colonne, de 1 à 12, somme au plus 12), chaque colonne contenant des composants ou un **conteneur** imbriqué, sur trois niveaux au plus. Composants fermés : `analysis` (visuel), `kpi`, `text`, `separator`. Bornes : 20 sections, 40 composants exécutables, 64 composants au total. Ni SQL, ni requête recopiée, ni données, ni secret, ni environnement, ni thème. | Corpus de fixtures valides et invalides ; sentinelle « aucun champ SQL ni requête accepté » ; bornes testées à la limite et au-delà ; sérialisation canonique stable. |
| B3 | **Texte sans script.** Un bloc `text` contient une liste fermée de paragraphes, intertitres et listes, avec emphase et gras. Il n'y a ni HTML, ni lien, ni image, ni Markdown libre. Le rendu passe par des éléments React construits depuis cette structure, jamais par `innerHTML`. | Test sentinelle : une balise ou un `javascript:` saisis s'affichent comme du texte ; aucun `dangerouslySetInnerHTML` dans le module. |
| B4 | **Analyses épinglées.** Un visuel ou un KPI référence `{analysis_id, revision}`. À la sauvegarde, le serveur vérifie que chaque révision existe et que l'analyse est lisible par l'auteur. Un dashboard **partagé** ne référence que des analyses partagées, sinon `personal_reference` avec la liste des composants en cause. Un dashboard personnel peut aussi référencer les analyses personnelles de son propriétaire. À la lecture, une analyse devenue illisible pour le lecteur, supprimée ou à l'état `unresolved_reference` rend sa tuile « référence non résolue » sans rien dévoiler de son contenu. Un KPI exige une analyse dont la présentation compatible est `value`. | Matrice visibilité du dashboard × visibilité de l'analyse × lecteur ; test de fuite : la tuile d'une analyse invisible ne porte ni nom ni modèle. |
| B5 | **Consommateurs réels.** L'index (migration 0016) garde les dashboards et leurs références d'analyses par révision courante. `analysis_consumers` rend les dashboards dont la révision courante référence l'analyse. La suppression d'une analyse consommée répond donc `analysis_in_use` : genre et identifiant pour les dashboards visibles du demandeur, un simple décompte pour les autres. L'onglet Consommateurs de la fiche suit la même règle. Une nouvelle révision d'une analyse ne modifie aucun dashboard. L'éditeur signale l'écart et propose de comparer, d'adopter la révision (nouvelle révision du dashboard) ou de garder l'épingle. | Suppression refusée puis acceptée après retrait de la tuile ; aucun identifiant de dashboard invisible dans la réponse ; réindexation sur base vierge. |
| B6 | **Droits.** Créer, réviser, dupliquer ou supprimer un dashboard exige les mêmes rôles que pour une analyse (A5 du plan 18). Le même filtre de visibilité s'applique à chaque route, administrateur compris. Mode local et non-membre refusés. Ouvrir un dashboard exécute chaque tuile avec l'identité et la RLS de la personne qui l'ouvre ; partager n'accorde aucun droit sur les données. | Matrice rôle × visibilité × action ; tests de fuite par route, sur le modèle du plan 18. |
| B7 | **Filtres communs.** Un filtre commun porte sur une dimension du catalogue déclaré, avec un opérateur fermé (`eq`, `in`, `between`) et une valeur par défaut facultative, typés et validés comme les filtres de l'Explorateur. Valeurs autorisées facultatives, dans la limite des valeurs saisies. Ses **cibles sont explicites** : la liste des composants auxquels il s'applique, proposée à la création parmi les tuiles dont le modèle expose cette dimension avec le même type, et modifiable tuile par tuile. Il s'ajoute aux filtres de l'analyse : il n'en remplace ni n'en retire aucun, et ne retire jamais une restriction `policy`. Si l'analyse filtre déjà la même dimension, les deux s'appliquent et la tuile l'indique. Une cible devenue incompatible rend la tuile indisponible avec sa raison, sans exécution sans le filtre. Un filtre sans cible est un problème bloquant à la sauvegarde. Un filtre ne cible jamais un paramètre de déploiement. | Tests de composition de requête : filtres de l'analyse conservés, ajout en conjonction, borne de 32 filtres ; cible incompatible ; aucune exécution partielle. |
| B8 | **Tuiles exécutées avec les données de l'éditeur.** Chaque tuile exécutable soumet sa requête par l'API d'exécution existante, avec la référence d'analyse. La requête est celle de la révision épinglée, plus les filtres communs ciblés. Au plus quatre exécutions sont en cours à la fois. Elles sont annulées à tout changement d'espace, d'identité, d'environnement ou de dashboard. Chaque tuile rend les états du §0.2 et son pied de provenance (§0.3). Un refus `DENY` ou `REQUIRE_HUMAN` est rendu tel quel et n'est jamais mis en cache comme un succès. Une analyse `unresolved_reference` ou `unverified` n'est pas exécutée. L'aperçu lecteur montre la mise en page d'un lecteur, sous un bandeau qui rappelle que les données restent celles de l'éditeur. | Tests du planificateur (borne, annulation, ordre) ; requête soumise identique quelle que soit la présentation ; refus non mis en cache ; télémétrie « tuiles par dashboard » sans valeurs. |
| B9 | **Personnalisation sémantique resserrée.** Par visuel : type parmi les présentations compatibles avec la forme de l'analyse, titre, légende (automatique, visible, masquée), format des nombres (liste fermée), seuil facultatif (valeur et libellé) avec le rôle visuel « sous le seuil » du thème, et contenu de l'infobulle (valeur, ou valeur et définition). Héritage affiché : thème, puis défauts du dashboard, puis composant ; chaque surcharge peut être retirée. Aucune option ECharts n'est exposée ni stockée ; aucune couleur brute. Les interactions entre visuels viennent au lot 08. | Constructeurs purs testés sans rendu ; test : un changement de présentation laisse identiques la requête et les valeurs de données des options ; refus d'un type incompatible. |
| B10 | **Édition.** Le document est modifié par des commandes pures (ajouter, déplacer, redimensionner, imbriquer, supprimer, modifier une propriété), au pointeur et au clavier. L'historique annuler/rétablir garde 100 états. Les changements non enregistrés sont signalés avant de quitter. Enregistrer crée une révision avec la révision attendue. En cas de conflit, aucun écrasement : seule une copie ou la réouverture de la révision courante reste possible, comme au plan 18.5b. L'aperçu responsive propose bureau (1280 px), tablette (768 px) et téléphone (390 px) : sous le seuil de coque, les colonnes s'empilent dans l'ordre du document ; sous 480 px, les graphiques prennent leur forme étroite. Le panneau bas montre les Problèmes (références non résolues, filtres sans cible ou incompatibles, bornes, écarts de révision), la Structure (arbre accessible au clavier) et les Filtres avec leurs cibles. | Réducteur testé commande par commande, avec annuler et rétablir ; parcours clavier complet ; calcul des problèmes testé par cas. |
| B11 | **Écrans.** La liste des dashboards (mes dashboards, partagés) ; le dialogue « Nouveau dashboard » (nom, description, visibilité) ; l'éditeur avec barre d'outils, palette, canevas, propriétés et panneau bas ; « Ajouter une analyse » avec recherche, aperçu et choix de la révision ; le conflit de révision ; l'historique avec diff structurel ; l'aperçu lecteur et l'aperçu responsive. Depuis la fiche d'une analyse : « Épingler à un dashboard ». L'onglet Consommateurs de la fiche est désormais alimenté. Tous les états du §0.2. | Tests de composants à 100 %, Axe sous les deux thèmes, parcours Playwright, captures ordinateur et téléphone. |

## 3. Tranches et commits

Chaque tranche a ses tests, une entrée dans `CHANGELOG.md` sous `Unreleased` et un commit `feat(plan19-19.x)`. Les tests sont hors réseau, sans clé ni cluster, sur dépôts git et bases jetables. L'agent qui développe est tiré au sort à chaque commit ; l'autre relit.

### 19.1 — Dépôt à plusieurs genres et format

Généralisation de l'adaptateur git (B1), sans changement du comportement des analyses. Format `board.dashboard/v1`, JSON Schema, fixtures et sérialisation canonique (B2, B3). Diff structurel des dashboards. Codes fermés : `invalid_dashboard` et ceux du plan 18.

### 19.2 — Index, droits, routes et consommateurs

Migration 0016 et réindexation des deux genres (B5). Routes sous `/api/spaces/{space_id}/dashboards` : créer, lister, lire une révision, créer une révision, dupliquer, supprimer, historique et diff (B6). Validation des références d'analyses (B4) et des filtres communs (B7). Branchement de `analysis_consumers` (B5). Contrats d'exemple produits par le serveur réel, télémétrie des nouvelles opérations, tests de permissions, de mode local et de confidentialité.

### 19.3 — Contrat web

Décodeurs stricts et clients des routes 19.2, ainsi que des consommateurs de la fiche analyse, sur les contrats d'exemple.

### 19.4 — Modèle d'édition

Module pur, sans écran : réducteur de commandes avec annuler et rétablir (B10), résolution de l'héritage de présentation (B9), composition des requêtes de tuiles avec les filtres communs (B7), planificateur d'exécutions borné (B8), calcul des problèmes et mise en page responsive (B10).

### 19.5 — Écrans

Comme 18.5, en trois commits. `feat(plan19-19.5a)` livre la liste, le nouveau dashboard et l'éditeur : palette, canevas, propriétés, tuiles exécutées et panneau bas. `feat(plan19-19.5b)` livre les filtres communs, l'ajout d'analyse, le conflit de révision, l'historique, les aperçus lecteur et responsive, l'épinglage depuis la fiche et l'onglet Consommateurs. `feat(plan19-19.5c)` livre le parcours d'acceptation complet du §4 et les captures (B11). Demande du porteur du 9 novembre : 19.5a et 19.5b apportent chacune, dans leur propre commit, les tests unitaires, les tests de non-régression et les parcours Playwright de leurs écrans. Ces parcours passent avant la relecture, pour que les tests trouvent le plus d'erreurs possible avant elle.

## 4. Acceptation du plan

Un créateur compose un dashboard de deux sections avec trois analyses partagées, un KPI et un texte, ajoute un filtre commun à cibles explicites, l'enregistre puis en crée une révision. Il annule et rétablit chaque étape. Le dashboard s'affiche correctement au bureau, à la tablette et au téléphone. Chaque tuile s'exécute avec les droits de l'éditeur et porte sa provenance. Un refus reste un refus, et une analyse invisible ou disparue est signalée sans être exécutée. Deux mises en page différentes peuvent utiliser les mêmes analyses. Changer la présentation ne change aucun résultat. La suppression d'une analyse utilisée est refusée avec ses consommateurs. Un dashboard partagé ne peut pas référencer une analyse personnelle. Deux sauvegardes concurrentes ne s'écrasent pas. L'historique et le diff sont relus depuis git, et l'index se reconstruit depuis le dépôt. Aucun SQL ni aucune requête n'est écrit dans un dashboard.

Le lot 07 n'est pas déclaré livré : thèmes, modèles de page et composants approuvés restent au plan 20 (lot 07b).

## 5. Risques et hors périmètre

| Risque | Mesure prévue |
|---|---|
| Un dashboard partagé dévoile une analyse personnelle ou son contenu. | Refus `personal_reference` à la sauvegarde ; tuile non résolue sans contenu à la lecture ; tests de fuite. |
| Un filtre commun élargit ce que voit un lecteur. | Ajout en conjonction seulement, jamais de retrait ; restrictions `policy` intactes ; tests de composition. |
| Trop d'exécutions simultanées à l'ouverture. | Borne de 40 composants exécutables, quatre exécutions en cours au plus, annulation au changement de contexte. |
| La personnalisation finit par changer un calcul. | Présentation et requête séparées dans le format ; test d'identité de la requête soumise. |
| Le texte d'auteur devient un vecteur de script. | Structure fermée sans HTML, rendu par éléments React ; tests sentinelles. |
| La généralisation de l'adaptateur casse les analyses. | Suite du plan 18 inchangée et passée avant toute écriture de dashboard. |

Hors périmètre : thèmes, modèles de page et composants approuvés (plan 20), images (stockage binaire), onglets de page, dépendances entre filtres, sélection multiple et repères d'alignement, interactions entre visuels, consultation, partage, signets et exports (lot 08), publication et releases (lot 09), métriques adhoc (SK-11).

## Réalisation

### 19.1 — Dépôt à plusieurs genres et format `board.dashboard/v1`

Développée par Claude Sonnet 5.5, relue par Codex (gpt-6.1-terra) jusqu'à son « OK pour commit ». Le paquet `skifer_board.content` ajoute `common.py` (briques partagées par les deux formats) et `dashboard.py` (format, sérialisation, diff), généralise `repository.py` à deux genres fermés et ajoute `contracts/dashboards/`. Aucune route, migration ni écran ; `reindex` reste limité aux analyses (l'index des dashboards vient en 19.2).

*Dépôt à plusieurs genres (B1).* Un `Kind` porte le nom, le répertoire (`analyses/`, `dashboards/`), le texte du journal de références, les codes de refus (`invalid_analysis` et `analysis_not_found` ; `invalid_dashboard` et `dashboard_not_found`) et les fonctions du format (validation, lecture, écriture canonique, coup d'œil, diff). Les méthodes publiques (`read`, `history`, `entries`, `glance`, `latest`, `diff`, `write`, `delete`, `contents`) prennent `kind=ANALYSIS_KIND` par défaut ; `analyses()` et `dashboards()` enveloppent `contents()`. L'ensemble des genres est fermé à l'exécution : chaque méthode qui reçoit `kind` commence par `_closed`, qui refuse par un test d'identité, avec une `TypeError`, tout objet qui n'est pas `ANALYSIS_KIND` ou `DASHBOARD_KIND` eux-mêmes ; une copie même égale, un genre au répertoire altéré ou un genre forgé sont refusés avant tout accès au dépôt, sur chacune des neuf méthodes. Un commit de dashboard porte le sujet `dashboard <espace>/<id>: save rN` et les mêmes trailers que les analyses ; le message est reconstruit à l'identique avec le nom du genre avant d'être accepté, de sorte que le commit d'un genre n'est jamais une révision de l'autre. Toutes les garanties du plan 18 valent pour chaque genre. Le comportement des analyses est inchangé : la suite du plan 18 passe avec les mêmes attentes ; seuls les paramètres d'identifiant de l'adaptateur s'appellent désormais `content_id` au lieu de `analysis_id` (aucun appelant ne les nomme, donc sans couche de compatibilité, par arbitrage). Les codes des dashboards sont dans `DASHBOARD_CODES`, `CODES` reste celui du plan 18. Tests croisés (`test_genres.py`) : même identifiant dans les deux genres, écriture et suppression limitées à leur genre, aucun genre ne lit le répertoire de l'autre, commit d'un genre jamais révision de l'autre, refus avec le code du genre.

*Format (B2, B3, B7, B9).* `contracts/dashboards/dashboard.v1.json` (draft 2020-12, `additionalProperties: false` sur chaque objet ; les aiguillages `node` et `block` ne la portent pas eux-mêmes, leurs branches par `type` sont fermées) est la source de vérité : `api_version`, `id`, `name`, `description`, `visibility`, `owner`, `defaults`, `filters` et `layout`. L'arbre va des sections (titre facultatif) aux rangées, puis aux colonnes (`span` 1 à 12, somme par rangée au plus 12), qui portent des composants ou un conteneur imbriqué seul, sur trois niveaux de rangées au plus. Composants fermés : `analysis` et `kpi` (référence `{analysis_id, revision}` épinglée et présentation B9), `text` (paragraphes, intertitres de niveau 1 ou 2 et listes de segments simples, emphase ou gras ; ni HTML, ni lien, ni image, ni Markdown libre) et `separator`. Présentation B9 : `chart` parmi `value|bars|line|grouped_bars`, `title`, `legend`, `number_format` parmi `auto|integer|decimal_1|decimal_2|percent|compact`, `threshold {value, label}`, `tooltip` ; ni couleur brute ni option ECharts. Filtres communs B7 : `id`, libellé, `dimension`, opérateur `eq|in|between`, `default` et `allowed` facultatifs, `targets`. L'en-tête du coup d'œil se termine avant `defaults:`. Aucun champ SQL, requête, table, donnée, environnement, thème ni secret n'est accepté, y compris imbriqué.

*Valeurs de filtres.* Comme pour `board.analysis/v1`, le `scalar` du schéma ne borne que le type et la longueur (1 024) ; le contenu des valeurs (caractères admis, entiers sur 64 bits, nombres finis, types homogènes, doublons, et pour `between` des bornes de même type, ordonnées seulement quand elles sont numériques) passe par les règles de la soumission d'exécution côté Python (`invalid_filter`), et `default` doit être inclus dans `allowed` (`default_not_allowed`). La `description` de `scalar` le dit, et un test montre des cas acceptés par le schéma seul et refusés par le module.

*Bornes.* 20 sections, 40 composants exécutables, 64 composants et 32 filtres (plan) ; 24 rangées par section ou conteneur, 12 colonnes par rangée, 16 éléments par colonne, 600 nœuds, 40 cibles par filtre, 100 valeurs par `allowed` ou `default`, 30 blocs par texte, 5 000 caractères de texte par composant, 120 caractères de nom et 2 000 de description (choix de cette tranche), testées à la limite et au-delà.

*Règles inter-champs.* Celles du plan 18 plus `duplicate_id`, `row_overflow`, `too_deep`, `container_not_alone`, `filter_without_target`, `unknown_target`, `target_not_executable` et `default_not_allowed`. Les contrôles qui demandent les analyses ou le catalogue restent à 19.2.

*Diff.* Les nœuds se comparent par identifiant, ajouté, retiré ou modifié, avec le type de nœud. Un déplacement (autre parent, ou autre rang parmi les frères par plus longue suite croissante) est un écart `moved` dont `before` et `after` valent `{parent, index}` ; une insertion ou un retrait ne déplace aucun frère et le sous-arbre déplacé ne produit aucun bruit ; un nœud déplacé et modifié donne deux entrées.

*Vérifications.* 3 fixtures valides, 1 équivalente et 93 invalides ; `pnpm run check:api` : 6 566 tests, couverture 100 % ; trois passes de relecture (genres fermés à l'exécution, renommage `content_id` documenté, portée des valeurs de filtres et fermeture par branches précisées).

### 19.2 — Index, droits, routes et consommateurs

Développée par Claude Sonnet 5.5 et relue par Codex (gpt-6.1-terra) en deux passes. La dernière n'a pas été close par un « OK pour commit » mais par l'arbitrage de l'orchestrateur, sur un point qui relève d'une limite acceptée (voir *Consommateurs*). Le paquet `skifer_board.content` ajoute `dashboard_checks.py` (règles pures de sauvegarde et d'états des tuiles) et `dashboard_web.py` (routes, analyses épinglées, consommateurs). Aucun écran, aucune exécution modifiée.

*Index (B5).* La migration `0016` ajoute deux tables :
- `dashboard_index`, sur le même modèle que l'index des analyses ;
- `dashboard_references`, avec un couple `(analysis_id, analysis_revision)` par composant exécutable de la révision courante (clé sur espace, dashboard et composant ; cascade avec le dashboard ; index sur espace et analyse).

Il n'y a pas de `downgrade`, comme pour les migrations précédentes. `skifer-board-reindex` reconstruit les deux genres dans une seule transaction, avec la tête relue avant le commit, trois tentatives et les codes de sortie du plan 18. Les dashboards abîmés sont listés et donnent le code 1.

*Routes (B6).* Sous `/api/spaces/{space_id}/dashboards` : créer, lister, lire la courante ou une révision numérotée, historique, écart (`GET …/diff?base=&other=`, même forme que les analyses), réviser et supprimer avec `expected_revision`, dupliquer. Les garanties sont celles des analyses :
- droits de A5, administrateur compris ;
- même 404 pour un dashboard invisible et un dashboard inexistant ;
- coup d'œil avant toute lecture ;
- panne de base après publication : la publication git fait foi, et la lecture suivante donne `index_stale` ;
- mode local et non-membres refusés.

Une requête résout la tête du dépôt une seule fois et la transmet à toutes ses lectures, le dashboard source comme les analyses épinglées. Chaque épingle n'est lue qu'une fois, et cette lecture sert aussi à l'état de la réponse. Une publication concurrente n'est jamais vue. Le second contrôle de visibilité du contenu relu est conservé, comme pour les analyses.

*Validation (B4, B7).* `invalid_dashboard` porte un chemin et une règle prise dans une liste fermée :
- `analysis_unavailable`, une seule règle pour une analyse invisible, supprimée ou inexistante ;
- `kpi_requires_value` ;
- `chart_incompatible` ;
- `dimension_not_exposed` ;
- `operator_not_allowed` ;
- `filter_value_incompatible` ;
- `filter_type_mismatch` ;
- `too_many_filters`, au-delà de 32 filtres par tuile.

Un dashboard partagé qui référence une révision non partagée est refusé par `personal_reference`, un code à part (422, `components`). La visibilité d'une révision épinglée se juge sur son en-tête, à son commit, avant son corps : une révision privée d'une autre personne n'est ni chargée ni validée. Sans catalogue lisible, la réponse est 503 `engine_unavailable`.

*Règle des graphiques (arbitrage).* Une règle statique unique, plus stricte que l'Explorateur. Celui-ci (`Resultat.tsx`) permet `value` sur un résultat d'au plus une ligne, ce qu'un dashboard ne peut pas garantir. La règle :
- un KPI exige une révision dont le graphique est `value` et dont la requête n'a aucune dimension ;
- une surcharge `value` d'un visuel exige aussi une requête sans dimension ;
- `bars`, `line` et `grouped_bars` conviennent à toute forme ;
- un visuel sans surcharge garde la présentation de l'analyse.

*Lecture et états.* Chaque composant exécutable a l'un de ces états :
- `ready` ;
- `unavailable`, avec une raison fermée : `analysis_unavailable`, `unresolved_reference` ou `filter_incompatible` ;
- `unverified`, quand le catalogue ou la base ne permettent rien d'affirmer. Ce troisième état est un écart au plan, jugé justifié en relecture.

La cohérence de type d'un filtre commun entre ses cibles se juge à la lecture comme à la sauvegarde, par la même fonction. L'état global suit la priorité `index_stale`, `unverified`, `unresolved_reference`, `ready`. La réponse ne recopie jamais une requête d'analyse.

*Consommateurs (B5).* `analysis_in_use` et `GET …/analyses/{id}/consumers` rendent `consumers` (dashboards visibles du demandeur) et `others` (un décompte, sans identité). Git fait foi :
- l'index des références n'est cru que pour une ligne qui porte le dernier commit de son fichier, à la tête de la requête ;
- un dashboard absent de l'index ou en retard est relu depuis git ;
- un dashboard supprimé est ignoré ;
- un dashboard abîmé est compté parmi les autres. Il bloque donc la suppression des analyses de l'espace tant qu'il n'est pas réparé ;
- si l'index ou le dépôt ne répond pas, la suppression est refusée (`content_unavailable`).

La suppression exige aussi, sous le verrou, la tête sur laquelle les consommateurs ont été jugés (`expected_head`). Si la tête a bougé, la route juge une seconde fois, puis répond `revision_conflict` / `stale`.

Limites acceptées :
- L'écriture d'un dashboard n'a pas ce contrôle de tête. Une analyse supprimée pendant la sauvegarde d'un dashboard qui l'épingle laisse une tuile `analysis_unavailable`, jamais de données.
- Pour compter les autres, un dashboard absent de l'index ou en retard est relu avant que sa visibilité pour le demandeur soit connue, puisque ses références sont nécessaires au décompte dans tous les cas. Il n'en sort qu'un nombre, et le temps de réponse dépend de la taille de ces documents, dans la limite de 1 Mio acceptée au plan 18. C'est le point de la dernière relecture, clos par arbitrage.

*Télémétrie et contrats.* Codes `invalid_dashboard`, `dashboard_not_found` et `personal_reference`, sans nom, valeur de filtre ni personne. Les exemples sont produits par le serveur réel sous `contracts/dashboards/routes/` (27) et `contracts/analyses/routes/consommateurs*.json`. Le décodeur web des refus accepte `others`.

*Vérifications.*
- `pnpm run check:api` : 7 167 tests, couverture 100 % (7 782 lignes, 2 012 branches), sur une passe postérieure à la dernière modification de code.
- `check:web` : 3 291 tests, couverture 100 %.
- `check:docs` et `git diff --check` au vert.

### 19.3 — Contrat web

Développée par Claude Sonnet 5.5, relue par Codex (gpt-6.1-terra) jusqu'à son « OK pour commit », en deux passes. La tranche ajoute des décodeurs stricts et des clients typés, sans écran, sur le modèle de 18.4, dans `apps/web/src/dashboards/` (`document.ts`, `model.ts`, `refusal.ts`, `client.ts`). Ni le serveur ni les contrats ne changent.

*Document.* `decodeDashboard` et `decodeDashboardDraft` suivent `dashboard.v1.json` sans rien compléter ; tout champ inconnu est refusé. Ils jugent les règles inter-champs que le serveur applique sans catalogue :
- unicité des identifiants ;
- somme des largeurs au plus 12 ;
- profondeur et conteneur seul ;
- cibles des filtres, y compris un filtre sans cible ;
- valeurs comme à la soumission d'exécution, et `default` inclus dans `allowed` ;
- bornes, avec le texte compté en points de code.

Les règles qui demandent les analyses ou le catalogue restent au serveur. Elles sont listées, avec leur raison, dans un test, de même que quatre fixtures que `JSON.parse` ne peut pas juger (`2.0` lu comme `2`).

*Réponses.* La révision porte une tuile par composant exécutable, dans l'ordre du document. Chaque tuile vaut `ready`, `unavailable` avec une raison fermée, ou `unverified`. L'état global doit être cohérent avec les tuiles et suivre l'ordre de priorité. Liste, historique masqué et suppression sont décodés eux aussi.

L'écart est jugé nœud par nœud :
- `before` et `after` sont contrôlés champ par champ selon le genre du nœud et la nature du changement ;
- un ajout ou un retrait doit respecter le schéma complet ;
- une modification n'admet que des champs qui diffèrent, jamais `type` ;
- l'en-tête et les défauts sont jugés feuille par feuille ;
- `moved` admet le même parent et le même rang, car le serveur marque aussi déplacé un frère sorti de la plus longue suite croissante.

Une sortie réelle de `dashboard.diff` (`ecart-reel.json`, 34 changements sur 11 genres de nœuds, régénérée à l'identique en relecture) est décodée sans perte. Limite : deux nombres égaux de part et d'autre (`1` et `1.0`) restent indiscernables. Les entiers non sûrs donnent `unsafe_integer`, jamais un arrondi.

*Refus.* L'union est fermée et chaque code a sa forme exacte :

| Code | Forme |
|---|---|
| `dashboard_not_found` | — |
| `invalid_dashboard` | violations triées |
| `personal_reference` | 1 à 40 composants |
| `revision_conflict` | seulement `stale` ; `head_changed` n'est jamais rendu par les routes |
| `content_unavailable` | — |
| `forbidden` | `{code, required}` |
| `invalid_parameter` | `{code, parameter, detail}` |
| `invalid_request` | `{code, field}` |
| `local_mode`, `space_not_found`, `engine_unavailable` | `{code}` |

Ces formes s'appliquent aux clients des analyses et des dashboards. Les clients des espaces, des exécutions et de l'Explorateur gardent la lecture tolérante que décrivent leurs tests.

*Clients.* Création, liste, lecture, historique, écart, révision avec `expected_revision`, duplication et suppression. Avant tout appel, les clients vérifient l'espace (`SPACE_ID` : un `..` ne produit aucun appel), l'identifiant, les numéros et le document. Le statut de succès est contrôlé route par route. Côté analyses, la tranche ajoute `decodeConsumers` et `fetchConsumers`, et le même contrôle d'espace sur tous les clients d'analyses.

*Tests.* Les 27 exemples des routes de dashboards et les `consommateurs*.json` sont tous utilisés. Les fixtures `valid`, `invalid` et `equivalent` sont lues au verdict du serveur. Chaque forme de refus a son cas forgé, et les espaces invalides sont testés avec un faux `fetch` jamais appelé. `analyses/contrats.test.ts` couvre enfin les `consommateurs*.json` de 19.2, qu'un cache Vitest périmé masquait.

*Dette relevée, hors périmètre.* Les clients des espaces, des exécutions et de l'Explorateur ne vérifient pas l'identifiant d'espace avant l'appel. C'est à reprendre dans un plan de durcissement.

*Vérifications.* `pnpm run check:web` : 134 fichiers, 3 399 tests, couverture 100 %, build, relancé sans cache par l'orchestrateur. `check:docs` et `git diff --check` sont au vert.

### 19.4 — Modèle d'édition

Développée par Codex (gpt-6.1-terra) et relue par Claude Sonnet 5.5, en trois passes, jusqu'à son « OK pour commit ». Le module pur `apps/web/src/dashboards/edition/` n'a pas d'écran. Il comprend `commands.ts`, `execution.ts`, `scheduler.ts`, `problems.ts` et `responsive.ts`, chacun avec ses tests.

*Commandes et historique (B10).*
- Une commande modifie une copie. Le résultat est rejugé par `decodeDashboard` ou `decodeDashboardDraft`, sans règle réécrite. Un refus a une raison fermée (`not_found`, `incompatible_parent`, `invalid_index`, `invalid_property`, `invalid_document`) et rend le document d'origine.
- Les commandes couvrent :
  - la mise en page : ajouter, déplacer, redimensionner, supprimer ;
  - les propriétés ;
  - les filtres communs et leurs cibles : `add_filter`, `update_filter` avec `remove`, `delete_filter`. L'identifiant d'un filtre n'est jamais remplacé ;
  - l'adoption d'une révision d'analyse (`adopt_revision`, B5) ;
  - les blocs d'un texte (`update_blocks`).
- `add` impose le genre et l'identifiant généré par un générateur injectable. Le déplacement dans son propre sous-arbre est refusé.
- Imbriquer passe par un `batch`. Ses commandes s'appliquent dans l'ordre sur la même copie, tout ou rien, avec une seule entrée d'historique. Seule la validation finale décide. Un refus porte l'index de la commande, et un `batch` imbriqué est refusé. Les identifiants produits dans l'ordre par le générateur peuvent être connus d'avance et réutilisés par les commandes suivantes.
- Supprimer un nœud retire ses cibles des filtres et les filtres devenus sans cible. Le résultat les détaille (`removed`), pour que l'écran puisse le dire et que l'annulation les rende.
- L'historique garde 100 états. Une commande refusée ou sans effet n'y entre pas, et `isDirty` compare à l'état enregistré.

*Présentation (B9).*
- `resolveVisual` et `resolveKpi` résolvent chaque champ avec son origine : `theme`, `analysis`, `dashboard` ou `component`.
- Sans surcharge, `chart` et `title` viennent de l'analyse.
- Le seuil est facultatif et ne vient que du thème ou du composant, car les défauts du document n'en portent pas.
- On retire une surcharge en ôtant sa clé.
- `compatibleCharts` recopie `chart_compatible` du serveur : seul `value` est contraint, et il exige une requête sans dimension.

*Composition et planification (B7, B8).*
- `composeExecution` garde les filtres de l'analyse et ajoute les filtres communs ciblés. Leur valeur est la valeur de travail, sinon le défaut ; `null` efface le filtre.
- La valeur de travail est jugée par les règles du document : bornes ordonnées et appartenance à `allowed`.
- Les recouvrements sont signalés et la borne de 32 est tenue. La référence `{id, revision}` est jointe.
- La présentation n'entre jamais dans la soumission.
- Le planificateur soumet les tuiles dans l'ordre du document, quatre au plus en même temps. Ses clients et son attente sont injectés.
  - Il annule tout au changement de contexte et ignore les réponses tardives. Il ne soumet rien si l'annulation arrive pendant la publication, ni n'annule une exécution déjà terminée.
  - Il rend `DENY` et `REQUIRE_HUMAN` tels quels, sans nouvel essai ni cache. Il ne soumet jamais une tuile indisponible.
  - Il garde l'`Execution` d'une erreur, pour son identifiant de trace (§0.2).
  - Le nombre de tuiles est exposé sans émission, faute de point d'entrée de télémétrie web.

*Problèmes (B10).*
- Les codes sont fermés : `analysis_unavailable`, `unresolved_reference`, `unverified`, `filter_without_target`, `filter_incompatible`, `chart_incompatible`, `kpi_incompatible`, `limit_reached` et `revision_behind`. Chacun porte une gravité, un nœud et un chemin.
- Les bornes reprennent celles du serveur : avertissement à la borne, blocage au-delà. Une colonne pleine largeur n'est pas une borne.
- `unresolved_reference` est un avertissement : le serveur accepte la sauvegarde et rend la tuile indisponible à la lecture.
- La compatibilité des filtres est jugée comme `_filter_checks` : `validateExecutionFilters`, extrait de `buildExecution`, valide les filtres sans les métriques ni les dimensions de l'analyse. La première cible compatible fixe le type.

*Disposition (B10).*
- `SHELL_WIDTH` (760 px) est exporté. Un test le relie aux media queries de `shell.css` et d'`identity.css`, ce seuil n'étant pas dans les tokens.
- Les comparaisons sont inclusives, comme `max-width`. Sous le seuil, les colonnes s'empilent dans l'ordre du document, conteneurs compris.
- La forme étroite des graphiques (480 px) se juge sur la largeur effective de chaque colonne. Les aperçus font 1 280, 768 et 390 px.

*Réutilisation.* `document.ts` exporte `filterValues` et `decodeCommonValues`. L'ordre des contrôles reste celui du serveur : forme de `default` et `allowed`, puis cibles, puis contenu. Un test couvre le cas combiné.

*Dette relevée.* Le serveur trie ses violations par chemin, puis par règle. Pour un filtre à la fois sans cible et au contenu invalide, sa première raison porte donc sur `default`, alors que le décodeur web rend d'abord « cibles vides ». Cet ordre date de 19.3 et n'est pas testé. Les deux refusent le document ; seule la première raison diffère.

*Vérifications.*
- `pnpm run check:web` : 139 fichiers, 3 510 tests, couverture 100 %, build. Gate relancée sans cache par l'orchestrateur.
- `check:docs` et `git diff --check` sont au vert.
- Le relecteur a prouvé la force des tests par 46 mutations sur trois passes. Une seule survit : celle de la dette ci-dessus.

### 19.5a — Liste, création et éditeur

Le développement a commencé chez Claude Sonnet 5.5. Codex (gpt-6.1-terra) l'a relu deux fois, puis l'a terminé comme développeur après une interruption de Sonnet par une limite d'usage. Un Sonnet neuf a fait la relecture finale. À partir du 11 novembre, à la demande du porteur, Codex fait tous les développements et Sonnet relit.

*Écrans (B11).*
- **Liste.** La liste des dashboards de l'espace sépare « Mes dashboards » et « Partagés », avec les états du §0.2 et les refus fermés.
- **Création.** Le dialogue « Nouveau dashboard » (`ui/Dialog.tsx`, focus piégé et rendu) crée le document puis ouvre l'éditeur, sur `#/espaces/<espace>/dashboards/<id>`. Une création annulée en cours n'ouvre pas l'éditeur ; si le serveur l'a déjà créée, elle apparaît au prochain rafraîchissement de la liste.
- **Barre d'outils.** Elle enregistre avec la révision attendue et offre annuler et rétablir par l'historique 19.4. Elle signale les modifications non enregistrées. Un conflit 409 est rendu comme un refus explicite, sans écrasement, et son traitement complet vient en 19.5b.
- **Palette et canevas.** La palette ajoute section, rangée, colonne, conteneur, texte et séparateur. Le canevas sélectionne, déplace et redimensionne, au pointeur et au clavier. Les raccourcis sont documentés et annoncés en `aria-live`. Un refus est rendu avec sa raison fermée, et toute modification passe par les commandes 19.4.
- **Propriétés.** Le panneau couvre le titre de section, la largeur de colonne, les blocs de texte et les propriétés du dashboard. Il couvre aussi la présentation B9, avec l'origine de chaque champ et le retrait d'une surcharge ; les types de graphique sont limités à `compatibleCharts`.
- **Panneau bas.**
  - Problèmes : chacun mène au nœud, et un problème bloquant empêche l'enregistrement.
  - Structure : un arbre ARIA, avec `treeitem` et `group`.
  - Filtres : en lecture seule.

*Garde de sortie (B10).* `shell/useExitGuard.ts` et `guardNavigation` dans `shell/route.ts` couvrent :
- la navigation interne, les liens, `beforeunload`, le bouton Précédent et l'adresse saisie à la main, avec écoute de `popstate` en capture ;
- les saisies encore actives, qui comptent comme modifications.

Un clic modifié (Ctrl, Cmd, Maj, bouton du milieu) n'est pas intercepté. *Dette :* un Précédent refusé remplace l'entrée précédente de l'historique du navigateur par l'adresse de l'éditeur.

*Tuiles (B8).* `edition/useTiles.ts` branche le planificateur 19.4 sur les clients d'exécution existants.
- **Contexte.** Lectures d'analyses, exécutions et décisions sont liées au contexte : espace, identité stable (`identityKey`, émetteur et sujet), environnement et dashboard. Un changement de contexte abandonne tout, efface et relit, et une réponse tardive est ignorée.
- **Décisions.** Les requêtes composées identiques partagent une soumission et une décision.
  - DENY et REQUIRE_HUMAN sont gardés, rendus tels quels et jamais resoumis, même après un retrait puis un rétablissement de la tuile. Un succès ne remplace jamais un refus.
  - Les succès et résultats vides sont gardés par signature et par contexte. Les erreurs ne le sont pas.
- **Plan.** Un changement de plan garde en vol les travaux inchangés et n'annule que les tuiles retirées ou dont la requête change.
- **Disponibilité.** Une tuile n'est disponible qu'après la vérification complète des filtres qui la ciblent, par la règle unique `incompatibleTargets` que `dashboardProblems` partage. Une tuile ciblée par un filtre incompatible est indisponible avec la raison `filter_incompatible`. Un composant absent de la dernière réponse serveur, restauré ou nouveau, est jugé sur la lecture de son analyse épinglée.
- **Actions et affichage.**
  - Une tuile en cours peut être annulée seule. Une exécution partagée continue tant qu'une autre tuile la demande, et elle n'est annulée côté serveur que lorsque plus aucune tuile ne la demande.
  - Une tuile annulée, localement ou par le serveur, propose « Relancer ». Une annulation n'est pas une décision : la relance soumet de nouveau la requête, une fois par clic.
  - Une lecture ou une exécution en erreur peut être réessayée par une action explicite, jamais un refus.
  - Les tuiles rendent les états du §0.2, le résultat partiel (`explorer/ResultatPartiel.tsx`, libellé adapté) et l'identifiant d'exécution d'une erreur.
  - Le pied de provenance et le bandeau de refus sont ceux de l'Explorateur, partagés.

*Coque.* Un changement d'identité renouvelle la coque et ses pages : espaces, espace courant, Explorateur, analyses et dashboards. L'entrée Dashboards de la navigation est livrée dans un espace, et les specs `parcours` et `catalogue` sont ajustées en conséquence.

*Tests.*
- Vitest, Testing Library et Axe dans les deux thèmes.
- `e2e/dashboards.spec.ts`, avec un serveur simulé `e2e/serveur-dashboards.ts` construit sur les exemples réels de `contracts/dashboards/routes/`. Ce serveur consigne tout appel imprévu, ce qui fait échouer le test.
- Les parcours couvrent, sur ordinateur et téléphone :
  - la création et la composition au clavier, l'enregistrement et la réouverture ;
  - les états et refus de tuiles, et la borne de quatre exécutions observée côté serveur ;
  - le blocage par un problème, et la garde de sortie (Précédent, adresse saisie, saisie active) ;
  - le refus partagé, le filtre incompatible et le retrait pendant une exécution ;
  - l'annulation d'une tuile, le réessai, la création annulée et les clics modifiés ;
  - l'absence de débordement à 390, 768 et 1 280 px.

*Vérifications.*
- `pnpm run check:web` : 160 fichiers, 3 777 tests, couverture 100 %, build. Gate relancée sans cache par l'orchestrateur.
- `pnpm run check:e2e` complet : 705 tests passés et 1 ignoré, lancé seul par l'orchestrateur.
- `check:docs` et `git diff --check` sont au vert.
- La relecture finale a prouvé la force des tests par environ 85 mutations, sur quatre passes, jusqu'à son « OK pour commit ». Les mutations survivantes sont des gardes redondantes, sans effet observable.

*Dette relevée.* Le test `App.espace.test` « changer d'analyse relit la fiche », étranger à la tranche, a échoué une fois sous charge, puis passé à chaque nouvel essai. Il est à surveiller comme test intermittent.
