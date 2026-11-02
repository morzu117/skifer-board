# Plan 06 — Identité OIDC et sessions (lot 02, première tranche)

Date : 2 novembre 2026 · Statut : **à réaliser**. Première tranche du lot 02 (« socle partagé »), ouverte par la décision D-2 du 2 novembre : **OIDC générique, émetteur configurable, vérificateur strict**. Claude développe ; les tests sont écrits par Codex, ou par un agent Claude distinct si Codex est indisponible (plan 03, T1).

Plan parent : [plan de développement](../plan-de-developpement.md), §4.3 (droits et contexte de consultation), §8 lot 02, §10.2 D-1 et D-2. Écran : pastille d'identité de la coque ([plan 02](02_socle_web_et_prototype_graphique_plan.md), W11).

## 1. Point de départ

- Le serveur (`skifer_board.server`) n'a aucune identité. Il écoute sur `127.0.0.1` par défaut, mais `SKIFER_BOARD_HOST` permet déjà d'écouter ailleurs **sans aucune authentification** : c'est le premier défaut que cette tranche ferme.
- La coque affiche « Identité non établie · données de démonstration » (`IdentityPill`), faute d'identité.
- Les seules données servies sont le catalogue Atlas, en lecture.
- Côté skifer, le modèle d'un vérificateur strict existe : `mcp/auth.py`. Il contrôle l'émetteur, l'audience et la ressource exacts, l'expiration sans tolérance, le type exact des claims et interdit `certification_override`. Board en reprend les règles sans l'importer : la frontière skifer (D-1) sert aux données, pas à l'identité.

## 2. Décisions

| # | Décision | Écartée |
|---|---|---|
| I1 | **Backend pour le navigateur.** Le parcours OIDC est mené par le backend de Board : Authorization Code avec PKCE (`S256`), `state` et `nonce` à usage unique, expirant au bout de 10 minutes. Le navigateur ne voit jamais un jeton du fournisseur ; il ne tient qu'un cookie de session opaque. | Jetons dans le navigateur (SPA publique) : un jeton lisible par le JavaScript est exposé à toute injection de script, et le §4.3 exige que le backend établisse l'identité. |
| I2 | **Vérification stricte du jeton d'identité**, sans tolérance d'horloge. Algorithmes admis : `RS256`, `ES256`, et jamais `none` ni un HMAC. Exigences : `iss` exact ; `aud` contenant l'identifiant client, et `azp` égal à celui-ci si `aud` en contient plusieurs ; `exp` dans le futur ; `iat` présent ; `nbf` passé s'il est présent ; `nonce` égal à celui de la demande ; `sub` chaîne non vide. Tout claim d'un type inattendu est un refus. Chaque refus a un **code fermé** et n'est jamais une identité dégradée. | Bibliothèque OIDC complète (Authlib) : plus de surface que le besoin, et des comportements permissifs à désactiver un à un. |
| I3 | **Clés du fournisseur** lues par la découverte `/.well-known/openid-configuration`, puis le JWKS. Le JWKS est gardé en mémoire et relu une fois quand un `kid` est inconnu, ce qui couvre la rotation des clés, au plus une fois par minute. L'émetteur annoncé par la découverte doit être exactement l'émetteur configuré. | Clés copiées en configuration : la rotation casserait la connexion sans prévenir. |
| I4 | **Session côté serveur.** Identifiant aléatoire de 256 bits. Le cookie s'appelle `__Host-sb_session`, avec `HttpOnly`, `Secure`, `SameSite=Lax` et `Path=/`. Le serveur ne garde que l'empreinte SHA-256 de l'identifiant. Durée absolue de 8 heures, inactivité de 30 minutes, toutes deux configurables. Le magasin est une interface ; sa réalisation dans cette tranche est **en mémoire** : un redémarrage déconnecte tout le monde, ce qui est fail-closed. | Session signée dans le cookie (JWT maison) : non révocable à la déconnexion. Base de données : la persistance du lot 02 est une tranche à part (§5), qui choisira la base. |
| I5 | **Aucun jeton du fournisseur conservé.** Seule l'identité vérifiée est gardée dans la session : émetteur, sujet, nom, adresse, groupes. Les jetons d'accès et de rafraîchissement sont jetés. Le jeton de la personne vers Databricks (D-2) se décide au lot 03, avec le coffre. | Garder les jetons « pour plus tard » : un secret stocké sans usage. |
| I6 | **Toute route `/api` exige une session** quand l'OIDC est configuré. Sans session valide, la réponse est `401` avec le code `unauthenticated` et l'adresse de connexion. Aucun contenu n'est servi à un anonyme, ni rendu « public » par défaut. | Catalogue en accès libre : le §4.3 veut que le backend établisse l'identité avant toute donnée. |
| I7 | **Démarrage fail-closed.** Sans configuration OIDC, le serveur n'écoute que sur une adresse de boucle locale, et `/api/me` dit « identité non établie », comme aujourd'hui. Il **refuse de démarrer** si l'adresse demandée n'est pas locale. Une configuration OIDC incomplète est aussi un refus de démarrer, jamais un repli sur le mode local. | Avertissement au démarrage : un serveur exposé sans identité resterait exposé. |
| I8 | **Protection des requêtes qui modifient.** Toute requête autre que `GET`, `HEAD` ou `OPTIONS` doit porter un en-tête `Origin` égal à l'origine publique configurée de Board, sinon elle reçoit `403` avec le code `origin_refused`. Seule la déconnexion est concernée aujourd'hui. La règle est posée dès maintenant pour les écritures des lots suivants. | Jeton anti-CSRF par formulaire : sans formulaire serveur, `SameSite=Lax` et le contrôle d'origine suffisent. |
| I9 | **Groupes lus, pas encore interprétés.** Le nom du claim des groupes est configurable (`groups` par défaut). Les groupes sont gardés dans l'identité et renvoyés par `/api/me`, mais rien n'en dépend avant la tranche des espaces et des rôles. | Rôles déduits des groupes dès maintenant : l'appartenance aux espaces n'existe pas encore. |
| I10 | **Aucune dépendance réseau dans les tests.** L'accès HTTP au fournisseur (découverte, JWKS, échange du code) passe par une interface injectée. Les tests utilisent un fournisseur simulé qui signe ses jetons avec une clé générée à la volée. | Fournisseur réel en test : réseau et secrets, interdits par `CLAUDE.md`. |

