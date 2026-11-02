# Plan 07 — Persistance de l'état et migrations (lot 02, deuxième tranche)

Date : 2 novembre 2026 · Statut : **à réaliser**. Deuxième tranche du lot 02 (« socle partagé »), qui suit le plan 06. Elle applique la décision D-3 : git garde les contenus, une base garde l'état. Choix du porteur du 2 novembre : **PostgreSQL** ; **tests sur une instance locale jetable** ; **SQLAlchemy Core, Alembic et pg8000**. Claude développe. Les tests sont écrits par un agent Claude distinct, plus par Codex, à la demande du porteur (« lance un autre agent claude, mon quota codex est pas très grand ») ; plan 03, T1.

Plan parent : [plan de développement](../plan-de-developpement.md), §8 lot 02 (« persistance et migrations »), §10.1 (PostgreSQL pour les métadonnées de Board), §10.2 D-3. Tranche précédente : [plan 06](06_identite_oidc_plan.md), dont I4 annonçait cette tranche.

## 1. Point de départ

- Board n'a aucune base. Les sessions et les demandes de connexion en cours vivent en mémoire, dans le processus serveur (plan 06, I4).
- Deux conséquences. Un redémarrage déconnecte tout le monde. Et un seul processus serveur peut tourner, car une connexion commencée sur un processus échouerait sur un autre (`invalid_state`).
- Les tranches suivantes du lot 02 (espaces, rôles, environnements), puis les releases, le journal et les événements, ont besoin d'un état durable et partagé.

## 2. Décisions

| # | Décision | Écartée |
|---|---|---|
| P1 | **PostgreSQL** garde l'état de Board : dans cette tranche, les sessions et les demandes de connexion en cours ; plus tard, les espaces, rôles, releases, journal et événements. Les contenus restent dans git (D-3). Toute base compatible PostgreSQL convient, Lakebase compris. | SQLite : un seul processus qui écrit, et une migration vers PostgreSQL plus tard. |
| P2 | **L'invariant « pas de SQL » vise les analyses**, pas l'état de Board. Les requêtes vers la base d'état sont construites par **SQLAlchemy Core** à partir de tables déclarées, jamais écrites en texte ni stockées. Aucune donnée analytique ne passe par cette base. | ORM complet : plus de magie que le besoin. Requêtes écrites à la main : du texte SQL dans Board. |
| P3 | **Migrations Alembic, en avant seulement**, dans le paquet (`skifer_board/state/migrations/`). Elles sont appliquées par une commande explicite, `skifer-board-migrate`, **jamais au démarrage du serveur** : plusieurs processus qui démarrent ensemble ne se disputent pas le schéma. Une migration n'a pas de retour arrière ; on corrige par une nouvelle migration. | Migration automatique au démarrage : course entre processus, et une erreur de schéma devient une panne de démarrage en production. |
| P4 | **Démarrage fail-closed.** Si une base est configurée, le serveur vérifie au démarrage qu'il la joint et que son schéma est exactement à la dernière révision connue. Sinon il **refuse de démarrer** avec un message qui nomme la cause (base injoignable, base vide, schéma en retard ou en avance) et la commande à lancer. | Démarrer quand même et échouer à la première requête. |
| P5 | **Avec OIDC, la base est obligatoire.** Une configuration OIDC sans `SKIFER_BOARD_DATABASE_URL` est un refus de démarrer. Sans OIDC (mode local, boucle locale), la base reste facultative, car il n'y a ni session ni demande de connexion à garder. Le magasin en mémoire du plan 06 ne sert plus qu'aux tests. | Repli silencieux sur la mémoire : on croirait avoir plusieurs processus fiables. |
| P6 | **Sessions en base, mêmes règles qu'en mémoire.** Le serveur ne garde que l'empreinte SHA-256 de l'identifiant (I4), avec l'identité vérifiée : émetteur, sujet, nom, adresse et groupes, sans aucun jeton du fournisseur (I5). La lecture d'une session prolonge son activité **en une seule instruction atomique**, conditionnée à sa validité. Deux processus ne peuvent donc pas ressusciter une session expirée. Les sessions expirées sont purgées à la création d'une session. | Lecture puis écriture séparées : une course entre processus peut prolonger une session déjà expirée. |
| P7 | **Demandes de connexion en base.** Une demande garde l'empreinte de son `state`, le `nonce`, le vérificateur PKCE et l'empreinte du lien navigateur, pour 10 minutes au plus. Le retour la **consomme atomiquement** (suppression qui rend la ligne) : l'usage unique tient entre processus. Le vérificateur PKCE est un secret à courte vie, inutile sans le code ; il est effacé à la consommation ou à la purge. | Garder les demandes en mémoire : une connexion commencée sur un processus échouerait sur l'autre. |
| P8 | **Horloge de Board, pas celle de la base.** Les instants écrits et comparés viennent de l'horloge injectée du serveur, en UTC, dans des colonnes `timestamptz`. Les tests restent déterministes et l'expiration a une seule source. | `now()` de PostgreSQL : deux horloges, et des tests qui dépendent du temps réel. |
| P9 | **Tests sur une instance PostgreSQL locale jetable.** pytest crée un cluster temporaire avec `initdb`, joignable seulement par un fichier socket local, sans aucune écoute réseau (`listen_addresses=''`). Il donne une base vierge à chaque test et détruit le cluster à la fin. Les binaires PostgreSQL sont exigés, trouvés par `PATH` ou `pg_config`. S'ils manquent, **le gate échoue**, il ne saute pas les tests. | Docker : démon requis et image à télécharger. SQLite en test : un autre dialecte que la production. |
| P10 | **Secret de connexion.** L'adresse de la base peut contenir un mot de passe. Elle n'apparaît ni dans une représentation d'objet, ni dans un journal, ni dans un message d'erreur. Les erreurs nomment l'hôte et la base, jamais l'adresse complète. | — |

