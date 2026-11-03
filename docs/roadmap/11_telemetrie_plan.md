# Plan 11 — Télémétrie (lot 02, sixième tranche)

Date : 3 novembre 2026 · Statut : **à réaliser**. Sixième et dernière tranche du lot 02 (« socle partagé »), après les paramètres de déploiement (plan 10). Choix du porteur du 3 novembre, qui suit les recommandations : **mesurer dès maintenant ce qui existe**, **jamais la personne ni une valeur**, **mesures brutes en base avec une ligne JSON sur la sortie standard**, **lecture réservée à l'administration de la plateforme**, **rétention de 90 jours**. Claude développe ; les tests sont écrits par un agent Claude distinct (plan 03, T1).

Plan parent : [plan de développement](../plan-de-developpement.md), §8 lot 02, §10 (« Volumes et performance : à étudier à l'usage ; on monitore d'abord. Le lot 02 livre la télémétrie (durée par exécution, lignes, taille, tuiles par dashboard) ; les seuils sont fixés après le pilote »). Écrans : [écrans et fonctionnalités](../ecrans-et-fonctionnalites.md), §9 (administration). Design : `docs/design/RULES.md`, `DESIGN-SYSTEM.md`.

## 1. Point de départ

- L'API sert une vingtaine de routes (identité, espaces, membres, environnements, paramètres, catalogue Atlas) et lit Atlas depuis son dépôt. Rien n'est mesuré ni journalisé côté technique.
- Les exécutions (lot 03) et les dashboards (lot 07) n'existent pas encore : la durée par exécution, les lignes et les tuiles par dashboard ne peuvent pas être mesurées aujourd'hui.
- Les seuils viendront après le pilote : il faut des distributions (médiane, p95, maximum), pas des moyennes calculées d'avance.

## 2. Décisions