Dépendance nouvelle : **PyJWT** (MIT), avec `cryptography` (Apache-2.0 ou BSD), déjà installé par Atlas. L'accès HTTP du serveur au fournisseur utilise `urllib` de la bibliothèque standard, derrière l'interface d'I10.

## 3. Sous-tâches

Chaque point est un commit `feat(plan06-x.y)` avec son entrée de changelog. Claude relit les tests, lance le gate complet et commite.

### 6.1 — Vérificateur de jeton d'identité

Créés : `apps/api/src/skifer_board/identity/{__init__,config,keys,verify,model}.py`.

- `OidcConfig` : émetteur, identifiant client, secret client, adresse de retour, origine publique, claim des groupes, durées de session. Lecture depuis l'environnement ; une valeur manquante ou malformée est une erreur qui nomme la variable.
- `ProviderKeys` : découverte, JWKS, relecture sur `kid` inconnu au plus une fois par minute (I3).
- `verify_id_token(token, nonce) -> Identity | Refusal` : règles d'I2, refus à codes fermés.

Tests : un fournisseur simulé avec clés RSA et EC générées. Chaque règle d'I2 a son cas de refus : algorithme `none` et HMAC, mauvais émetteur, mauvaise audience, `azp`, expiré d'une seconde, `nbf` futur, `nonce` absent ou différent, `sub` vide ou non textuel, claims de mauvais type. Sont aussi testés la rotation de clé, le `kid` inconnu après relecture, l'émetteur de découverte différent et une configuration incomplète.

### 6.2 — Parcours de connexion et sessions

Modifiés : `apps/api/src/skifer_board/server.py`. Créés : `identity/{flow,sessions}.py`.