Dépendances nouvelles, toutes à licence permissive (I7) : **SQLAlchemy** (MIT), **Alembic** (MIT) et **pg8000** (BSD-3-Clause), avec leurs dépendances transitives : Mako (MIT), scramp (MIT) et ce qu'elles tirent. Les licences sont vérifiées à l'installation et listées dans le changelog.

## 3. Sous-tâches

Chaque point est un commit `feat(plan07-x.y)` avec son entrée de changelog. Claude relit les tests, lance le gate complet et commite.

### 7.1 — Base, schéma et migrations

Créés : `apps/api/src/skifer_board/state/{__init__,config,schema,database,migrate}.py`, `state/migrations/` (environnement Alembic et première révision), `apps/api/tests/state/` (fixture PostgreSQL jetable). Modifiés : `server.py`, `pyproject.toml`, le verrou.

- `DatabaseConfig` lu depuis `SKIFER_BOARD_DATABASE_URL`, adresse `postgresql+pg8000://…`. Une adresse malformée, ou d'un autre pilote, est un refus qui nomme la variable sans en recopier la valeur (P10).
- `schema.py` déclare les tables avec SQLAlchemy Core : `sessions` et `login_requests` (P6, P7).
- Première révision Alembic : création de ces deux tables. Commande `skifer-board-migrate` : applique les révisions jusqu'à la dernière, et rend un code de sortie non nul en cas d'échec.
- `check_schema(engine)` : base joignable et révision égale à la dernière (P4). Le serveur l'appelle au démarrage si une base est configurée ; règle d'OIDC sans base (P5).

Tests :

- migration d'une base vierge jusqu'à la dernière révision ; rejouer la commande ne change rien ;
- après migration, la base et les tables déclarées dans `schema.py` sont identiques : comparaison d'Alembic sans aucun écart ;
- démarrage refusé pour une base injoignable, vide, en retard d'une révision ou portant une révision inconnue ; message sans mot de passe ;
- OIDC sans base : refus de démarrer ; mode local sans base : démarrage comme aujourd'hui ;
- adresse malformée ou d'un autre pilote refusée.

### 7.2 — Sessions et demandes de connexion en base

Créés : `state/sessions.py` (`PgSessionStore`, `PgLoginRequests`). Modifiés : `identity/flow.py` (les demandes en cours passent par une interface), `identity/web.py` (`build_runtime` reçoit la base), `server.py`.

- `PgSessionStore` réalise l'interface `SessionStore` du plan 06 selon P6.
- `LoginRequests`, nouvelle interface : `put` à l'ouverture, `take` au retour, en consommation atomique. Deux réalisations : en mémoire, pour garder les tests du plan 06, et en base (P7).
- `build_runtime` utilise les réalisations en base quand une base est fournie, ce qui est toujours le cas avec OIDC (P5).

Tests :

- les tests de comportement du magasin de sessions passent sur les deux réalisations : création, lecture, expiration absolue et par inactivité, suppression, empreinte seule stockée, aucun jeton du fournisseur ;
- **deux serveurs, une base** : une connexion ouverte sur l'un se termine sur l'autre ; une session créée sur l'un est valide sur l'autre ; une déconnexion sur l'un la révoque pour l'autre ;
- **redémarrage** : un nouveau serveur sur la même base reconnaît la session ;
- usage unique entre processus : le même `state` présenté deux fois, à deux serveurs, n'ouvre qu'une session ;
- une session expirée n'est jamais prolongée, même si la lecture et l'expiration se croisent ;
- purge des sessions et des demandes expirées ;
- aucune colonne ne contient un identifiant de session en clair, un jeton du fournisseur ou le secret client.

## 4. Rayon d'impact

Nouveau paquet `skifer_board.state`, `identity/flow.py` et `identity/web.py` (interfaces des magasins), `server.py` (démarrage), `pyproject.toml` et verrou, `CHANGELOG.md`. Rien côté web. Les exemples de `contracts/identite/` ne changent pas : le contrat HTTP reste celui du plan 06.

## 5. Hors de cette tranche

- **Espaces, appartenance et rôles** : leur plan ajoutera ses tables par de nouvelles révisions.
- **Journal et événements** : avec les releases (lots 06 à 09).
- **Sauvegarde, rétention et exploitation de la base** : choix de l'hébergement, à faire avec le déploiement.
- **Télémétrie** (§10.3, volumes et performance) : tranche à part du lot 02.

## 6. Risques

| Risque | Parade |
|---|---|
| Les binaires PostgreSQL manquent sur un poste ou une future CI. | Le gate échoue avec un message qui dit quoi installer ; aucun test n'est sauté (P9). |
| Chemin de socket trop long sur macOS (104 caractères). | Le cluster de test vit dans un répertoire temporaire court, sous `/tmp`. |
| Une migration écrite à la main diverge des tables déclarées. | Test de comparaison Alembic sans écart (7.1). |
| Une écriture à chaque requête authentifiée, pour l'activité. | Une seule instruction par requête, sur la clé primaire. C'est léger pour un état de cette taille, et mesuré par la tranche télémétrie. |
| pg8000 est plus lent que psycopg. | Sans importance pour cet état ; changer de pilote ne toucherait que l'adresse de connexion. |

## 7. Vérification

`pnpm run check` complet. Pour chaque sous-tâche, une régression volontaire, puis rétablie, confirme que le filet l'attrape.
