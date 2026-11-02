# Plan 08 — Espaces, appartenance et rôles (lot 02, troisième tranche)

Date : 2 novembre 2026 · Statut : **en cours**. Troisième tranche du lot 02 (« socle partagé »), après l'identité (plan 06) et la persistance (plan 07). Choix du porteur du 2 novembre, qui suit les recommandations : **appartenance par groupes du fournisseur et par personnes**, **groupe d'administration de la plateforme nommé en configuration**, **espaces, membres et rôles en base**. Claude développe ; les tests sont écrits par un agent Claude distinct (plan 03, T1).

Plan parent : [plan de développement](../plan-de-developpement.md), §2 (propositions : consulter, créer, administrer), §4.1 (objet Espace), §4.3 (droits), §8 lot 02. Écrans : [écrans et fonctionnalités](../ecrans-et-fonctionnalites.md), §0.1 (rôles), §0.5 (coque), §1.1 (accueil des espaces), §9 (administration, « Membres et rôles »).

## 1. Point de départ

- Une personne est authentifiée (plan 06) et sa session vit en base (plan 07). Ses groupes sont lus, mais rien n'en dépend (plan 06, I9).
- Il n'existe aucun espace. Toute personne connectée lit tout le catalogue Atlas, par `/api/catalog`.
- La coque prévoit un espace (`workspace`), toujours vide aujourd'hui.

## 2. Décisions

| # | Décision | Écartée |
|---|---|---|
| E1 | **Un espace** a un identifiant stable, choisi à la création et jamais modifié (lettres minuscules, chiffres et tirets, 2 à 40 caractères), un nom affiché modifiable, un rattachement Atlas, un auteur et une date de création. Dans cette tranche, tous les espaces sont rattachés au seul dépôt Atlas configuré (`SKIFER_BOARD_ATLAS_REPOSITORY`). | Plusieurs dépôts Atlas dès maintenant : la lecture d'Atlas est globale au serveur (plan 04) et le deviendrait par espace dans une tranche à part. |
| E2 | **Trois rôles ordonnés** : lecteur < créateur < administrateur (écrans §0.1). Le droit de déployer par environnement vient avec la tranche des environnements. **Un rôle ne donne jamais de droit sur les données** : elles restent évaluées pour la personne, selon son identité et le RLS (§4.3). | — |
| E3 | **Appartenance par liaisons.** Une liaison associe, dans un espace, un **groupe du fournisseur** ou une **personne** à un rôle. Le rôle effectif est le plus élevé des liaisons qui correspondent à la session. Une personne est désignée par son émetteur et son sujet, jamais par son adresse, qui n'est ni stable ni garantie. Un groupe est désigné par sa valeur exacte dans le claim des groupes. | Adresse comme identifiant : elle change, et deux comptes peuvent la partager. |
| E4 | **Groupes au moment de la connexion.** Les groupes pris en compte sont ceux du jeton reçu à la connexion. Retirer quelqu'un d'un groupe chez le fournisseur lui retire le rôle correspondant à sa connexion suivante, au plus tard à la fin de sa session (8 h). Retirer une liaison dans Board prend effet **à la requête suivante**, car le rôle est recalculé à chaque requête. | Relire les groupes chez le fournisseur à chaque requête : un appel réseau par requête, et aucun fournisseur ne l'offre de façon uniforme. |
| E5 | **Personnes connues.** Board enregistre chaque personne à sa connexion : émetteur, sujet, nom, adresse et date de dernière connexion. Les groupes n'y sont pas gardés. Pour ajouter une personne à un espace, un administrateur la choisit parmi les personnes connues, en cherchant par nom ou par adresse. Une personne qui ne s'est jamais connectée s'ajoute donc par un groupe, ou après sa première connexion. | Saisir le sujet à la main : opaque et source d'erreurs. Interroger l'annuaire du fournisseur : non standard en OIDC. |
| E6 | **Administration de la plateforme.** `SKIFER_BOARD_ADMIN_GROUP` nomme un groupe du fournisseur. Ses membres créent les espaces et gèrent les liaisons de n'importe quel espace, ce qui permet de réparer un espace sans administrateur. Ce rôle **n'est pas un rôle dans un espace** : il ne donne ni la lecture du catalogue d'un espace, ni aucune donnée. Sans cette variable, personne ne peut créer d'espace. | Premier connecté administrateur : la première personne arrivée prend la main. Commande d'exploitation : un accès au serveur pour chaque espace. |
| E7 | **Contrôle côté serveur seulement.** Toute route d'espace, `/api/spaces/{espace}/…`, recalcule le rôle à partir de la session et refuse sinon. Un espace inconnu et un espace dont on n'est pas membre donnent la **même réponse**, `404 space_not_found` : un non-membre n'apprend pas qu'un espace existe. Un rôle insuffisant donne `403 forbidden`, avec le rôle requis. Aucun rôle reçu du navigateur n'est cru (§4.3). | Masquer seulement dans l'interface : le navigateur n'est pas une frontière. |
| E8 | **Toujours un administrateur.** Une liaison ne peut pas être retirée ni abaissée si elle est la dernière liaison administrateur de l'espace : `409 last_admin`. Un administrateur de la plateforme peut toujours en ajouter une. | — |
| E9 | **Catalogue par espace.** `/api/catalog…` devient `/api/spaces/{espace}/catalog…` et exige le rôle lecteur. Les anciennes routes disparaissent (`404`). | Garder un catalogue global : Atlas est rattaché à un espace (§4.1). |
| E10 | **Journal.** Création d'un espace, ajout, changement et retrait d'une liaison sont journalisés en base, avec l'auteur, l'instant et l'avant et l'après. Le journal est en ajout seul, et lisible par les administrateurs de l'espace. | Journal dans des fichiers : non interrogeable par espace. |
| E11 | **Mode local.** Sans OIDC (boucle locale, plan 06, I7), il n'y a ni personne ni base obligatoire. Le serveur expose alors un seul espace implicite, `local`, rattaché au dépôt configuré, où la personne locale est administrateur. Il n'est pas stocké, et ses membres ne se gèrent pas (`409 local_mode`). Le prototype et le catalogue restent utilisables en développement. | Exiger une base et OIDC en développement : le bout en bout tourne aujourd'hui sans l'un ni l'autre. |
| E12 | **Écritures.** Corps JSON validés, refus à codes fermés (`invalid_request` avec le champ en cause, `space_exists`, `unknown_person`), contrôle d'origine du plan 06 (I8). Un changement de liaison qui ne change rien est accepté sans journal. | — |

