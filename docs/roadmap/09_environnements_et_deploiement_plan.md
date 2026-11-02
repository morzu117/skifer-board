# Plan 09 — Environnements et droit de déployer (lot 02, quatrième tranche)

Date : 2 novembre 2026 · Statut : **en cours**. Quatrième tranche du lot 02 (« socle partagé »), après les espaces et les rôles (plan 08). Choix du porteur du 2 novembre, qui suit les recommandations : **trois environnements fixes `DEV`, `TEST`, `PROD`**, **un rôle valable dans tous les environnements**, **un droit de déployer explicite par environnement, sans droit d'office pour les administrateurs**, **paramètres de déploiement dans une tranche suivante**. Claude développe ; les tests sont écrits par un agent Claude distinct (plan 03, T1).

Plan parent : [plan de développement](../plan-de-developpement.md), §2 (droit de déployer par environnement), §4.1 (objet Environnement), §5 (environnements et déploiement), §8 lot 02, §10 et §10.1 (nommage des environnements). Écrans : [écrans et fonctionnalités](../ecrans-et-fonctionnalites.md), §0.1 (déployeur), §0.5 (coque), §9 (administration, « Environnements »). Design : `docs/design/RULES.md` §9, `DESIGN-SYSTEM.md` §1 et §5 (bascule `DEV | TEST | PROD`, pipeline d'environnements).

## 1. Point de départ

- Un espace a des membres et des rôles, recalculés à chaque requête (plan 08). Le serveur refuse ce que le rôle ne permet pas.
- La coque affiche une bascule `DEV | TEST | PROD`, mais elle ne vient de nulle part : c'est un état local de la page, le même pour tous les espaces.
- Aucun droit ne dépend d'un environnement. Rien ne se déploie encore : les releases arrivent avec le lot 09.

## 2. Décisions

| # | Décision | Écartée |
|---|---|---|
| V1 | **Trois environnements fixes.** Chaque espace a `DEV`, `TEST` et `PROD`, dans cet ordre de promotion, invariable (RULES §9). Ils sont créés avec l'espace, dans la même transaction ; la migration les crée pour les espaces existants. Un code d'environnement hors de ces trois ne désigne rien. La correspondance avec les environnements de skifer (`LOCAL / DEV / QA / PROD`, §10) est reportée au lot 03, qui en a besoin pour les connexions. | Nommage libre par espace (orientation du §10.1) : contraire aux règles de design et à la bascule de la coque ; il reste possible plus tard, par un libellé ajouté au code. |
| V2 | **Un rôle vaut pour les trois environnements.** Le seul droit propre à un environnement est celui de déployer. Restreindre la lecture par environnement (écrans §0.5) se décidera avec les dashboards publiés (lot 06). | Un droit de lecture par environnement dès maintenant : rien ne se lit encore par environnement. |
| V3 | **Droit de déployer par accord explicite.** Un accord associe, dans un espace et pour un environnement, un **groupe du fournisseur** ou une **personne** (mêmes règles que les liaisons, plan 08, E3). Une personne peut déployer dans un environnement si un accord y correspond à sa session **et** si son rôle dans l'espace est créateur ou plus (écrans §0.1 : « Déployeur = Créateur + déploiements »). Un accord à quelqu'un qui n'est que lecteur reste sans effet, et l'écran le dit. | Droit porté par la liaison de rôle : un groupe qui déploie n'est pas toujours celui qui donne le rôle, et abaisser un rôle obligerait à retirer en silence ses droits de déployer. |
| V4 | **Pas de droit d'office.** Un administrateur de l'espace ne déploie pas sans accord ; il peut s'en accorder un, et le journal le montre. L'administration de la plateforme n'est pas un rôle dans l'espace (plan 08, E6) : elle gère les accords mais ne déploie pas. « Qui peut déployer en PROD » se lit ainsi sur une seule liste. | L'administrateur déploie partout : la liste des déployeurs ne dirait plus qui peut activer une release en PROD. |
| V5 | **Gestion des accords** par les administrateurs de l'espace et de la plateforme, comme les liaisons. Accorder un droit déjà accordé ne change rien et n'est pas journalisé (plan 08, E12). Retirer une liaison de rôle ne retire aucun accord : ils sont indépendants. Une personne s'accorde parmi les personnes connues (plan 08, E5). | — |
| V6 | **Journal.** Accord et retrait sont journalisés (`deploy_granted`, `deploy_revoked`) avec l'environnement, le principal, l'auteur et l'instant, dans le journal de l'espace (plan 08, E10). | — |
| V7 | **Vérification côté serveur.** Le droit est recalculé à chaque requête, comme le rôle. Le serveur expose, pour l'espace courant, ses environnements et, pour chacun, si la personne peut y déployer. Une garde de route « déployeur de l'environnement » est livrée et testée, pour les routes de déploiement du lot 09 : elle refuse par `403 forbidden` avec `required: "deploy"` et l'environnement. | Laisser la vérification au lot 09 : le lot 02 doit livrer « les droits de déploiement vérifiés côté serveur ». |
| V8 | **Mode local.** L'espace implicite a les trois environnements ; la personne locale peut déployer dans chacun, puisque c'est une boucle de développement. Les accords ne s'y gèrent pas (`409 local_mode`, plan 08, E11). | — |
| V9 | **Refus à codes fermés.** `grant_not_found` (404) pour un accord inconnu, `unknown_person` (422), `invalid_request` avec le champ en cause (environnement hors des trois compris), `local_mode` (409), `forbidden` (403), `space_not_found` (404). | — |
| V10 | **Hors de cette tranche** : règles de validation en PROD (droit simple ou approbation, arbitrage ouvert « avant lot 09 ») ; paramètres de déploiement déclarés et valeurs par environnement (§5.1, plan 10) ; release active. | — |

## 3. Sous-tâches

Chaque point est un commit `feat(plan09-x.y)` avec son entrée de changelog. Claude relit les tests, lance le gate complet et commite.

### 9.1 — Modèle, migration et décision de déploiement

Créés : révision `0004`. Modifiés : `apps/api/src/skifer_board/spaces/` (modèle, magasin, décision d'accès), `state/schema.py`.

- Tables `space_environments` (espace, code, rang de promotion) et `deploy_grants` (espace, environnement, principal, auteur, date ; unique par espace, environnement et principal).
- `can_deploy(identity, role, grants, environment) -> bool`, fonction pure (V3, V4).
- Magasin : environnements d'un espace ; accords d'un espace ; accorder et retirer, en une transaction qui verrouille l'espace, avec le journal (V5, V6) ; création d'un espace avec ses trois environnements (V1).
- Décision d'accès : l'accès à un espace porte, pour chaque environnement, le droit de déployer de la personne (V7, V8).

Tests : décision sur toutes les combinaisons (aucun accord, accord de groupe, de personne, rôle lecteur, créateur, administrateur, administration de la plateforme seule, accord dans un autre environnement ou un autre espace, même sujet chez un autre émetteur) ; accord idempotent sans journal ; journal complet ; isolation de deux espaces ; migration d'une base vierge et d'une base en révision `0003` qui a déjà des espaces.

### 9.2 — Routes

Modifiés : `spaces/web.py`. Exemples versionnés dans `contracts/espaces/`.

- `GET /api/spaces` et `GET /api/spaces/{espace}` : chaque espace porte ses environnements dans l'ordre de promotion, et pour chacun `deploy`, le droit de la personne.
- `GET` et `POST /api/spaces/{espace}/deploy-grants`, `DELETE /api/spaces/{espace}/deploy-grants/{accord}` : réservés aux administrateurs de l'espace et de la plateforme. Corps `{environment, principal}`.
- Le journal raconte les accords et les retraits.
- La garde « déployeur de l'environnement » (V7), rendue par `install_spaces` comme celle du lecteur.

Tests : chaque route avec chaque rôle, non-membre et administration de la plateforme seule ; un lecteur ne peut pas accorder ; révocation effective à la requête suivante ; garde du déployeur sur une route de test ; mode local ; exemples produits par le serveur réel.

### 9.3 — Environnements dans la coque

Modifiés : `apps/web/src/App.tsx`, `shell/*`, `spaces/*`.

- Dans un espace, la bascule montre les environnements que le serveur a rendus, toujours dans l'ordre `DEV | TEST | PROD`, chacun avec la marque du droit de déployer. Hors d'un espace, elle reste celle d'aujourd'hui.
- Sous la pastille du rôle, les droits de déployer de la personne (« Déploiement : DEV, TEST » ou « Déploiement : aucun »).
- L'environnement choisi reste un état de la coque ; son adresse se décidera avec les dashboards publiés (lot 06).

Tests : composants, axe, parcours Playwright, captures.

### 9.4 — Écran « Environnements »

Créés : `apps/web/src/spaces/` (écran d'administration).

- Écran « Environnements » (`#/espaces/<id>/environnements`, écrans §9), réservé aux administrateurs, à côté de « Membres et rôles » ; les deux écrans sont reliés par des onglets.
- Les trois environnements dans leur ordre de promotion (pipeline du design system), et pour chacun ses accords : groupe ou personne, auteur, date.
- Accorder un droit à un groupe par son nom exact ou à une personne connue, retirer un accord avec confirmation.
- Rappel permanent : un droit de déployer n'a d'effet qu'avec le rôle créateur ou plus, et ne donne aucun droit sur les données.
- Le journal de l'espace raconte les accords et les retraits.

Tests : composants, axe, parcours Playwright, captures.

## 4. Rayon d'impact

Paquet `skifer_board.spaces`, révision `0004`, `contracts/espaces/` (les espaces gagnent leurs environnements), coque web (bascule et droits), écrans d'administration. Les specs Playwright existantes suivent la nouvelle forme des réponses d'espace.

## 5. Hors de cette tranche

- **Paramètres de déploiement** déclarés et valeurs par environnement (§5.1) : plan 10.
- **Règles de validation en PROD** : arbitrage ouvert du §10, avant le lot 09.
- **Releases**, activation et retour arrière : lot 09.
- **Correspondance avec les environnements de skifer** et liaisons de connexion par environnement : lot 03.
- **Lecture restreinte par environnement** : avec les dashboards publiés (lot 06).

## 6. Risques

| Risque | Parade |
|---|---|
| Un accord de groupe donne le droit à des personnes qui ne sont que lectrices. | Sans effet sous le rôle créateur (V3), testé ; l'écran le rappelle. |
| Un administrateur s'accorde le droit de déployer en PROD sans contrôle. | Le journal le montre (V6) ; les règles de validation en PROD restent à arbitrer avant le lot 09. |
| Une base migrée laisse un espace sans environnement. | La migration crée les trois pour chaque espace existant, testée sur une base en `0003` peuplée. |
| La bascule de la coque laisse croire qu'on peut déployer. | Elle ne fait que choisir l'environnement affiché ; le droit est marqué à part, et le serveur reste seul juge. |

## 7. Vérification

`pnpm run check` complet. Pour chaque sous-tâche, une régression volontaire, puis rétablie, confirme que le filet l'attrape.
