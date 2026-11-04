# Recette réelle du plan 12 — exécutions Databricks

Statut : **préparation 12.8a**. Ce document ne vaut pas constat de réussite sur un warehouse. La clôture du lot 03 exige l'exécution 12.8b et un constat expurgé.

## Préparer l'environnement

Choisir explicitement un profil Databricks, un workspace et un SQL warehouse de test. Les commandes du poste ont été vérifiées avec le CLI installé ; remplacer les marqueurs entre chevrons avant de les lancer. Ne pas utiliser le profil par défaut ni `--sensitive`.

```bash
databricks auth describe --profile <profil choisi>
databricks warehouses get <warehouse id> --profile <profil choisi> --output json
```

Le warehouse doit être en état `RUNNING` ou pouvoir démarrer, et le profil doit viser le même hôte HTTPS que le point d'accès de Board. Un jeton de service distinct, limité à cette recette, est saisi uniquement dans le coffre de Board ; il ne figure ni dans la configuration d'endpoint, ni dans un argument CLI, ni dans le constat. Un échec de ces deux précontrôles suspend la recette.

Préparer hors du dépôt une table témoin du warehouse avec au moins deux partitions de lignes synthétiques, chacune liée au `subject` OIDC exact d'un lecteur de test différent. Garder une marque métier sans sensibilité pour reconnaître les lignes A et B. Le même modèle sémantique skifer certifié doit porter une `row_policy` sur cette colonne avec `attribute: subject` ; Board fournit `issuer` et `subject` vérifiés côté serveur. Chaque modèle que la requête peut lire doit porter une politique de ligne. Ne pas recopier les sujets OIDC, le nom physique de table ou les lignes dans le dépôt. La certification doit être en mode `enforce`, avec une base SQLite de certification déjà provisionnée.

Board doit être lancé en mode OIDC hébergé avec PostgreSQL migré, un espace de test contenant les deux lecteurs et un administrateur, et les réglages suivants fournis par l'exploitant :

| Réglage | Attendu |
|---|---|
| `SKIFER_BOARD_CONNECTION_ENDPOINTS` | Objet JSON dont une clé stable décrit `{"connector":"databricks","host":"https://<workspace Databricks>","warehouse_id":"<id>"}`. L'hôte doit appartenir à un domaine Databricks admis par Board. |
| `SKIFER_BOARD_SEMANTIC_MODELS_DIR` | Répertoire absolu existant contenant `semantic_catalog.yaml` et les modèles certifiés. |
| `SKIFER_BOARD_CERTIFICATION_DB` | Fichier SQLite absolu existant du magasin de certification skifer. |
| `SKIFER_BOARD_VAULT_KEYS`, `SKIFER_BOARD_VAULT_ACTIVE_KEY` | Clés de coffre stables, fournies hors du dépôt et de la base. |
| `SKIFER_BOARD_DATABASE_URL` et variables OIDC | Base hébergée et identité vérifiée configurées selon les plans 06 et 07. |

Dans l'administration de l'espace (`#/espaces/<espace>/connexions`), créer une connexion logique, configurer sa liaison DEV vers la clé d'endpoint déclarée, avec connecteur Databricks et identité `service`. Poser le jeton de service dans le champ à usage unique, puis lancer « Tester la connexion ». Le résultat doit annoncer l'identité de service, l'état du warehouse et la capacité d'annulation, sans renvoyer le jeton. Un jeton OIDC de connexion à Board n'est pas un jeton Databricks.

## Parcours à réaliser

Les deux lecteurs se connectent chacun dans une session Board distincte. Avec **la même** connexion, le même environnement, le même modèle et les mêmes métriques, soumettre une exécution depuis `#/espaces/<espace>/executions`. Lire son état jusqu'à une issue terminale, puis ouvrir le détail et l'aperçu Arrow. Une réussite doit avoir des lignes, une taille, un indicateur de troncature, un `evidence_id`, un `sql_hash` et des `model_keys`. Le lecteur A ne reçoit que les marques A, le lecteur B que les marques B ; les deux résultats doivent différer. Ni la liste, ni le détail, ni la télémétrie ne contiennent le SQL ou le jeton.

Rejouer la requête du lecteur A une fois avec un filtre d'exploration sur une colonne témoin autorisée, puis sans ce filtre. La soumission HTTP accepte exactement `connection`, `environment`, `model`, `metrics`, `dimensions` et `filters` ; le navigateur n'envoie aucun SQL. Retirer le filtre ne doit jamais faire apparaître une marque B. Le formulaire de 12.7 envoie `filters: []` ; pour le cas avec filtre, utiliser une demande de même origine dans la session de test, sans copier le cookie ni le corps de réponse dans un journal. Les filtres ont la forme `{"column":"<colonne du modèle>","operator":"eq","value":"<marque synthétique>"}`. Ne pas détourner ce filtre en politique de sécurité : seule la `row_policy` skifer protège les lignes.

Avec la session d'administration, choisir la portée « Espace ». Elle montre les métadonnées des exécutions des deux lecteurs ; le détail d'une exécution d'autrui n'offre ni preuve personnelle ni aperçu. `GET /api/spaces/<espace>/executions/<id>/result` doit être refusé pour l'administrateur comme pour l'autre lecteur.

Préparer ensuite des jeux ou modèles de recette qui produisent : plus de 1 000 lignes, plus de 1 Mio de résultat, un statement suffisamment long pour demander l'annulation, et un délai supérieur à la limite de 30 secondes. La réponse bornée ne doit jamais annoncer plus de 1 000 lignes ni plus de 1 Mio ; elle doit signaler `truncated` quand la source ou Board a coupé le résultat. Une demande d'annulation ne vaut pas `cancelled` avant la confirmation terminale du connecteur. Révoquer enfin un jeton de service **de test** et vérifier le refus `credential_rejected` sans fuite de sa valeur. Restaurer un jeton de test valide avant de quitter l'environnement. Si un scénario n'est pas reproductible sur le warehouse choisi, inscrire « non conclu » plutôt que « réussi ».

Lire la télémétrie d'exécution en tant qu'administrateur de plateforme : genre `execution`, opération fixe, issue, durée, lignes et octets. Vérifier qu'aucun sujet, nom de connexion, requête, preuve ou secret n'y paraît. Une panne de télémétrie ne doit pas transformer une exécution réussie en échec.

## Constat à joindre après la recette

Créer un compte rendu de 12.8b avec seulement : date UTC, version de Board et de skifer, hôte de workspace **sans chemin ni jeton**, identifiant du warehouse de test, identifiants opaques des exécutions, états terminaux, compteurs de lignes et d'octets, drapeaux de troncature, identifiants et hash de preuve, observations de refus et résultat de chaque vérification (« réussi », « échoué », « non conclu »). Noter les marques synthétiques A/B et les comptes attendus, sans sujets OIDC ni lignes brutes. Ne joindre aucun cookie, jeton, clé de coffre, SQL, corps Arrow ou réponse HTTP complète. Une panne ou un refus ferme le point concerné ; elle ne se convertit pas en réussite par absence de ligne.