| # | Décision | Écartée |
|---|---|---|
| T1 | **Une mesure générique** : genre (`http`, `atlas`), opération, méthode, espace et environnement s'il y en a, issue, durée en millisecondes, lignes et taille en octets s'il y en a, instant. Le lot 03 y branchera les exécutions (genre `execution` : lignes, taille, durée, issue) et le lot 07 les tuiles par dashboard ; rien n'est construit d'avance pour eux. | Attendre le lot 03 : le pilote n'aurait pas de base de comparaison. |
| T2 | **Mesuré dès cette tranche.** Chaque requête de l'API : opération = **gabarit de la route** (`/api/spaces/{space_id}/members`), jamais le chemin brut ; une requête qu'aucune route ne prend est comptée sous l'opération fixe `unmatched`, sans son chemin. Méthode, statut, durée côté serveur de la réception au dernier octet envoyé, taille du corps de réponse, espace quand la route en porte un. Chaque lecture d'Atlas : durée, nombre de documents, taille lue. | Durée vue du navigateur : elle mêle le réseau du poste ; elle viendra, si besoin, avec l'observabilité du lot 10. |
| T3 | **Jamais enregistré** : la personne (ni sujet, ni courriel, ni groupe), un identifiant du chemin autre que l'espace (liaison, accord, nom de paramètre, document), une valeur de paramètre, un corps de requête ou de réponse, un texte de requête, une adresse IP, un en-tête. L'issue est le statut HTTP et, pour un refus, son code fermé (`forbidden`, `space_not_found`…) ; un code hors de la liste connue est rangé sous `other`. On mesure Board, pas les personnes. | Garder la personne pour repérer un usage lourd : c'est de la surveillance d'usage, hors du besoin (fixer des seuils). |
| T4 | **Où vont les mesures.** Une table `telemetry` dans la base d'état (révision `0006`), une ligne par mesure ; et pour chaque mesure une ligne JSON sur la sortie standard (journal `skifer_board.telemetry`), pour le collecteur de l'exploitation. En mode local, sans base, la sortie standard seule. | OpenTelemetry ou Prometheus : un collecteur à faire tourner, et des agrégats trop tôt. Un exporteur pourra s'ajouter plus tard sur la même mesure. |
| T5 | **L'enregistrement ne bloque jamais une requête.** Les mesures passent par une file bornée (10 000), vidée par lots par un fil d'écriture ; file pleine ou base indisponible : la mesure est perdue, **et la perte est journalisée** (compteur de pertes dans un avertissement, au plus une fois par minute). La réponse part inchangée. Ce n'est pas une décision de sécurité : le fail-closed ne s'y applique pas, et rien n'est tu. À l'arrêt du serveur, la file est vidée. | Écrire dans la requête : chaque appel paierait une transaction de plus, et une panne de la table ferait tomber l'API. |
| T6 | **Rétention : 90 jours.** Le fil d'écriture purge les mesures plus anciennes au plus une fois par heure ; une commande `skifer-board-telemetry purge` le fait à la demande pour l'exploitation. Rien ne grossit sans borne. | Purge laissée à l'exploitation seule : oubliée, la table grossirait sans fin. |
| T7 | **Lecture : administration de la plateforme seule** (`GET /api/telemetry?window=24h|7d|30d`, `403 forbidden` sinon, `409 local_mode` sans base). Par genre, opération et méthode : nombre, durée médiane, p95 et maximum, part d'erreurs (5xx) et de refus (4xx), taille médiane et maximale, et pour les lectures d'Atlas, documents médians et maximum. La réponse dit la fenêtre et l'instant de la plus ancienne et de la plus récente mesure. Les centiles sont calculés par la base d'état (`percentile_cont`), par SQLAlchemy Core comme le reste du magasin. | Un tableau de bord par espace : les seuils sont techniques et globaux ; par espace, la télémétrie dirait qui fait quoi. |
| T8 | **Écran « Télémétrie »** (`#/telemetrie`), offert aux administrateurs de la plateforme depuis l'accueil des espaces : fenêtre 24 h / 7 j / 30 j, tableau des opérations trié par p95 décroissant, nombres en chiffres tabulaires, période couverte et âge de la dernière mesure. Mode local et lecture refusée dits tels quels. | — |

## 3. Sous-tâches

Chaque point est un commit `feat(plan11-x.y)` avec son entrée de changelog. Claude relit les tests, lance le gate complet et commite.

### 11.1 — Modèle, migration et magasin

Créés : révision `0006`, `apps/api/src/skifer_board/telemetry/` (modèle et magasin). Modifié : `state/schema.py`.

- Modèle pur : `Measure` (T1), issue normalisée (T3), fenêtres (T7).
- Table `telemetry` (identifiant, instant, genre, opération, méthode, espace, environnement, statut, issue, durée, lignes, taille), index sur l'instant.
- Magasin : enregistrer un lot de mesures, purger avant un instant (T6), résumer une fenêtre (T7).

Tests : chaque champ à ses bornes ; résumé sur des distributions connues (centiles, parts, tailles) ; fenêtre glissante ; purge ; migration d'une base vierge et d'une base en `0005` peuplée.

Écarts de réalisation :
- Le résumé rend des nombres exacts (mesures, erreurs, refus), pas des parts : l'écran les divise pour l'affichage, sans arrondi caché dans la réponse. Une erreur est un 5xx, ou une lecture d'Atlas qui n'a pas abouti ; un refus est un 4xx.
- La fenêtre est `[maintenant − durée, maintenant]`, bornes comprises ; à p95 égal, les opérations se rangent par genre, opération et méthode, dans l'ordre des points de code.
- Lignes, taille et statut doivent être des entiers exacts : un nombre à virgule ou un booléen est refusé, parce que la base l'arrondirait. Le genre doit être un `Kind`. Un instant sans fuseau est refusé à la purge et au résumé, sinon la base le lirait dans le fuseau de sa session. La ligne JSON donne l'instant en UTC, comme la table.
- La liste fermée des codes comprend ceux de l'écart de versions du catalogue (`version_not_found`, `diff_not_supported`, `diff_unavailable`), qu'un test compare aux codes des exemples de contrat et de `server.py`.
- Tests écrits par un agent Claude indépendant. Il a trouvé quatre défauts, corrigés avant le commit : trois codes de refus manquants, des nombres à virgule acceptés pour les lignes, la taille et le statut, et un genre non vérifié. Il a aussi essayé 37 régressions volontaires, toutes attrapées par les tests.

