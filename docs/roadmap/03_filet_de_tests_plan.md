# Plan 03 — Filet de tests : unitaires, non-régression, bout en bout

Date : 1er novembre 2026 · Statut : **rédigé**, lancé sur demande du porteur (« comme ce projet est sensible, on va le couvrir de tests, back, unit, non-regression, et front, donc tu développes la feature et tu demandes à codex de mettre en place les tests »).

## 1. Contexte

Les plans 01 et 02 sont livrés avec une couverture de lignes et de branches à 100 %, côté API comme côté web. Une couverture complète dit que chaque ligne s'exécute, pas que chaque comportement est vérifié. Ce plan ajoute trois filets :

- des **propriétés** qui vérifient les règles de calcul sur des données générées, pas seulement sur des exemples ;
- une **non-régression** qui fige les décisions et les rendus, pour qu'un changement soit toujours délibéré ;
- des tests **de bout en bout** dans un vrai navigateur, sur le build de production.

## 2. Décisions

| # | Décision | Écartée |
|---|---|---|
| T1 | **Répartition des rôles.** Claude développe les fonctionnalités et installe l'outillage. Codex écrit les tests, sans modifier le code de production. Un défaut trouvé par Codex est rendu sous forme de test en échec et signalé ; Claude corrige le code dans le même point de plan. | Le développeur écrit seul ses tests : le testeur partage alors les angles morts du code. |
| T2 | **Propriétés côté API** avec Hypothesis (MPL-2.0, dépendance de développement). | Exemples seuls : ils ne couvrent que les cas imaginés. |
| T3 | **Table de décisions de référence** côté API : chaque combinaison type de métrique × additivité × opération × portée × complétude a un résultat attendu (valeur ou raison de refus) dans un fichier versionné. Un changement de règle met à jour ce fichier dans le même commit. | Instantanés opaques générés : ils se régénèrent sans être relus. |
| T4 | **Accessibilité en test unitaire** avec axe-core (MPL-2.0) dans jsdom, sur chaque composant rendu. | Contrôle manuel seul. |
| T5 | **Instantanés des options graphiques** : chaque constructeur produit une option sérialisée et comparée à un instantané versionné, sous les deux thèmes. Les fonctions de formatage sont sérialisées par leur sortie sur des valeurs témoins. | Comparaison d'images seule : elle ne dit pas quelle option a changé. |
| T6 | **Bout en bout et régression visuelle** avec Playwright (Apache-2.0) et `@axe-core/playwright` (MPL-2.0), sur `vite preview` du build de production. Le navigateur est le Chrome installé sur le poste (`channel: "chrome"`) : aucun téléchargement de navigateur. | Cypress : licence du service de tableau de bord, navigateur embarqué. |
| T7 | **Gate.** Un script `check:e2e` rejoint `pnpm run check`, après `check:web`. | E2E hors gate : il cesse d'être lancé. |

## 3. Sous-tâches

Chaque point est un commit `feat(plan03-x.y)` avec son entrée de changelog. Claude installe les dépendances et relit le diff de Codex avant de commiter.

### 3.1 — API : propriétés et table de décisions

Fichiers créés : `apps/api/tests/contextual/test_properties.py`, `apps/api/tests/contextual/test_decisions.py`, `apps/api/tests/contextual/decisions.yaml`.

Propriétés minimales :

1. Le total d'une sélection sur une métrique additive est égal à la somme Arrow des lignes sélectionnées.
2. Une sélection vide ou complète se comporte comme le résultat chargé.
3. Les sous-totaux d'un regroupement se somment au total, pour une métrique additive.
4. `min` et `max` réagrégés sont le minimum et le maximum des lignes concernées.
5. Une moyenne recalculée depuis ses composantes est égale à la moyenne pondérée des lignes.
6. Un refus est toujours un `Unavailable` avec raison et requête au moteur, jamais un nombre.
7. Un résultat tronqué ou top-N ne produit jamais un total présenté comme complet.
8. Les parts d'une partition complète se somment à 1, à la tolérance flottante près.
9. L'ordre des lignes ne change aucun résultat.

### 3.2 — Web : accessibilité et instantanés d'options

Fichiers créés : tests `*.a11y.test.tsx` à côté des composants, `apps/web/src/charts/specs/options.snapshot.test.ts` et son dossier `__snapshots__`.

- axe-core sur la coque, chaque composant de `ui`, la tuile de graphique dans ses deux onglets, la barre de sélection et la page du prototype, sous les deux thèmes.
- Instantanés des options des cinq constructeurs et de leurs formes étroites.

### 3.3 — Web : bout en bout et régression visuelle

Fichiers créés : `apps/web/playwright.config.ts`, `apps/web/e2e/*.spec.ts`, captures de référence versionnées.

Parcours minimaux :

1. Navigation de la coque : entrées « à venir » non cliquables, bascule d'environnement dans l'ordre `DEV | TEST | PROD`.
2. Bascule de thème : les valeurs affichées ne changent pas.
3. Sélection à la souris et au clavier dans l'histogramme : le tableau voisin se filtre, la barre de sélection dit « non disponible » pour le total, Échap désélectionne.
4. Onglets Graphique et Tableau au clavier.
5. Aucun défilement horizontal de page à 390, 768 et 1280 px.
6. Analyse axe de la page entière, sous les deux thèmes.
7. Captures de référence de la page, sur ordinateur et sur téléphone, sous les deux thèmes.

## 4. Rayon d'impact

Ajouts de tests et d'outillage de test uniquement, hors correction d'un défaut que Codex trouverait. Fichiers partagés modifiés : `package.json` racine (script `check:e2e`), `apps/web/package.json` et `apps/api/pyproject.toml` (dépendances de développement), `apps/web/vite.config.ts` et `apps/web/eslint.config.js` pour inclure ou exclure les nouveaux dossiers. L'index structurel n'existe pas pour ce dépôt ; aucun rayon d'impact outillé ne peut être établi.

## 5. Risques

| Risque | Parade |
|---|---|
| Les captures de référence dépendent de la machine : polices, rendu, système. | Captures suffixées par plateforme, tolérance de pixels bornée, polices auto-hébergées. Une intégration continue sous Linux aura ses propres références. |
| Un test de propriété est lent ou instable. | Nombre d'exemples borné, graine fixée en gate, cas trouvés conservés comme exemples. |
| Codex modifie le code de production pour rendre un test vert. | Brief explicite, puis relecture du diff fichier par fichier avant commit. |
| Un instantané se régénère sans être relu. | Mise à jour d'instantané seulement dans un commit qui l'annonce dans le changelog. |
| Chrome absent sur une autre machine. | Erreur explicite de Playwright ; installation d'un navigateur Playwright documentée, jamais silencieuse. |

## 6. Vérification

`pnpm run check` complet : API, web, bout en bout, YAML et changelog. Un test volontairement cassé par sous-tâche, puis rétabli, confirme que le filet attrape une régression.
