# Plan 14 — Points d'accès Databricks saisis dans Board (lot 03, recette)

Date : 4 novembre 2026 · Statut : **planifié**. Décision du porteur : tester Board avec son instance Azure Databricks et saisir lui-même les informations de connexion dans Board. Ce plan précède tout code correspondant.

Sources : [plan de développement](../plan-de-developpement.md), lot 03 ; [plan 12](12_connexions_et_executions_plan.md), X1 à X9 ; [recette Databricks](../recettes/plan12-databricks.md).

## Décisions

1. L'administrateur d'un espace peut enregistrer dans Board un point d'accès Databricks nommé : hôte HTTPS de workspace Azure Databricks et identifiant de SQL warehouse. L'enregistrement est propre à l'espace et conservé en PostgreSQL. Le jeton reste dans le coffre distinct, saisi à usage unique dans l'écran de liaison existant. Aucun jeton ni SQL n'entre dans la configuration du point d'accès.
2. La validation serveur réutilise la liste stricte des domaines Databricks, refuse chemins, paramètres, fragments, identifiants dans l'URL et ports libres. Les appels sortants gardent TLS vérifié, sans proxy ni redirection. Le navigateur ne donne jamais une URL à la route d'essai ou d'exécution : il choisit une clé enregistrée. Les points d'accès historiques déclarés par `SKIFER_BOARD_CONNECTION_ENDPOINTS` restent utilisables.
3. La suppression ou la modification d'un point utilisé par une liaison ou une exécution non terminale est refusée. Une modification effective invalide les identifiants liés, pour qu'un jeton ne soit pas envoyé à un autre workspace. Les exécutions déjà démarrées conservent leur point d'accès figé.
4. Le mode local sans OIDC ne devient pas une voie d'exécution Databricks. La recette intégrée exige encore PostgreSQL, OIDC, deux lecteurs, un modèle sémantique certifié et sa politique de ligne. Les réglages d'identité et de coffre de l'exploitant restent hors des réponses HTTP.
5. La recette 12.8b passe par l'écran et le connecteur de Board. Aucun profil du CLI Databricks n'est requis. La personne saisit ses données elle-même ; les constats committés restent expurgés.

## Tranches

### 14.1 — Registre et résolution côté API

Migration `0010` du registre de points d'accès par espace ; création, liste et retrait réservés aux administrateurs ; résolution par espace et clé à l'essai et à la soumission. Tests de validation, isolation, concurrence, refus en usage et absence de jeton dans réponses, événements et télémétrie. Changelog et gate complet avant commit.

### 14.2 — Écran Connexions

Formulaire « Point d'accès Databricks » avec nom, hôte et ID du warehouse, liste et retrait. La liaison existante choisit une clé enregistrée ; l'identifiant est toujours saisi dans le coffre puis l'essai est lancé depuis Board. États de chargement, refus, panne et succès ; tests de décodeurs, composants et parcours. Changelog et gate complet avant commit.

### 14.3 — Démarrage et recette

Mettre la recette 12.8b à jour pour le parcours Board seul. Fournir les étapes concrètes de démarrage sans inscrire de secret dans le dépôt. Lancer l'application lorsque l'environnement OIDC et le coffre sont configurés ; la personne saisit ses valeurs dans Board. La clôture du lot 03 attend toujours les observations sur deux lecteurs réels et le constat expurgé.