### 11.2 — Mesure des requêtes et d'Atlas

Créés : intergiciel ASGI de mesure, enregistreur (file, fil d'écriture, purge, journal). Modifiés : `server.py`, `catalog/`.

- Intergiciel : gabarit de route, méthode, statut, durée, taille, espace ; `unmatched` sans chemin (T2) ; code de refus lu dans la réponse sans en garder le corps (T3).
- Lecture d'Atlas mesurée : durée, documents, taille.
- Enregistreur : file bornée, lots, pertes journalisées, vidage à l'arrêt, purge horaire (T5, T6) ; ligne JSON sur la sortie standard (T4) ; mode local sans base.
- Commande `skifer-board-telemetry purge`.

Tests : une mesure par requête, gabarit et non chemin ; aucune donnée de T3 dans la table ni dans la ligne JSON, sur toutes les routes ; panne de la base et file pleine sans effet sur la réponse, perte journalisée ; vidage à l'arrêt ; purge.

### 11.3 — Route de lecture

Modifiés : `telemetry/`, `server.py`, `contracts/telemetrie/`.

- `GET /api/telemetry?window=` (T7) ; fenêtre inconnue : `400 invalid_request` avec le champ.
- Exemples de contrat produits par le serveur réel.

Tests : administration de la plateforme, personne sans ce droit, sans session ; mode local ; chaque fenêtre ; aucune donnée de T3 dans la réponse.

### 11.4 — Écran « Télémétrie »

Créés : `apps/web/src/telemetry/`. Modifiés : route, coque, accueil des espaces.

- Écran T8, lien depuis l'accueil pour l'administration de la plateforme seule.
- États : lecture, vide, refus, mode local, panne.

Tests : composants, axe, parcours Playwright, captures.

## 4. Rayon d'impact

Nouveau paquet `skifer_board.telemetry`, révision `0006`, intergiciel de `server.py`, catalogue Atlas, `contracts/telemetrie/`, nouvel écran et lien de l'accueil. Aucune réponse existante ne change de forme.

## 5. Hors de cette tranche

- **Exécutions** (durée, lignes, taille, issue) : lot 03, sur la même mesure.
- **Tuiles par dashboard** : lot des dashboards.
- **Seuils et alertes** : après le pilote.
- **Exporteur OpenTelemetry**, durée vue du navigateur, charge représentative : lot 10 (observabilité).

## 6. Risques

| Risque | Parade |
|---|---|
| Une donnée personnelle ou métier entre dans la télémétrie. | Liste fermée des champs (T1), gabarit de route et jamais le chemin (T2), issue normalisée (T3) ; tests qui parcourent toutes les routes et cherchent sujet, courriel, groupe, identifiants et valeurs dans la table et dans la ligne JSON. |
| La télémétrie ralentit ou fait tomber l'API. | File bornée et fil d'écriture (T5) ; tests de panne de base et de file pleine. |
| Une perte de mesures passe inaperçue et fausse les seuils. | Pertes comptées et journalisées (T5) ; la réponse de lecture dit la période réellement couverte (T7). |
| La table grossit sans fin. | Purge horaire et commande (T6), index sur l'instant. |

## 7. Vérification

`pnpm run check` complet. Pour chaque sous-tâche, une régression volontaire, puis rétablie, confirme que le filet l'attrape.