## 3. Sous-tâches

Chaque point est un commit `feat(plan08-x.y)` avec son entrée de changelog. Claude relit les tests, lance le gate complet et commite.

### 8.1 — Modèle, migration et décision d'accès

Créés : `apps/api/src/skifer_board/spaces/` (modèle, magasin en base, décision d'accès), révision `0003`. Modifiés : `identity/web.py` (enregistrement de la personne à la connexion), `identity/config.py` (`SKIFER_BOARD_ADMIN_GROUP`).

- Tables `spaces`, `space_bindings`, `people` et `space_events`.
- `effective_role(identity, bindings) -> Role | None`, fonction pure (E3).
- `is_platform_admin(identity, config)` (E6).
- Magasin : créer un espace, lister les espaces d'une identité avec son rôle, lire les liaisons, poser ou retirer une liaison avec la règle du dernier administrateur (E8) et le journal (E10), en **une transaction** par écriture.
- Enregistrement des personnes à la connexion (E5), et recherche par nom ou par adresse.

Tests : rôle effectif sur toutes les combinaisons (aucune liaison, groupe seul, personne seule, plusieurs liaisons, groupe homonyme dans un autre espace, même sujet chez un autre émetteur) ; dernier administrateur, y compris quand deux retraits concurrents visent les deux derniers ; journal complet et en ajout seul ; isolation de deux espaces ; personne enregistrée et mise à jour à chaque connexion ; migration depuis une base vierge et concordance avec les déclarations.

Écarts de réalisation :

- `is_platform_admin` reçoit le nom du groupe d'administration (`config.admin_group`), pas toute la configuration : le modèle ne dépend pas de la configuration OIDC.
- L'agent de test a trouvé un défaut, corrigé : la recherche de personnes reposait sur `ILIKE`, qui ne replie que la casse ASCII sur une base en locale C (« CHLOÉ » ne trouvait pas « Chloé »). La table `people` garde désormais deux clés de recherche, `name_key` et `email_key`, repliées par Board (NFC, puis `casefold`) ; la recherche est un `LIKE` sur ces clés, indépendant de la locale de la base. L'ordre des résultats départage aussi par émetteur.
- Le magasin ne valide ni l'identifiant d'espace (E1) ni le nom d'un groupe : les routes de 8.2 refusent un identifiant hors format et un nom de groupe vide (E12), avant d'appeler le magasin.
- Le pilote pg8000 rend une violation de clé étrangère comme `ProgrammingError`, pas `IntegrityError`. Le magasin n'en dépend pas : il verrouille l'espace et lève `SpaceNotFound` avant d'écrire.

### 8.2 — Routes des espaces

Modifiés : `server.py` (catalogue par espace, E9), `identity/web.py` (`/api/me` dit si la personne administre la plateforme). Exemples versionnés dans `contracts/espaces/`.

- `GET /api/spaces` : espaces où la personne a un rôle, avec ce rôle. Pour un administrateur de la plateforme, tous les espaces, avec son éventuel rôle.
- `POST /api/spaces` : création par un administrateur de la plateforme, avec un premier administrateur (groupe ou personne).
- `GET /api/spaces/{espace}` : l'espace et le rôle de la personne.
- `GET` et `POST /api/spaces/{espace}/members`, `DELETE /api/spaces/{espace}/members/{liaison}` : réservés aux administrateurs de l'espace et de la plateforme.
- `GET /api/people?q=` : recherche de personnes connues, réservée aux administrateurs, 20 résultats au plus.
- `GET /api/spaces/{espace}/events` : journal, réservé aux administrateurs.
- `/api/spaces/{espace}/catalog…` : les routes du catalogue, réservées aux lecteurs et au-delà.

Tests : chaque route avec chaque rôle, plus non-membre et administrateur de la plateforme seul. Deux espaces isolés : un membre de A ne lit rien de B, et la réponse ne distingue pas un espace inconnu. Révocation effective à la requête suivante. Un lecteur ne peut pas écrire. Mode local (E11). Exemples produits par le serveur réel.

Écarts de réalisation :

- L'agent de test a trouvé trois défauts, corrigés. Le plus grave : un nom de groupe contenant un demi-code UTF-16 isolé faisait échouer le pilote au milieu d'un message ; la connexion, rendue au pool désynchronisée, faisait ensuite échouer toutes les requêtes du serveur. Deux parades : tout texte qui part en base est validé (ni U+0000, ni demi-code isolé), et la base jette toute connexion sur laquelle le pilote a échoué pour une autre raison qu'une erreur de la base (plan 07). Les deux autres : U+0000 dans un texte, et un JSON très imbriqué, donnaient `500` au lieu de `400`.
- Décisions prises sur les points soulevés : une clé JSON en double est refusée ; une clé inconnue n'est pas renvoyée (le champ en cause est l'objet qui la contient) ; `binding_not_found` ne renvoie pas l'identifiant reçu, et un identifiant hors format n'atteint pas la base ; un corps dépasse au plus 64 Kio ; la recherche de personnes est rognée.
- `create_app` refuse des espaces dont le groupe d'administration diffère de celui de l'identité : `/api/me` et `/api/spaces` ne peuvent pas se contredire.
- L'espace local répond `implicit: true`, pour que la coque n'offre pas la gestion de ses membres.

