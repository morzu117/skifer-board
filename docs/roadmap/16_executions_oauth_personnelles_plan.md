# Plan 16 — Exécutions avec l'autorisation OAuth du lecteur

Date : 4 novembre 2026 · Statut : trois tranches réalisées et vérifiées ; plan commité avant code. La recette Databricks réelle des plans 12 et 15 attend le contrôle du porteur ; cette tranche avance sans son Client ID ni ses secrets.

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

## Réalisation

- **16.1** : résolveur OAuth commun, routes personnelles ouvertes au lecteur/créateur et garde administrateur maintenue pour la sélection partagée. Le retour conserve une destination fermée et chiffrée dans la demande PKCE, compatible avec les demandes du plan 15 ; l'accès à l'espace est revalidé.
- **16.2** : jeton du demandeur dans les exécutions et essais des liaisons Databricks personnelles ; contrôle du mode effectif avant la lecture. Tests à deux lecteurs, RLS et certification, refus d'emprunt de service, isolement des résultats, renouvellement et refus amont, annulation avec le connecteur figé même après déconnexion locale.
- **16.3** : carte personnelle dans Exécutions sans écriture partagée, retour après OAuth et parcours de soumission ; messages actualisés et [fiche de recette](../recettes/plan16-executions-personnelles.md). Six captures inspectées sur ordinateur/téléphone, clair/ardoise ; contraste corrigé pour le texte de la carte en ardoise. Instance locale redémarrée ; aucune migration au-delà de `0011`.

Vérifications : suite API complète (4 911 tests, 100 % lignes/branches), puis les neuf tests d'exécution personnelle après ajout de trois cas de renouvellement et de refus amont ; ruff et mypy passent. Les 16 parcours navigateur ciblés passent, puis la suite complète : 597 réussites et un saut prévu. Le gate web complet passe : 2 457 tests et 100 % de couverture, typage, lint et build. Un premier passage concurrent avec Chrome avait dépassé le délai de deux tests d’accessibilité du prototype ; le passage complet seul réussit sans modification de ces tests. `pnpm run check:docs` passe.

La recette réelle des plans 12 et 15 est différée à la demande du porteur. Le Client ID réel et le modèle certifié avec ses politiques de lignes restent à configurer ; aucune réussite sur Databricks réel n'est déclarée, et le lot 03 reste ouvert en 12.8b.
