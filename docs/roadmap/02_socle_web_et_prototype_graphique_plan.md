# Plan 02 — Socle web et prototype graphique

Date : 1er novembre 2026 · Statut : **rédigé**, lancé sur accord du porteur (« j'ai déposé les maquettes et le design système tu peux continuer »).

Plan parent : [plan de développement](../plan-de-developpement.md), lot 01 (§8) et prototype de décision (§6.3). Design : [`docs/design/`](../design/README.md), en particulier `RULES.md`, `DESIGN-SYSTEM.md` et les maquettes `01-exploration`, `03-editeur-dashboard` et `04-consultation`.

## 1. Intention

Réaliser le lot 01 : éprouver ECharts sur les cinq cas du §6.3 dans une page composée, avec le design system appliqué, et en tirer une décision de bibliothèque argumentée. Poser au passage le socle web décidé le 31 octobre 2026 (Vite, React, TypeScript) et la coque applicative des maquettes.

Le lot 01 ne dépend d'aucun arbitrage ouvert. Il ne parle à aucun backend : les données sont des jeux de démonstration construits en Arrow dans le navigateur, étiquetés comme tels à l'écran.

## 2. Décisions de ce plan

| # | Décision | Écartée |
|---|---|---|
| W1 | **Workspace pnpm** (`pnpm-workspace.yaml`, membre `apps/web`), script racine `check:web` ajouté au gate `check`. | Dépôt frontend séparé. |
| W2 | **Vite 8, React 19, TypeScript 6.0 strict.** TypeScript 7 est sorti mais `typescript-eslint` 8.72 exige `< 6.1`. | TypeScript 7 : outillage de lint pas encore compatible. |
| W3 | **Vitest 5 + jsdom + Testing Library**, couverture v8 à 100 % des lignes et branches de `src/` hors point d'entrée, comme le seuil de l'API. ESLint avec `typescript-eslint` et `react-hooks`. | Pas de lint, comme Atlas : insuffisant pour un produit partagé. |
| W4 | **Une seule source pour les tokens.** La CSS charge `docs/design/tokens.css` tel quel ; le code TypeScript (thèmes ECharts) lit `docs/design/tokens.json`, déclaré source de vérité par `tokens.css`. Un test vérifie que les deux fichiers portent les mêmes couleurs. Aucune valeur de couleur n'est écrite dans `apps/web`. | Copier les tokens dans l'application : dérive assurée. |
| W5 | **Polices auto-hébergées** (`@fontsource/ibm-plex-sans` et `ibm-plex-mono`, OFL-1.1). Écart aux maquettes, qui chargent Google Fonts : une plateforme auto-hébergée n'appelle pas un service tiers à chaque page. | Google Fonts. |
| W6 | **Arrow dans le navigateur** (`apache-arrow`, Apache-2.0). Les constructeurs d'options graphiques lisent des colonnes Arrow, comme le feront les résultats reçus en Arrow IPC au lot 05. Les jeux de démonstration sont générés par code, jamais recopiés des maquettes (`RULES.md` §7). | Tableaux d'objets JSON : il faudrait réécrire tous les constructeurs au lot 05. |
| W7 | **Un graphique = un constructeur pur** `(données, thème, sélection) → option ECharts`, testé sans rendu. Le composant React ne fait qu'initialiser, redimensionner, relayer les événements et exporter. | Options écrites dans les composants : intestables, et le thème se mélange au calcul. |
| W8 | **Un thème est un jeu de rôles visuels** (sélection, série atténuée, seuil, axe, grille, texte, polices) résolu depuis les tokens. Deux thèmes pour l'épreuve : « Skifer clair » et « Skifer ardoise ». Un test vérifie qu'un changement de thème laisse identiques toutes les valeurs de données des options. | Thème ECharts enregistré globalement : invisible aux tests et global à la page. |
| W9 | **Sélection = événement typé** `{source, dimension, keys}` réduit par un reducer pur, et traduisible en argument `selection` de l'opération `aggregate` du plan 01. C'est le critère « événements exploitables par Board ». Le calcul du total de sélection n'est **pas** branché dans ce plan : la barre de sélection affiche le périmètre et l'état « non disponible » avec sa cause (`RULES.md` §5.5). | Recoder les règles de réagrégation en TypeScript pour la démonstration : deux implémentations des règles. |
| W10 | **Accessibilité des graphiques** : rendu SVG par défaut, `aria-label` généré depuis les données et la sélection, alternative tableau dans un onglet, navigation clavier (flèches pour parcourir, Entrée ou Espace pour sélectionner, annonce `aria-live`). | Rendu canvas par défaut : à reconsidérer seulement si la mesure du §3, 2.5 l'impose. |
| W11 | **Identité non établie affichée comme telle.** Avant le lot 02, la pastille d'identité dit « Identité non établie · données de démonstration », sur le fond neutre et non sur le fond succès. | Afficher une identité fictive : la règle « toujours visible » deviendrait un mensonge. |

## 3. Sous-tâches

### 2.1 — Socle web et gate

Fichiers créés : `pnpm-workspace.yaml`, `apps/web/{package.json,index.html,vite.config.ts,tsconfig.json,eslint.config.js}`, `apps/web/src/{main.tsx,App.tsx,styles.css}`, `apps/web/src/design/tokens.ts`, `apps/web/src/format/number.ts`, tests associés. Modifiés : `package.json` racine (`check:web`, `check`), `pnpm-lock.yaml`, `CHANGELOG.md`, `CLAUDE.md` (commandes), `.gitignore` si besoin.

- Formatage français : virgule décimale, espace fine insécable des milliers, unités compactes (`16,5 M€`, `412 k€`), pourcentages, écarts signés (`+3,1 %`, `−0,6 pt`) avec le vrai signe moins.
- Test de concordance `tokens.css` / `tokens.json`.

Acceptation : `pnpm install --frozen-lockfile` puis `pnpm run check` vert ; `check:web` lance typecheck, lint, tests avec seuil et build.

### 2.2 — Coque applicative

Fichiers créés : `apps/web/src/shell/{AppShell,Sidebar,TopBar,EnvironmentSwitch,IdentityPill}.tsx`, `apps/web/src/ui/{Badge,Banner,Card}.tsx`, tests associés.

- Navigation latérale à six entrées, pied « Espace rattaché à Atlas ». Les entrées non livrées sont présentes et marquées non disponibles, sans lien mort.
- Bascule `DEV | TEST | PROD` dans cet ordre, segment actif annoncé (`aria-pressed`).
- Pastille d'identité selon W11.
- Cibles de 44 px, vrais boutons et liens, focus visible.

### 2.3 — Fondation graphique

Fichiers créés : `apps/web/src/charts/{theme,selection,EChart,ChartCard,DataTable}.ts(x)`, tests associés.

- Thèmes W8 et résolution depuis `tokens.json`.
- `EChart` : import modulaire d'ECharts 6 (`echarts/core`), rendu SVG, redimensionnement par `ResizeObserver`, relai des clics, libération à la destruction, export PNG ou SVG.
- `ChartCard` : titre, onglets Graphique / Tableau, `aria-label`, navigation clavier, bouton d'export.
- Reducer de sélection et traduction vers l'argument `selection` d'`aggregate`.

### 2.4 — Les cinq cas du §6.3

Fichiers créés : `apps/web/src/charts/specs/{combined,waterfall,heatmap,bars,sparkline}.ts`, `apps/web/src/ui/KpiTile.tsx`, `apps/web/src/prototype/{fixtures,SelectionBar}.ts(x)`, tests associés.

1. **Graphique combiné** : réalisé en barres, budget en ligne, seuil en pointillé cuivre.
2. **Waterfall** : passage d'un total à un autre par contributions signées, sous-totaux distingués.
3. **Heatmap** : région × mois, échelle séquentielle dont chaque palier est un token.
4. **KPI enrichi** : valeur, écart signé, tendance en sparkline ; variante « Accès refusé ».
5. **Sélection filtrant une autre vue** : clic ou clavier sur l'histogramme des régions, le tableau voisin se filtre et indique « Filtré par la sélection du graphique ».

### 2.5 — Page composée, mesure et décision

Fichiers créés : `apps/web/src/prototype/{PrototypePage,Bench}.tsx`, `docs/decisions/0001_bibliotheque_graphique.md`, tests associés.

- Page composée réunissant les cinq cas, bascule de thème, comportement responsive (`flex-wrap`, pas de défilement horizontal de page).
- Mode mesure (`?bench`) : tailles de résultat de 100, 1 000 et 10 000 points, de 1 à 12 tuiles, temps de premier rendu et mémoire. Tailles fixées ici, avant l'essai, comme le demande le §6.3. Mesure lancée dans Chrome headless sur le build de production.
- Décision d'architecture 0001 : bibliothèque retenue, mesures, limites de rendu et d'accessibilité constatées, écarts aux maquettes (`RULES.md` §5.8). Elle est **proposée** : la validation revient au porteur.

## 4. Rayon d'impact

Création d'une application à côté de `apps/api`, sans appelant existant. Seul fichier partagé modifié : le `package.json` racine, dont le script `check` gagne `check:web`. L'index structurel n'existe pas pour ce dépôt ; aucun rayon d'impact outillé ne peut être établi.

## 5. Risques

| Risque | Parade |
|---|---|
| ECharts ne se rend pas dans jsdom. | Rendu SVG, taille explicite en test ; les constructeurs purs portent l'essentiel des assertions. |
| Une option visuelle modifie une valeur affichée (empilement, normalisation). | Test W8 : valeurs de données identiques sous les deux thèmes. |
| La navigation clavier d'ECharts est insuffisante. | Navigation pilotée par le composant (`dispatchAction`), consignée comme limite si elle reste incomplète. |
| La mesure en headless ne représente pas un poste réel. | Résultats donnés comme ordre de grandeur, avec la machine et la version de Chrome. |

## 6. Choix ouverts que ce plan ne prend pas

- **Placement du calcul contextuel** pour les sélections : backend Board (une seule implémentation des règles, aller-retour local) ou navigateur (pas d'aller-retour, règles en double). Recommandation : backend. À trancher avant le lot 05.
- **Perspective** pour les tableaux et pivots : évalué au lot 05 sur des volumes réels ; le tableau d'alternative du lot 01 est un tableau HTML.
- **Profondeur de personnalisation V1** : le prototype en donne la matière, la liste des contrôles reste à figer avec le porteur.

## 7. Vérification

`pnpm run check` complet : API, web (typecheck, lint, tests et couverture, build), YAML et changelog.