### 8.3 — Espaces dans la coque

Modifiés : `apps/web/src/App.tsx`, `shell/*`, `catalogue/*`.

- Accueil des espaces (`#/`) : les espaces de la personne, avec son rôle et le rattachement Atlas. « Créer un espace » n'apparaît que pour un administrateur de la plateforme.
- Sélecteur d'espace dans la coque, toujours visible. La pastille dit le rôle dans l'espace courant.
- Les routes sont préfixées par l'espace (`#/espaces/<id>/catalogue`). Un espace absent ou refusé affiche « Espace introuvable », sans rien dire de plus.
- Le prototype graphique reste accessible hors espace, comme démonstration.

Tests : composants, accessibilité axe, parcours Playwright avec réponses simulées, captures de référence.

Écarts de réalisation :

- Le sélecteur d'espace est en tête de la navigation latérale, et non dans la barre supérieure, qu'il faisait passer sur deux lignes à 1280 px.
- L'agent de test a trouvé trois défauts, corrigés : les pages « administration sans rôle » et « espace indisponible » n'avaient pas de titre de niveau 1 ; un accès retiré pendant la lecture du catalogue s'affichait comme une panne du service (une réponse `space_not_found` du catalogue fait désormais relire l'espace) ; un identifiant `.` faisait lire `/api/spaces/` (un identifiant hors du format E1 n'est plus demandé au serveur).
- Décisions prises sur les points soulevés : la liste des espaces est relue à chaque navigation, et l'accueil la reçoit de la coque (une seule lecture) ; l'espace rendu par le serveur doit être celui demandé ; hors d'un espace lisible, le catalogue est marqué « dans un espace » et non « à venir » ; le fil d'Ariane d'un espace sans rôle ne nomme pas le catalogue.
- Le catalogue est ouvert au rôle lecteur, comme le dit E9 ; les écrans §0.1 le réservaient au créateur. E9 prévaut.
- À sa seconde passe, l'agent de test a trouvé une boucle : un espace reconfirmé alors que son catalogue répond `space_not_found` relançait sans fin la relecture. L'espace n'est plus relu qu'une fois par navigation ; le catalogue reste alors en échec affiché.

### 8.4 — Membres et rôles, création d'un espace

Créés : `apps/web/src/spaces/` (écran d'administration).

- Écran « Membres et rôles » (écrans §9), réservé aux administrateurs. Il liste les liaisons : groupe ou personne, rôle, auteur, date. On peut ajouter une liaison de groupe, en saisissant son nom exact, ou de personne, en la cherchant par nom ou par adresse. On peut changer un rôle ou retirer une liaison, avec confirmation. Le refus du dernier administrateur s'affiche avec sa raison.
- Rappel permanent : « Un rôle ne donne aucun droit sur les données. »
- Journal de l'espace, en lecture.
- Création d'un espace : identifiant, nom, premier administrateur.

Tests : composants, axe, parcours Playwright, captures.

## 4. Rayon d'impact

Nouveau paquet `skifer_board.spaces`, révision `0003`, `server.py` (routes du catalogue déplacées), `identity` (personnes, administration de la plateforme), coque web et catalogue web (routes par espace), `contracts/espaces/`, et `contracts/catalogue/` (les adresses changent, pas les corps). Les specs Playwright du catalogue suivent les nouvelles adresses.

## 5. Hors de cette tranche

- **Environnements** et droit de déployer par environnement : tranche suivante du lot 02.
- **Plusieurs dépôts Atlas**, un par espace.
- **Invitations** à accepter ou refuser (écrans §1.1) : l'appartenance est immédiate dans cette tranche.
- **Partage de contenus** : lot 05.
- **Accueil de l'espace** enrichi (dashboards, analyses) : lots 06 à 08.

## 6. Risques

| Risque | Parade |
|---|---|
| Un groupe renommé chez le fournisseur fait perdre l'accès à ses membres. | La liaison garde le nom exact. Le renommage est visible dans l'écran d'administration, qui montre que personne ne la porte plus, et un administrateur de la plateforme peut réparer. |
| Le claim des groupes absent ou tronqué chez certains fournisseurs (au-delà d'un nombre de groupes). | Aucun rôle n'est déduit d'un groupe absent : fail-closed. Un essai sur le fournisseur choisi est déjà prévu (plan 06, §6). |
| Fuite de l'existence d'un espace. | Même réponse pour inconnu et non-membre (E7), testée. |
| Le rôle recalculé à chaque requête coûte une lecture en base. | Une requête indexée par espace. C'est léger, et mesuré par la tranche télémétrie. |

## 7. Vérification

`pnpm run check` complet. Pour chaque sous-tâche, une régression volontaire, puis rétablie, confirme que le filet l'attrape.