- `GET /auth/login` : redirection vers le fournisseur, avec `state`, `nonce` et PKCE.
- `GET /auth/callback` : contrôle du `state`, échange du code, vérification du jeton (6.1), création de la session, redirection vers l'application. Un refus redirige vers l'application avec un code fermé, jamais avec le détail du jeton.
- `POST /auth/logout` : suppression de la session côté serveur et effacement du cookie, sous contrôle d'origine (I8).
- `GET /api/me` : identité de la session et échéance de la session ; sans OIDC, `{"established": false}` ; sans session, `401 unauthenticated`.
- Garde de toutes les routes `/api` (I6), règle de démarrage (I7), contrôle d'origine (I8).
- Exemples versionnés dans `contracts/identite/`, produits par le serveur réel sur le fournisseur simulé.

Tests :

- parcours complet sur le fournisseur simulé ;
- `state` rejoué, inconnu ou expiré ; `nonce` différent ; code refusé par le fournisseur ;
- session expirée par durée absolue et par inactivité ; déconnexion qui révoque côté serveur ;
- cookie aux bons attributs ; empreinte seule en mémoire ;
- `401` sur chaque route `/api` sans session ; `403` sur une modification sans origine ou d'une autre origine ;
- refus de démarrer sur une adresse non locale sans OIDC, ou avec une configuration incomplète ;
- aucun jeton du fournisseur dans la session ni dans une réponse.

### 6.3 — Identité dans la coque

Modifiés : `apps/web/src/shell/*`, `apps/web/src/App.tsx`, `apps/web/src/catalogue/api.ts`.

- Lecture de `/api/me` au démarrage. La pastille dit « Données évaluées pour <nom> » quand l'identité est établie, et reste « Identité non établie » sinon. L'entité n'est pas affichée tant que les espaces n'existent pas : la pastille ne montre aucune entité fictive.
- Sans session : écran « Connexion requise » avec le bouton « Se connecter », sans afficher aucune donnée. Une session expirée pendant l'usage, signalée par un `401` du catalogue, ramène à cet écran, avec la raison.
- Menu de la pastille : « Se déconnecter ».
- Un refus de connexion revenu du fournisseur s'affiche avec son libellé fermé.

Tests : décodeur de `/api/me` sur les exemples versionnés, composants, accessibilité axe, parcours Playwright avec réponses simulées, captures de référence.

## 4. Rayon d'impact

Nouveau paquet `skifer_board.identity`, module `server` (garde de toutes les routes `/api`), coque web, client du catalogue (traitement du `401`), `CHANGELOG.md`, `pyproject` et verrou (PyJWT). Les tests du catalogue existants continuent sans OIDC : le mode local reste servi sur la boucle locale.

## 5. Hors de cette tranche

Les tranches suivantes du lot 02 auront chacune leur plan :

- **Persistance et migrations** : choix de la base pour l'état (D-3), sessions persistantes, migrations depuis une base vierge.
- **Espaces, appartenance et rôles** : groupes → rôles, isolation de deux espaces côté API, un lecteur ne peut pas écrire.
- **Environnements** : configurations distinctes par environnement d'un même espace, droits de déploiement vérifiés côté serveur.
- **Jeton de la personne vers Databricks** : lot 03, avec le coffre.

## 6. Risques

| Risque | Parade |
|---|---|
| Un fournisseur réel s'écarte du simulé (claims, algorithmes, découverte). | Le vérificateur refuse plutôt que d'accepter. Un essai réel sur le fournisseur choisi est à faire avant de déclarer le lot 02 livré, et il est noté comme tel. |
| Sessions en mémoire : un seul processus serveur. | Écrit dans la configuration de lancement ; la tranche persistance lève la limite. |
| Le cookie `Secure` sur `http://localhost` en développement. | Les navigateurs traitent `localhost` comme un contexte sûr. Le développement OIDC se fait sur `localhost`, jamais sur une adresse IP du réseau. |
| Fuite d'un jeton ou d'un secret dans les journaux. | Aucun jeton n'est conservé (I5). Un test vérifie que ni le secret client ni un jeton n'apparaissent dans une réponse ou dans un message d'erreur. |

## 7. Vérification

`pnpm run check` complet. Par sous-tâche, un test volontairement cassé, puis rétabli, confirme que le filet attrape la régression.
