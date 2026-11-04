# Exécuter avec l'autorisation OAuth de chaque lecteur

Le plan 16 propage l'autorisation personnelle jusqu'au connecteur Databricks. Les tests automatisés utilisent deux comptes et une source simulés. La recette sur le workspace réel reste à effectuer par le porteur ; ce document ne déclare pas cette recette réussie.

## Préparer la liaison

L'exploitant configure l'application OAuth et le coffre selon la [fiche du plan 15](plan15-oauth-databricks.md). La révision de base reste `0011` : aucune migration supplémentaire n'est requise pour le plan 16.

Dans **Administration de l'espace → Connexions**, l'administrateur :

1. Connecte son propre compte Databricks, choisit un warehouse et enregistre son point d'accès partagé. Cette opération partage les métadonnées du workspace et du warehouse, jamais son autorisation.
2. Crée une connexion logique, puis une liaison Databricks dans l'environnement de recette, avec ce point d'accès et le mode d'identité **person**. Aucun identifiant de service n'est à déposer pour cette liaison.
3. Configure le moteur avec un modèle sémantique certifié et une politique de lignes skifer fondée sur les attributs de confiance des deux lecteurs. Le modèle et ses politiques viennent du moteur, pas d'un filtre ajouté par Board. Voir les prérequis et le témoin à deux sujets de la [recette du lot 03](plan12-databricks.md).

Un simple essai du warehouse ne valide ni ce modèle, ni sa certification, ni sa politique de lignes. Sans moteur configuré, une soumission répond `engine_unavailable`.

## Parcours de chaque lecteur

Chaque personne ouvre sa propre session Board, avec un rôle Lecteur ou Créateur dans l'espace, puis **Exécutions → Connexion personnelle Databricks**.

1. Cliquer **Se connecter à Databricks**, saisir l'URL HTTPS du workspace et continuer vers Databricks.
2. S'authentifier personnellement et consentir. Le retour ramène à Exécutions. Board découvre les warehouses visibles ; le lecteur peut les choisir et utiliser **Tester avec ma connexion OAuth**. Il ne peut pas enregistrer un point d'accès partagé.
3. Dans **Lancer une exécution**, saisir le nom logique de la connexion, le modèle sémantique et ses métriques/dimensions. L'environnement est celui sélectionné dans la coque de Board. La liaison choisit le warehouse ; le choix du lecteur dans la carte personnelle sert à l'essai et ne remplace pas cette liaison.
4. Lire l'état, la preuve et l'aperçu du résultat. Le lecteur peut retirer son autorisation personnelle sans modifier celle d'une autre personne.

L'autorisation est liée à la personne, à l'espace et au workspace. Board renouvelle un accès expiré quand le consentement le permet. Une autorisation absente ou révoquée exige une reconnexion ; aucun compte administrateur ni identifiant de service ne sert de repli.

## Constats à relever sur la source réelle

Effectuer la recette avec deux personnes Databricks distinctes et les deux sessions Board correspondantes. Vérifier :

- des résultats différents conformes aux droits, y compris après retrait d'un filtre d'exploration ; présence de la preuve de politique et de certification ;
- le refus d'accès au résultat et de son annulation depuis l'autre session ; l'administration Board voit les métadonnées autorisées sans obtenir les résultats d'autrui ;
- un refus explicite sans lecture métier lorsque l'autorisation manque, le consentement est retiré, les attributs de confiance manquent ou la certification refuse la demande ;
- les limites, la troncature, le délai et l'annulation effective sur Databricks, selon la fiche du lot 03 ;
- une télémétrie agrégée et des preuves sans jeton ni secret.

Noter uniquement des constats expurgés et des identifiants opaques. Ne copier dans le dépôt ni jeton, cookie, code OAuth, SQL ni ligne métier. Le lot 03 reste ouvert jusqu'au constat réel de 12.8b.
