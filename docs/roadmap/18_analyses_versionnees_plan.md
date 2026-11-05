# Plan 18 — Analyses versionnées (lot 06a)

Date : 5 novembre 2026 · Statut : plan commité avant code ; 18.1 à 18.5c à faire. Premier plan du lot 06, ouvert sur l'Explorateur du [plan 17](17_explorateur_plan.md). Choix du porteur du 5 novembre, qui suivent les recommandations : **dépôt git local, un commit par révision** ; **analyses personnelles dans git comme les autres**, visibilité tenue par l'API ; **analyses seulement**, les métriques adhoc viennent dans un plan suivant. Le développement de chaque tranche est confié à un agent tiré au sort, Claude Sonnet 5.5 pour ce plan, puis relu par l'autre, Codex (gpt-6.1-terra), avant commit.

Sources : [plan de développement](../plan-de-developpement.md), §3.4 (spécification « Dashboard as YAML » v1 de `main`), §4.1–4.6, §5.2, §8 lot 06 et §10.2 (D-3) ; [écrans](../ecrans-et-fonctionnalites.md), §0.2–0.4, §3.3 et §4.1–4.2 ; [maquette des analyses](../design/mockups/02-analyses.html) ; plans [07](07_persistance_plan.md), [08](08_espaces_et_roles_plan.md), [11](11_telemetrie_plan.md) et [17](17_explorateur_plan.md).

## 1. Point de départ

- L'Explorateur (plan 17) compose une demande déclarative : connexion, modèle, métriques, dimensions et filtres typés, validés contre le catalogue déclaré. Il calcule total et part sur une sélection. Rien n'est sauvegardé : la demande et son résultat sont oubliés au changement de contexte.
- D-3 fixe git comme vérité des contenus et la base comme index et état. Aucun dépôt de contenus n'existe encore ; PostgreSQL (plan 07) porte sessions, espaces, rôles, paramètres, télémétrie, connexions et exécutions, jusqu'à la migration 0012.
- Les rôles d'espace sont `reader`, `creator` et `admin` (plan 08). Le plan de développement exige le droit de création pour toute sauvegarde, personnelle comprise (§4.2).
- `main` avait une spécification « Dashboard as YAML » v1 (commit `d850104`, `docs/dashboard_yaml_spec.md`) : JSON Schema source de vérité, validation des deux côtés, corpus de fixtures. Elle est le point de départ du format d'analyse (§3.4), pas un concurrent ; la disposition des dashboards reste au lot 07.
- skifer ne porte ni métrique dérivée ni ratio (SK-11) : une métrique adhoc ne serait pas exécutable par le moteur. Elle est hors de ce plan.

## 2. Décisions

