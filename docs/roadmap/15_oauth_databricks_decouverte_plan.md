# Plan 15 — Connexion OAuth Databricks et découverte depuis l'URL

Date : 4 novembre 2026 · Statut : 15.1 à 15.3 implémentés ; intégration OAuth Board à enregistrer dans Databricks pour la recette réelle.

Demande du porteur : saisir uniquement l'URL du workspace, se connecter personnellement par OAuth et laisser Board récupérer les valeurs disponibles. Ce plan complète le plan 14 et ne confond pas le SSO de Board avec l'autorisation d'accès à Databricks.

## Parcours retenu

1. Saisir l'URL HTTPS du workspace puis cliquer « Se connecter à Databricks ». Canoniser l'URL avant toute navigation ; mêmes domaines Databricks admis que pour les points d'accès existants, sans URL de retour fournie par le navigateur.
2. Autorisation utilisateur OAuth avec Authorization Code et PKCE S256. Après consentement, retour vers Board ; aucune copie de jeton dans un champ ou dans la conversation.
3. Interroger `GET /api/2.0/sql/warehouses` avec l'autorisation de cette personne. Présenter les warehouses visibles avec leur nom, leur identifiant et leur état. Avec un seul résultat, le présélectionner ; avec plusieurs, demander un choix explicite ; avec aucun, expliquer l'absence de warehouse accessible. Ne créer ni ne démarrer de ressource.
4. Remplir l'URL et l'ID du warehouse depuis ce résultat, proposer une clé Board éditable acceptant `_` et `-`, puis enregistrer le point d'accès sur confirmation. Une URL de workspace seule ne désigne pas un warehouse unique.
5. « Tester la connexion » utilise ensuite l'autorisation OAuth personnelle. Afficher identité effective, résultat et expiration ; connexion expirée ou consentement révoqué mène à une reconnexion.

## Prérequis Databricks

Pour une application personnalisée telle que Board, Databricks exige une intégration OAuth enregistrée. Son Client ID et ses URI de retour autorisées sont des réglages de l'exploitant, indépendants des valeurs découvertes dans le workspace. Ne pas réutiliser le Client ID du CLI Databricks ni une authentification ambiante du poste. Pour la recette locale, fixer l'URI de retour à `http://localhost:5174/auth/databricks/callback`, sur l'origine publique de Board. Le client est public avec PKCE S256 ; aucun secret client à saisir pour ce parcours.

Le porteur indiquera si une intégration existe déjà. S'il n'en existe pas, fournir une fiche d'inscription avec l'URI exacte et les scopes nécessaires ; le porteur effectue l'inscription dans son compte. Aucun secret n'est demandé dans la conversation. L'absence de configuration OAuth est un état explicite dans Board, jamais un succès simulé.

Sources vérifiées le 4 novembre 2026 :

- [OAuth utilisateur Azure Databricks](https://learn.microsoft.com/en-us/azure/databricks/dev-tools/auth/oauth-u2m) : application personnalisée, Client ID, PKCE, endpoints authorize/token, durée et renouvellement.
- [Liste des warehouses](https://docs.databricks.com/api/warehouses/v1/list-warehouses) : noms, IDs, états et paramètres de connexion.
- [Enregistrement des applications OAuth](https://learn.microsoft.com/en-us/azure/databricks/integrations/enable-disable-oauth) : console de compte → Settings → App connections → Add connection ; accès SQL pour les API de warehouse, client public sans génération de secret. L'activation peut prendre jusqu'à 30 minutes.

## Invariants et découpage

### 15.1 — Configuration, autorisation et coffre personnel

Configurer explicitement Client ID, origine et callback ; définir les scopes selon les API réellement utilisées. Persister les demandes en attente pour plusieurs processus, consommer chaque state une seule fois, lier la demande à la session Board et à l'espace, limiter sa durée et vérifier à nouveau les droits au retour. Chiffrer les jetons avec les clés du coffre existant et lier le chiffrement à la personne, l'espace et le workspace. Ne jamais placer code, verifier, access token ou refresh token dans les journaux, la télémétrie ou les réponses métier. Révoquer/déconnecter sans toucher aux autorisations d'une autre personne ; gérer expiration et renouvellement sans promotion vers une identité de service.

Réalisation 15.1 : révision `0011`, états PKCE à usage unique liés à la session, coffre personnel AES-GCM avec contexte personne/espace/workspace/application/échéance, renouvellement sous verrou PostgreSQL et rotation des clés intégrée.

### 15.2 — Découverte et enregistrement

Lister les warehouses avec l'autorisation personnelle et un transport borné, TLS vérifié, sans redirection ni proxy hérité. Valider les réponses, ne retourner que les champs utiles, isoler chaque personne et espace. Enregistrer seulement la sélection validée et les métadonnées du point d'accès ; ne pas partager le jeton avec les administrateurs de l'espace. Brancher le test sur cette autorisation.

Réalisation 15.2 : routes d’autorisation, retour, découverte, sélection, essai et déconnexion personnelle ; absence de jetons dans les réponses métier et retrait des paramètres du callback avant journalisation. Les inventaires d’authentification et de confidentialité couvrent les nouvelles routes.

### 15.3 — Interface et recette

Faire du parcours URL → OAuth → choix du warehouse → confirmation le parcours principal. Conserver les états configuration requise, consentement refusé, demande expirée, aucun warehouse, échec réseau et réussite. Reprendre les paramètres après retour OAuth et éviter les pertes de saisie. Tests API sans réseau ni secret réel : PKCE, state, rejeu, droits, isolation, chiffrement, renouvellement et confidentialité. Tests web des états et sélections ; parcours navigateur avec OAuth simulé, puis recette réelle par le porteur avec l'intégration enregistrée. Gates et changelog avant chaque commit de code ; ne déclarer l'OAuth réel validé qu'après le retour de Databricks et la découverte effective.

À la livraison du plan 15, les exécutions `person` restaient refusées. Le [plan 16](16_executions_oauth_personnelles_plan.md) câble et teste leur propagation d'identité ; une découverte réussie ne valide toujours pas à elle seule la recette RLS réelle du lot 03.

Réalisation 15.3 : carte personnelle dans Connexions, états de configuration explicites, reprise du retour OAuth, sélection unique préremplie ou choix multiple, clé éditable et essai personnel. Parcours navigateur avec fournisseur simulé et captures inspectées sur ordinateur et téléphone ; [fiche d’inscription et recette réelle](../recettes/plan15-oauth-databricks.md). L’instance locale a été migrée et redémarrée ; aucun Client ID Databricks n’est encore configuré.
