# Plan 16 — Exécutions avec l'autorisation OAuth du lecteur

Date : 4 novembre 2026 · Statut : plan commité avant code. La recette Databricks réelle des plans 12 et 15 attend le contrôle du porteur ; cette tranche avance sans son Client ID ni ses secrets.

Sources : [plan de développement](../plan-de-developpement.md), lot 03 ; [plan 12](12_connexions_et_executions_plan.md), X4–X7 ; [plan 15](15_oauth_databricks_decouverte_plan.md).

## Décisions

- Les lecteurs et créateurs peuvent ouvrir, consulter, tester et retirer leur propre autorisation OAuth dans un espace auquel ils ont accès. L'enregistrement d'un point d'accès partagé reste réservé aux administrateurs. Un administrateur de plateforme sans rôle de lecture conserve la gestion des métadonnées, sans obtenir le droit d'exécuter une requête métier.
- Une liaison Databricks `person` utilise exclusivement le jeton OAuth de la personne qui soumet l'exécution, pour le workspace résolu dans cette liaison. Ni le coffre de service, ni l'autorisation d'un administrateur ou d'un autre lecteur ne servent de repli. Une autorisation absente, expirée ou révoquée produit un refus explicite.
- La résolution et le renouvellement du jeton ont une seule implémentation commune aux tests et aux exécutions. Le connecteur interne annonce le mode d'identité qui lui a réellement été fourni ; l'adaptateur sémantique refuse une liaison personnelle avec un connecteur de service ou sans identité personnelle explicitée. DuckDB personnel reste refusé.
- Le contexte immuable, la politique de lignes skifer, la certification, les limites et les gardes de lecture et d'annulation des résultats restent obligatoires. Les jetons ne sont jamais copiés dans une exécution persistée, une preuve, la télémétrie ou une réponse HTTP. Le test de métadonnées d'une liaison personnelle utilise aussi l'autorisation de la personne qui le demande.

## Tranches

### 16.1 — Autorisation personnelle accessible aux lecteurs

Extraire le résolveur OAuth commun, puis séparer les gardes des routes personnelles et de la sélection partagée. Le retour OAuth revalide l'accès de la personne à l'espace. Tester lecteur/créateur/administrateur, non-membre, autre espace, révocation du rôle, indépendance des autorisations et refus de la création de métadonnées par un lecteur.

### 16.2 — Propagation aux exécutions et aux essais de liaison

Brancher le résolveur personnel sur la soumission Databricks et l'essai d'une liaison `person`, en gardant le chemin `service` explicite. Vérifier dans l'adaptateur le mode d'identité effectif du connecteur. Tests hors réseau avec deux lecteurs, deux jetons sentinelles et deux résultats autorisés distincts ; aucun appel de données sur un refus de RLS ou de certification, aucun emprunt de secret de service, aucune fuite de jeton, refus des accès croisés aux résultats. Les délais et l'annulation réutilisent le connecteur figé de l'exécution.

### 16.3 — Parcours du lecteur et recette

Rendre la carte de connexion personnelle accessible depuis Exécutions pour un lecteur. Le lecteur choisit et teste ses warehouses mais ne voit pas de commande d'enregistrement partagé ; l'administrateur conserve cette commande dans Connexions. Actualiser le libellé des liaisons personnelles et documenter leur configuration par l'administrateur, puis leur utilisation par chaque lecteur. Tests web et navigateur sur ordinateur et téléphone ; captures inspectées et absence de débordement. Gates, changelog et commit pour chaque tranche ; recette réelle et clôture du lot 03 restent en attente de l'instance du porteur.
