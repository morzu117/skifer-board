# Plan 14 — Points d'accès Databricks saisis dans Board (lot 03, recette)

Date : 4 novembre 2026 · Statut : **14.1, 14.2 et 14.4 réalisés ; 14.3 documenté, recette réelle encore à faire**. Décision du porteur : tester Board avec son instance Azure Databricks et saisir lui-même les informations de connexion dans Board. Ce plan a été commité avant le code correspondant.

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

Réalisation : la révision `0010` ajoute le registre par espace. Les routes `GET/POST /api/spaces/{space_id}/connection-endpoints` et `DELETE …/{key}` sont gardées côté serveur. Le magasin refuse les doublons et le retrait d'une clé utilisée par une liaison. Le connecteur résout la clé dans la configuration historique puis dans le registre de l'espace, pour l'essai comme pour la soumission. Tests d'isolation, de migration, de validation de l'hôte, de refus et de confidentialité ; gate API à 100 %.

### 14.2 — Écran Connexions

Formulaire « Point d'accès Databricks » avec nom, hôte et ID du warehouse, liste et retrait. La liaison existante choisit une clé enregistrée ; l'identifiant est toujours saisi dans le coffre puis l'essai est lancé depuis Board. États de chargement, refus, panne et succès ; tests de décodeurs, composants et parcours. Changelog et gate complet avant commit.

Réalisation : la carte « Points d'accès Databricks » permet la saisie, la liste et le retrait ; la clé s'utilise dans l'éditeur de liaison existant. Les décodeurs refusent les réponses hors contrat. Tests web à 100 % et parcours Playwright ordinateur/téléphone, avec captures inspectées. Aucun jeton n'est ajouté au formulaire.

### 14.3 — Démarrage et recette

Mettre la recette 12.8b à jour pour le parcours Board seul. Fournir les étapes concrètes de démarrage sans inscrire de secret dans le dépôt. Lancer l'application lorsque l'environnement OIDC et le coffre sont configurés ; la personne saisit ses valeurs dans Board. La clôture du lot 03 attend toujours les observations sur deux lecteurs réels et le constat expurgé.

Réalisation : la recette utilise désormais l'enregistrement et l'essai dans Board. Une [instance locale de test](../recettes/plan14-essai-board.md) a été préparée avec PostgreSQL migré, fournisseur OIDC synthétique sur la boucle locale, administrateur et deux lecteurs ; la connexion OIDC et l'écran Connexions ont été vérifiés dans un vrai navigateur. Aucun warehouse réel ni modèle certifié n'est encore configuré : la recette 12.8b reste à exécuter avec les valeurs que le porteur saisira dans Board.

### 14.4 — Connexion Safari sur la boucle locale

La recette dans Safari a révélé que les cookies `Secure` préfixés `__Host-` ne sont pas renvoyés sur l'origine locale en HTTP : le retour OIDC est refusé avec `invalid_state`. Pour une origine publique `http` admise uniquement sur la boucle locale, employer des cookies hôte seul sans préfixe `__Host-` ni attribut `Secure`, pour la demande de connexion et la session. Sur HTTPS, conserver les noms et attributs actuels. Tester les deux configurations et refaire le parcours complet dans Safari avant de reprendre la recette Databricks.

Réalisation : Safari ouvre désormais la session, affiche l'administrateur de test et atteint le formulaire des points d'accès Databricks. Le test API couvre le parcours local HTTP ; les tests HTTPS existants conservent les cookies `__Host-` avec `Secure`.

### 14.5 — Validation explicite des champs du point d'accès

Le message commun aux trois champs laisse croire qu'une saisie complète est vide. Afficher la règle du premier champ invalide (clé, URL ou ID), avec un exemple de clé utilisant un tiret. Tester la saisie signalée par le porteur : URL et warehouse valides, clé `databricks_test` refusée ; sa correction en `databricks-test` permet l'envoi. Exécuter le gate web avant le commit de code.

### 14.6 — Clés avec underscores et tirets

À la demande du porteur, accepter `_` et `-` après la lettre minuscule initiale des clés de points d'accès, dans le registre, la configuration serveur, les liaisons et les décodeurs web. Actualiser les messages et le pattern du formulaire. Tester création, lecture, liaison et retrait avec les deux séparateurs ; gates API et web avant commit. Cette décision remplace la restriction décrite en 14.5.
