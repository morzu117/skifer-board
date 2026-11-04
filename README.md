# Skifer Board

Application web partagée de self-service BI et d’analytics de l’écosystème Skifer : exploration adhoc, analyses sauvegardées et dashboards personnalisables, appuyés sur Atlas et le moteur Skifer.

Les lots 01 et 02 sont réalisés. Le lot 03 possède les connexions, le coffre, les exécutions suivies et leurs écrans ; sa recette sur un warehouse Databricks réel reste à faire. Le catalogue Atlas est lisible, mais la correspondance vérifiable entre KPI Atlas et modèle skifer manque encore pour rendre ses KPI exécutables.

- [Plan de développement](docs/plan-de-developpement.md) : décisions, architecture cible, lots, dépendances, critères d’acceptation et arbitrages.
- [Écrans et fonctionnalités](docs/ecrans-et-fonctionnalites.md) : écrans, écrans intermédiaires, états standards, rôles, matrice écrans × lots.
- [Connexion OAuth Databricks depuis l’URL du workspace](docs/recettes/plan15-oauth-databricks.md) : inscription de Board, connexion personnelle, découverte des warehouses et essai.
- [Exécutions avec l’autorisation personnelle du lecteur](docs/recettes/plan16-executions-personnelles.md) : configuration de la liaison, parcours lecteur et contrôles à réaliser sur la source réelle.
- [Essai du connecteur Databricks depuis Board](docs/recettes/plan14-essai-board.md) : instance locale de test et saisie du workspace, du warehouse et de l'identifiant dans Board.
