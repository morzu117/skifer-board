# Plan 17 — Explorateur sur modèles sémantiques déclarés (lot 05a)

Date : 4 novembre 2026 · Statut : 17.1 et 17.2 réalisées ; 17.3 et 17.4 à faire. Premier plan du lot 05, ouvert alors que la recette Databricks réelle du lot 03 (12.8b) attend le porteur. Le développement de chaque tranche est confié à un agent distinct de l'orchestrateur, puis relu par un second agent avant commit.

Sources : [plan de développement](../plan-de-developpement.md), §4.5–4.6, §8 lot 05 et §10.2 (D-1, D-6) ; [écrans](../ecrans-et-fonctionnalites.md), §0.2–0.4 et §3 ; [maquette d'exploration](../design/mockups/01-exploration.html) ; plans [01](01_socle_et_calculs_contextuels_plan.md), [02](02_socle_web_et_prototype_graphique_plan.md), [12](12_connexions_et_executions_plan.md) et [16](16_executions_oauth_personnelles_plan.md).

## 1. Point de départ

- La soumission `POST /api/spaces/{space_id}/executions` reçoit connexion, environnement, modèle, métriques, dimensions et filtres `eq/ne/gt/gte/lt/lte` sur valeur scalaire. Le formulaire du centre d'exécutions exige de connaître les noms ; Board n'expose pas encore les champs disponibles.
- Le catalogue sémantique skifer est déclaré côté serveur (`SKIFER_BOARD_SEMANTIC_MODELS_DIR`) et lu uniquement par `execution/semantic.py`. skifer 4.1 sait lister les modèles de son catalogue et accepte aussi `in`, `like`, `is_null`, `is_not_null`.
- Le module `contextual` (plan 01) calcule agrégats, sous-totaux et parts sur un résultat Arrow muni d'un `ResultContract`, ou rend une indisponibilité motivée. Il n'est relié à aucune route.
- La correspondance KPI Atlas → modèle skifer (AT-02) n'existe pas : aucun KPI du catalogue n'est exécutable. L'explorateur part donc d'un **modèle sémantique déclaré**, pas d'un KPI Atlas ; il ne pose aucune correspondance lui-même.

## 2. Décisions

| # | Décision | Conséquence vérifiable |
|---|---|---|
| E1 | **Champs issus du seul moteur.** Board présente modèles, métriques et dimensions tels que le catalogue skifer déclaré les décrit, par l'adaptateur unique. Aucune expression SQL, table, chemin ou politique de ligne n'est rendu. | Réponse fermée : noms, libellés, descriptions, type logique, agrégation et additivité. Tests avec valeurs sentinelles sur `sql`, tables et `row_policy`. |
| E2 | **Mêmes gardes que la soumission.** Lire les champs et explorer demandent le même droit que soumettre une exécution (lecteur, créateur, administrateur avec rôle de lecture). Ni sauvegarde ni partage dans ce plan : ils relèvent du lot 06. | Non-membre, autre espace, rôle retiré et mode local refusés comme pour `executions`. |
| E3 | **Validation serveur contre les champs.** Une soumission dont modèle, métrique, dimension ou colonne de filtre n'existe pas dans le catalogue déclaré, ou dont l'opérateur ne convient pas au type logique, est refusée avant le connecteur avec un code fermé. Une combinaison que skifer refuse à la compilation reste un refus fermé, jamais une approximation. | Aucun appel au connecteur sur refus ; codes et exemples de contrat. |
| E4 | **Filtres typés étendus, toujours déclaratifs.** Ajout de la liste (`in`, au plus 100 valeurs scalaires de même type) et de la plage (deux bornes `gte`/`lte` sur la même colonne). Pas de `like` libre ni de texte interpolé. Les filtres d'exploration ne retirent jamais une restriction `policy`. | Empreinte de demande canonique ; tests de retrait d'un filtre à deux lecteurs. |
| E5 | **Contrat de résultat sur chaque réussite.** Le détail d'une exécution réussie porte grain (dimensions), règle de chaque métrique déduite de son agrégation skifer (`sum` additive ; `avg`, `count_distinct`, ratios non réagrégeables tant que SK-11 manque) et complétude (`complete` ou `truncated`). Une agrégation inconnue est non réagrégeable. | Pas de règle inventée ; tests par type d'agrégation. |
| E6 | **Total de sélection côté serveur (D-6).** Une route calcule, sur le résultat Arrow stocké de l'auteur, total, sous-totaux par dimension et part de total, avec le module `contextual` (calcul Arrow, jamais SQL). Elle rend la valeur, le périmètre (`selection`, `loaded_result`) et la règle, ou l'indisponibilité avec sa raison. Sur un résultat tronqué, le total est étiqueté « sur le résultat chargé ». | Réservé à l'auteur d'une réussite ; refus, troncature et règle non additive testés ; latence mesurée par la télémétrie existante. |
| E7 | **Écran Explorateur dans la coque.** Entrée « Explorer » pour les rôles de E2 ; panneau des champs, zone de requête, exécution et annulation via les routes existantes, résultat en tableau et graphique (ECharts, ADR 0001), pied de provenance et tiroir Preuves. Tous les états du §0.2 des écrans sont rendus. Perspective reste à évaluer sur volumes réels, hors de ce plan. | Tests de composants, accessibilité, parcours navigateur et captures ordinateur/téléphone. |

## 3. Tranches et commits

Chaque tranche a ses tests, une entrée dans `CHANGELOG.md` sous `Unreleased` et un commit `feat(plan17-17.x)`. Les tests sont hors réseau, sans clé ni cluster, sur DuckDB et transport Databricks simulé.

### 17.1 — Champs exécutables

Ajouter à l'adaptateur `execution/semantic.py` la lecture fermée du catalogue déclaré et une route `GET /api/spaces/{space_id}/explorer/fields` sous les gardes de E2. La réponse liste les modèles avec leurs métriques et dimensions (E1). Un catalogue absent ou invalide répond `engine_unavailable`. Contrats d'exemple produits par le serveur réel, tests de confidentialité, de permissions et de mode local.

### 17.2 — Validation et filtres typés

Valider la soumission contre les champs de 17.1 (E3) et étendre les filtres (E4). Les codes de refus nouveaux sont fermés, documentés dans `contracts/` et connus de la télémétrie. Tests de chaque opérateur par type logique, bornes, doublons, empreinte, refus avant connecteur et non-retrait de la RLS à deux lecteurs.

### 17.3 — Contrat de résultat et calculs contextuels

Joindre le contrat de résultat au détail des réussites (E5) et ouvrir la route de calcul contextuel (E6) sur le résultat stocké. Tests : somme additive, moyenne et compte distinct refusés avec raison, sous-totaux, part de total, sélection vide ou hors grain, résultat tronqué, accès d'un autre lecteur ou d'un administrateur refusé, aucun calcul sur un refus.

### 17.4 — Écran Explorateur

Route d'espace et entrée de navigation ; décodeurs stricts des champs, du contrat et des calculs ; panneau des champs avec recherche, zone de requête avec filtres typés, exécution et annulation, résultat tableau/graphique, sélection avec total serveur, pied de provenance et tiroir Preuves. États chargement, vide, refus, erreur, tronqué, contexte changé et mode local. Tests web à 100 % de couverture, accessibilité sous les deux thèmes, parcours Playwright et captures ordinateur/téléphone sans débordement à 390, 768 et 1280 px.

## 4. Acceptation du plan

Un lecteur choisit un modèle déclaré, compose métriques, dimensions et filtres sans écrire de SQL, exécute, annule, lit le résultat en tableau et en graphique avec sa provenance, et obtient un total de sélection exact ou une indisponibilité motivée. Deux lecteurs ne voient que leurs lignes ; retirer un filtre ne change pas ce droit. Le lot 05 n'est pas déclaré livré : la source réelle (12.8b), la comparaison à une requête de référence sur source réelle, les périodes de calendrier et la réouverture des filtres temporels ([SK-12](../attendus/skifer.md#sk-12--littéraux-de-filtres-textuels-et-temporels)), le tri et top-N (SK-03) et le retour au moteur pour un total complet restent à planifier.

## 5. Risques et hors périmètre

| Risque | Mesure prévue |
|---|---|
| La description des champs expose une expression ou une politique. | Sérialisation par liste blanche, tests sentinelles. |
| Un calcul local est présenté comme un total complet. | Périmètre et complétude obligatoires dans la réponse et l'affichage. |
| Le navigateur devient un éditeur de requête libre. | Noms validés contre le catalogue, opérateurs fermés, aucun texte SQL accepté. |

Hors périmètre : sauvegarde d'analyse, épinglage, export, correspondance Atlas (AT-02), cache partagé.

## Réalisation

**17.1 — Champs exécutables.** L'adaptateur utilise `list_models` et le chargeur de modèles de skifer : le résumé public ne contient pas les définitions détaillées, mais le planner s'en sert pour résoudre les noms, qui doivent donc concorder. La réponse est construite par liste blanche et triée ; elle refuse un catalogue sans politique de ligne, incohérent ou dépassant 100 modèles, 500 champs par catégorie et modèle, ou 1 024 caractères par texte. Les chemins hors du répertoire sont refusés. Les types skifer `integer` et `float` deviennent `number`, `datetime` devient `timestamp` ; un type inconnu devient `unknown`. Une agrégation inconnue est rendue `null` et non additive ; les sommes et comptes respectent leur additivité déclarée, les autres agrégations sont traitées comme non additives.

La route utilise exactement la garde de soumission et ne contacte aucune source. Les contrats et les tests exercent les rôles, leur retrait, le mode local, les refus du catalogue, les sentinelles et un connecteur interdit. Deux modèles sont exécutés sur DuckDB en utilisant, pour chacun, le nom du modèle, la métrique `m_sum` et la dimension `d_string` tels que rendus. Les 37 tests de la tranche passent ; le gate API passe avec 4 951 tests, 5 104 lignes et 1 180 branches couvertes à 100 %. Les régressions délibérées sur la fuite de SQL, la politique de ligne et la borne de texte, puis sur chacune des bornes de modèles, de définitions et de résumé, ont été détectées et restaurées. Les bornes de modèles du catalogue et du moteur sont aussi retirées séparément : leurs tests isolent chaque refus avec un moteur simulé et des entrées valides.

Un seul champ invalide (texte nul ou trop long, clé de modèle contenant un point ou commençant par `_`) rend délibérément tout le catalogue indisponible : ce refus fermé est cohérent avec la soumission. La lecture détaillée dépend de la méthode interne skifer `_get_model` ; une mise à jour de skifer doit vérifier cette dépendance.

Développée avec ses tests par un agent Codex (gpt-6.1-terra), relue par un agent Claude Sonnet 5.5 distinct ; deux cycles de corrections avant commit.

**17.2 — Validation et filtres typés.** Le serveur valide modèle, métriques, dimensions et filtres contre le catalogue avant la création d'une exécution et le connecteur. Les refus réutilisent `invalid_request` (400) avec le champ générique `model`, `metrics`, `dimensions` ou `filters` ; le catalogue indisponible reste `engine_unavailable` (503). Les noms et valeurs refusés ne sont pas rendus.

La matrice des opérateurs est : `string` : `eq`, `ne`, `in` ; `number` : `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `between` ; `date` et `timestamp` : aucun filtre tant que [SK-12](../attendus/skifer.md#sk-12--littéraux-de-filtres-textuels-et-temporels) n'est pas résolu ; `boolean` et `unknown` : `eq`, `ne`. Les valeurs texte acceptent uniquement lettres et chiffres Unicode (catégories L et N), espaces ASCII et ponctuations `_ . , : / @ & + ( )` ; les espaces en début ou fin et la chaîne vide sont admis. Les marques combinantes (catégorie M), notamment `e` suivi de U+0301 en NFD et certaines écritures devanagari ou hébreu pointé, sont refusées, comme les mots avec tiret tels que `Île-de-France` ; Board ne normalise pas les entrées. Toute autre valeur texte hors liste est refusée avant création, comme les entiers hors de [-2^63, 2^63-1] et les flottants non finis. Un booléen n'est pas un nombre. `in` exige 1 à 100 scalaires distincts de même type, triés avant empreinte et transmission : les entiers et flottants ne se mélangent pas dans une liste. `between` exige deux bornes numériques ordonnées et devient deux filtres `gte` et `lte`. Les bornes de taille des filtres restent appliquées.

La validation relit tout le catalogue à chaque soumission : un champ invalide dans un autre modèle rend lui aussi toutes les soumissions indisponibles (`503 engine_unavailable`), conformément au refus fermé de 17.1 ; auparavant, un autre modèle pouvait s'exécuter.

Le test DuckDB a confirmé que `ne` échouait avec `engine_unavailable` ; l'adaptateur le traduit en `neq` pour skifer. Les tests vérifient la matrice, les refus avant connecteur, l'empreinte et la RLS à deux lecteurs avec ou sans filtres, ainsi que la transmission Databricks simulée. Les trois mutations de validation des dimensions, de type numérique et de tri des listes ont été détectées puis restaurées. Les tests vérifient également les filtres sur la colonne de politique à deux lecteurs et la restriction actuelle de skifer. Les mutations des gardes de caractères et de types temporels ont été détectées puis restaurées. Les régressions sur la réadmission de l'antislash et des catégories Unicode S et M sont détectées et restaurées. Les 116 tests de filtres typés passent ; le gate API passe avec 5 068 tests et 100 % de couverture des 5 163 lignes et 1 218 branches.

Développée avec ses tests par Codex (gpt-6.1-terra), relue par Claude Sonnet 5.5 ; trois cycles de corrections, dont le blocage des filtres temporels par skifer (SK-12) et la liste blanche des valeurs texte.
