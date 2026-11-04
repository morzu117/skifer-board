# Connexion personnelle Databricks depuis l'URL du workspace

Le parcours du plan 15 remplit les paramètres du point d'accès depuis les métadonnées de Databricks. Il utilise une autorisation OAuth personnelle, distincte du SSO OIDC de Board. Aucun profil Databricks du poste ni jeton à copier n'est nécessaire pour ce parcours.

## Inscription initiale de Board dans Databricks

Une application personnalisée ne peut pas déduire son Client ID de l'URL du workspace. Cette inscription est faite une fois par l'administrateur du compte Databricks ; chaque utilisateur saisit ensuite uniquement l'URL du workspace.

Dans la console du compte Azure Databricks : **Settings → App connections → Add connection**.

- Nom : `Skifer Board`, ou `Skifer Board — recette locale` pour séparer la recette du déploiement.
- Type : client public, sans génération de secret client, avec PKCE.
- Redirect URL locale exacte : `http://localhost:5174/auth/databricks/callback`.
- Accès : SQL. Le parcours demande les scopes `sql offline_access` pour la découverte, l'essai et le renouvellement.
- Conserver le Client ID affiché. Aucune saisie d'un secret client n'est attendue pour ce client public.

L'activation de l'intégration peut prendre jusqu'à 30 minutes. En hébergement, enregistrer l'adresse HTTPS de Board avec le même chemin `/auth/databricks/callback`, sans reprendre l'adresse locale.

Sources : [application OAuth personnalisée](https://learn.microsoft.com/en-us/azure/databricks/integrations/enable-disable-oauth), [autorisation utilisateur et PKCE](https://learn.microsoft.com/en-us/azure/databricks/dev-tools/auth/oauth-u2m), [API de liste des warehouses](https://docs.databricks.com/api/warehouses/v1/list-warehouses).

## Configuration de l'instance Board

L'exploitant configure `SKIFER_BOARD_DATABRICKS_OAUTH_CLIENT_ID` avec le Client ID de l'application enregistrée, puis redémarre l'API. L'origine et l'adresse de retour viennent de la configuration OIDC existante de Board ; les clés du coffre existant chiffrent aussi les autorisations personnelles. La base doit avoir été migrée à `0011` par `skifer-board-migrate`. Sans Client ID ou sans coffre, l'écran explique que la configuration OAuth manque et affiche l'adresse de retour à enregistrer.

Sur l'instance locale de cette recette, le lanceur hors dépôt `~/.local/share/skifer-board/dev-test/board.py` accepte aussi le champ facultatif `databricks_oauth_client_id` dans son fichier `config.json`. Ce fichier contient d'autres réglages confidentiels : le modifier localement, sans le copier dans une conversation ou un commit. Le Client ID lui-même n'est pas un secret.

## Recette dans Board

1. Ouvrir l'espace **Recette Databricks**, puis **Connexions**.
2. Dans **Connexion personnelle Databricks**, cliquer **Se connecter à Databricks**.
3. Saisir l'URL HTTPS du workspace et cliquer **Continuer vers Databricks**.
4. S'authentifier et autoriser Board dans Databricks. Le retour reprend la page de l'espace et charge les warehouses visibles par cette personne.
5. Un warehouse unique est présélectionné. Avec plusieurs résultats, choisir explicitement le warehouse. Avec aucun résultat, vérifier les droits de la personne dans Databricks ; Board ne crée et ne démarre aucune ressource.
6. Vérifier l'ID détecté et la clé proposée, éditable avec `_` et `-`, puis cliquer **Enregistrer ce warehouse**.
7. Cliquer **Tester avec ma connexion OAuth**. Le message doit indiquer l'identité `person`, l'état du warehouse et l'expiration. L'essai ne soumet aucune requête SQL.
8. Dans une autre session Board, un autre administrateur voit les points d'accès partagés mais ne reçoit ni le jeton ni la liste des connexions personnelles de la première personne.
9. **Déconnecter mon compte Databricks de ce workspace** retire l'autorisation conservée dans Board pour cette personne et ce workspace. Cela ne révoque pas le consentement dans le compte Databricks et ne déconnecte pas les autres personnes.

L'access token est renouvelé automatiquement à l'approche de son expiration avec le refresh token personnel. La conservation locale est bornée à sept jours après le consentement ; les durées Databricks peuvent être plus courtes. Un refus de renouvellement ou un consentement révoqué impose une reconnexion. La rotation `skifer-board-vault-rotate` couvre aussi les jetons et les demandes OAuth chiffrés.

## Portée du constat

Les parcours automatiques utilisent un fournisseur et des réponses Databricks simulés. La recette OAuth réelle n'est pas déclarée réussie tant que l'application n'est pas enregistrée et que le retour de Databricks suivi de la découverte n'a pas été observé. Le test au jeton manuel du plan 14 reste un constat distinct.

Cette tranche livre la connexion, la découverte et l'essai personnels. Les exécutions de liaisons `person` restent refusées tant que leur propagation d'identité n'est pas livrée ; aucune autorisation personnelle n'est transformée en identifiant de service. La recette RLS du lot 03 reste à terminer selon le plan 12.
