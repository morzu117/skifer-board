# Essai du connecteur Databricks depuis Board

## Instance locale préparée le 4 novembre 2026

Sur le poste de développement, Board est accessible à `http://localhost:5174/`. L'API écoute seulement sur `127.0.0.1:8000`, le fournisseur OIDC synthétique sur `127.0.0.1:8765`, et PostgreSQL contient la base `skifer_board_test` migrée à la révision `0010`. L'espace **Recette Databricks** (`board-test`) possède un administrateur, **Lecteur A de test** et **Lecteur B de test**. Le fournisseur OIDC local sert seulement à cette recette, sur la boucle locale. Le parcours de connexion et l'ouverture du formulaire ont aussi été vérifiés dans Safari après le correctif 14.4.

Si les processus locaux ne tournent plus, les scripts et la configuration de test sont conservés hors du dépôt dans `~/.local/share/skifer-board/dev-test/`. Aucun jeton Databricks n'y est écrit ; la clé du coffre et le secret du fournisseur local sont dans `config.json`, accessible au seul compte du poste.

Depuis la racine du dépôt, relancer chacun dans son propre terminal :

```bash
uv run --locked python ~/.local/share/skifer-board/dev-test/oidc.py
uv run --locked python ~/.local/share/skifer-board/dev-test/board.py
pnpm --filter @skifer-board/web exec vite --host 127.0.0.1 --port 5174 --strictPort
```

## Saisir les informations dans Board

1. Ouvrir `http://localhost:5174/` puis **Se connecter** et choisir **Administrateur de test**.
2. Ouvrir l'espace **Recette Databricks**, puis **Connexions** (`#/espaces/board-test/connexions`).
3. Dans **Points d'accès Databricks**, saisir une clé au format `azure-test`, l'URL HTTPS du workspace Azure Databricks et l'ID du SQL warehouse de test. Enregistrer. Ces deux valeurs sont conservées dans la base Board, propres à l'espace, sans jeton.
4. À côté du point d'accès enregistré, cliquer **Tester la connexion**, saisir soi-même le jeton Databricks dans le champ masqué puis cliquer **Lancer le test**. Le champ s'efface dès l'envoi. Ce jeton sert uniquement à cet essai et n'est pas conservé ; le résultat apparaît sous le point d'accès. L'essai vérifie les métadonnées du warehouse, sans requête métier ni création de liaison.
5. Pour préparer ensuite les exécutions, créer une connexion logique, par exemple `source_test`. Dans sa liaison **DEV**, choisir **Databricks SQL**, saisir la clé du point d'accès et garder l'identité **Service**.
6. Cliquer **Poser un identifiant** et saisir soi-même le jeton de service de test dans le champ à usage unique. Board le chiffre dans son coffre ; le champ s'efface et la valeur ne peut pas être relue depuis l'interface.
7. Le bouton **Tester la connexion** de la liaison permet aussi de vérifier l'identifiant conservé dans le coffre. Il doit afficher l'identité de service, l'état du warehouse et la capacité d'annulation. En cas de refus, relever seulement le code et le message visibles, sans copier le jeton.

Aucun profil CLI Databricks n'est nécessaire. Ne placer ni jeton ni secret dans une issue, un commit ou une conversation.

## Suite de la recette du lot 03

L'essai du connecteur ne démontre pas encore l'isolation des données. Pour lancer des exécutions, Board doit aussi recevoir un modèle sémantique skifer certifié, une politique de ligne fondée sur les deux sujets OIDC vérifiés et une table témoin dans le warehouse. Ces éléments ne sont pas configurés dans l'instance locale actuelle. La [recette 12.8b](plan12-databricks.md) détaille les observations nécessaires avant de clore le lot 03 : résultats distincts des deux lecteurs, refus de lecture à l'administrateur, preuves, limites, annulation et télémétrie.