| # | Décision | Conséquence vérifiable |
|---|---|---|
| A1 | **Dépôt de contenus git local.** `SKIFER_BOARD_CONTENT_REPOSITORY` désigne un chemin absolu vers un dépôt git provisionné par l'exploitant. Board y commite chaque révision sous une identité de service configurée ; il ne pousse vers aucun dépôt distant dans ce plan. Les commandes git sont lancées sans shell, avec une liste d'arguments fixe, un environnement réduit et un délai. Un dépôt absent, illisible ou dans un état inattendu répond `content_unavailable` et rien n'est écrit. | Tests sur dépôts jetables ; aucun réseau ; refus de chemin relatif ou de lien symbolique hors dépôt ; aucune commande git dont un argument vient du navigateur sans validation. |
| A2 | **Format `board.analysis/v1`.** Un fichier YAML par analyse, `analyses/<space_id>/<analysis_id>.yaml`, identifiants UUID générés par le serveur. Il contient : identité stable, nom, description, visibilité (`personal` ou `shared`), propriétaire (émetteur et sujet, jamais l'adresse), requête (connexion logique, modèle, métriques, dimensions, filtres, sans environnement : les contenus sont identiques entre environnements), calculs contextuels ordonnés et présentation par défaut. Le JSON Schema de `contracts/analyses/` est la source de vérité, validé côté serveur et décodé strictement côté web. Ni SQL, ni données, ni sélection temporaire, ni secret. | Corpus de fixtures valides et invalides ; tests sentinelles « aucun champ SQL accepté » ; sérialisation canonique stable. |
| A3 | **Révisions immuables.** Chaque sauvegarde crée une révision numérotée et un commit. Une nouvelle révision exige la révision attendue : en cas de concurrence, `revision_conflict` sans écrasement. Une révision passée ne se modifie jamais. Le diff entre deux révisions est structurel (champs ajoutés, retirés, modifiés), calculé sur le contenu validé, pas sur le texte. | Deux sauvegardes concurrentes : une seule réussit ; historique relu depuis git ; diff testé par type de champ. |
| A4 | **Index en base, reconstructible.** Une table d'index (migration 0013) porte espace, identité, nom, propriétaire, visibilité, révision courante, commit, modèle, métriques et état. Git fait foi : une commande de réindexation reconstruit l'index depuis le dépôt, et un écart détecté rend l'analyse `index_stale` plutôt qu'un contenu inventé. | Réindexation sur base vierge ; écart simulé détecté ; aucune lecture de contenu depuis la seule base. |
| A5 | **Droits.** Créer, réviser ou dupliquer exige le rôle `creator` ou `admin` dans l'espace. Une analyse personnelle n'est visible que par son propriétaire, administrateur compris. Une analyse partagée est lisible par tout membre ayant un rôle de lecture ; seul son propriétaire ou un administrateur de l'espace en crée une révision, les autres la dupliquent. Partager n'accorde aucun droit sur les données : ouvrir une analyse exécute avec l'identité et la RLS du lecteur. Mode local et non-membre refusés comme pour les exécutions. | Matrice rôle × visibilité × action ; deux lecteurs exécutent la même analyse partagée et ne voient que leurs lignes. |
| A6 | **Validation à la sauvegarde.** La requête est validée comme une soumission (E3 du plan 17) contre le catalogue déclaré. Un calcul contextuel ne porte que sur une métrique de la requête, avec une opération fermée (`aggregate` ou `share`), un périmètre et un dénominateur admis par la route 17.3. Une règle de réagrégation incompatible connue à la sauvegarde est refusée avec sa raison. À la réouverture, un champ disparu du catalogue rend l'analyse `unresolved_reference`, jamais exécutée par approximation. | Codes de refus fermés et documentés ; tests de réouverture après changement de catalogue. |
| A7 | **Suppression et consommateurs.** La suppression retire le fichier par un commit et garde l'historique. Elle est refusée tant que l'analyse a des consommateurs, avec leur liste ; avant le lot 07, la liste est toujours vide et le contrôle est en place. | Suppression puis lecture de l'historique ; refus simulé avec un consommateur. |
| A8 | **Événements d'usage durables.** Sauvegarde, ouverture et exécution depuis une analyse produisent un événement à identifiant unique, en base, insérable deux fois sans doublon. L'exécution reçoit une référence d'analyse optionnelle `{id, revision}` que le serveur vérifie avant de l'accepter. Les événements ne portent ni valeurs de filtres ni données. Ils préparent le lot 10 sans rien transmettre. | Rejeu sans doublon ; référence d'une autre personne ou d'un autre espace refusée ; test de confidentialité de la télémétrie. |
| A9 | **Écrans.** Liste des analyses (mes analyses, partagées), fiche analyse avec les onglets Requête, Calculs contextuels, Présentation par défaut, Révisions avec diff, Consommateurs, Usage et Preuves de la dernière exécution du lecteur. Dans l'Explorateur, « Sauvegarder comme analyse » et, pour une analyse ouverte, « Nouvelle révision » ou « Dupliquer », avec l'écran d'impact. Tous les états du §0.2 des écrans. | Tests de composants à 100 %, Axe sous les deux thèmes, parcours Playwright et captures ordinateur et téléphone. |

## 3. Tranches et commits

Chaque tranche a ses tests, une entrée dans `CHANGELOG.md` sous `Unreleased` et un commit `feat(plan18-18.x)`. Les tests sont hors réseau, sans clé ni cluster, sur dépôts git et bases jetables.

### 18.1 — Dépôt de contenus et format

Adaptateur git unique (A1), format `board.analysis/v1` avec son JSON Schema et ses fixtures (A2), écriture d'une révision avec révision attendue et lecture de l'historique (A3). Verrou entre processus et contrôle de la référence avant mise à jour. Codes fermés : `content_unavailable`, `revision_conflict`, `invalid_analysis`.

### 18.2 — Index, droits et routes

Migration 0013 et réindexation (A4). Routes sous `/api/spaces/{space_id}/analyses` : créer, lister, lire une révision, créer une révision, dupliquer, supprimer, historique et diff (A3, A5, A7). Validation contre le catalogue (A6). Contrats d'exemple produits par le serveur réel, télémétrie des nouvelles opérations, tests de permissions, de mode local et de confidentialité.

### 18.3 — Référence d'analyse et événements d'usage

Référence d'analyse optionnelle dans la soumission d'exécution, vérifiée par le serveur, et événements durables (A8). Lecture de l'usage d'une analyse pour sa fiche.

### 18.4 — Contrat web

Décodeurs stricts et clients des routes 18.2 et 18.3, sur les contrats d'exemple, avec leurs tests.

### 18.5 — Écrans

Comme 17.4, en trois commits : `feat(plan18-18.5a)` pour la liste et la fiche, `feat(plan18-18.5b)` pour la sauvegarde, la révision et la réouverture depuis l'Explorateur, `feat(plan18-18.5c)` pour les parcours navigateur et les captures (A9).

## 4. Acceptation du plan

Un créateur sauvegarde une exploration comme analyse personnelle, la rouvre avec la même intention, en crée une révision puis la partage. Un lecteur de l'espace l'ouvre, l'exécute avec ses propres droits et ne voit que ses lignes ; il ne peut ni la modifier ni voir les analyses personnelles des autres. Deux sauvegardes concurrentes ne s'écrasent pas. L'historique et le diff des révisions sont relus depuis git ; l'index se reconstruit depuis le dépôt. Un calcul contextuel invalide est refusé avec sa raison, et une référence disparue du catalogue est signalée au lieu d'être exécutée. Aucun SQL n'est écrit dans le dépôt.

Le lot 06 n'est pas déclaré livré : les métriques adhoc et leur empreinte sémantique (plan suivant, dépendant de SK-11), les consommateurs réels (lot 07) et le transport des analyses dans une release (lot 09) restent à planifier.

## 5. Risques et hors périmètre

| Risque | Mesure prévue |
|---|---|
| Une analyse personnelle fuit par la liste, l'historique ou un diff. | Filtre de visibilité appliqué à chaque route, administrateur compris ; tests de fuite par route. |
| Deux processus Board écrivent en même temps dans le dépôt. | Verrou entre processus et mise à jour conditionnelle de la référence ; test concurrent. |
| L'index diverge de git. | Git fait foi, réindexation, état `index_stale`. |
| Une valeur de filtre ou un identifiant de personne fuit dans la télémétrie ou les événements. | Événements sans valeurs ; tests de confidentialité étendus. |
| Le format d'analyse devient un éditeur de requête libre. | Schéma fermé, noms validés contre le catalogue, aucun texte SQL accepté. |

Hors périmètre : métriques adhoc, dashboards et consommateurs réels, partage par lien, poussée vers un dépôt distant, revue par demande de fusion, releases et promotion.
