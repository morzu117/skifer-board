# 0001 — Bibliothèque graphique

Date : 1er novembre 2026 · Statut : **proposée**, en attente de validation du porteur · Plan : `docs/roadmap/02_socle_web_et_prototype_graphique_plan.md`, 2.5 · Lot : 01 (`docs/plan-de-developpement.md` §6.3)

## Contexte

Le §6.3 du plan de développement demande d'éprouver ECharts sur cinq cas avant de le retenir : graphique combiné, waterfall, heatmap, KPI enrichi, sélection filtrant une autre vue. L'essai couvre aussi le thème personnalisé, le redimensionnement, le clavier, l'alternative tabulaire et l'export visuel. Les tailles de mesure ont été fixées dans le plan 02 avant l'essai.

Le prototype est la page « Prototype graphique » de `apps/web`. Les données sont des tables Arrow de démonstration générées dans le navigateur ; aucun moteur n'est appelé.

## Décision proposée

**ECharts 6.1 (Apache-2.0)**, importé module par module, **rendu SVG par défaut**.

- Les options sont produites par des constructeurs purs qui lisent des colonnes Arrow et des rôles de thème. Elles ne lisent jamais une couleur en dur.
- Le canvas reste disponible sans changer les constructeurs. Il se justifie au-delà de quelques milliers de marques par tuile, cas que l'exploration doit de toute façon agréger avant de dessiner.
- Les rôles visuels de `RULES.md` §5.6 tiennent dans ECharts : palette, sélection cuivre, seuil pointillé, étiquettes mono, alternative tableau.

## Résultats de l'essai

| Exigence du §6.3 | Résultat |
|---|---|
| Graphique combiné | Tenu : barres, ligne et seuil en `markLine`. |
| Waterfall | Tenu par empilement sur une base transparente, avec rupture d'axe quand les variations flottent loin au-dessus de zéro. ECharts n'a pas de type waterfall natif. |
| Heatmap | Tenue : échelle par paliers, un token par palier, légende HTML. |
| KPI enrichi | Tenu sans ECharts : la tendance est un tracé SVG simple. |
| Sélection filtrant une autre vue | Tenue : l'événement typé filtre le tableau voisin. Le total de la sélection n'est pas calculé et l'écran le dit. |
| Thème personnalisé | Tenu : deux thèmes construits sur les tokens ; un test prouve que les valeurs ne changent pas avec le thème. |
| Redimensionnement | Tenu : suivi du conteneur et forme étroite sous 480 px de conteneur. |
| Clavier | Tenu, mais construit par Board (voir les limites). |
| Alternative tabulaire | Tenue : onglet Tableau sur chaque tuile. |
| Export visuel | Tenu : image vectorielle sur le fond du thème. |

## Mesures

Machine : Apple M5, 32 Go, macOS 27.0.1. Navigateur : Chrome 156.0.8078.74 en mode headless, avec `--enable-precise-memory-info` et `--js-flags=--expose-gc`. Build de production servi par `vite preview`, page `bench.html`. Chaque valeur est la médiane de trois lancements.

Le temps mesuré va de l'initialisation au retour de `setOption`. Il **n'inclut pas** la peinture du navigateur. La mémoire est l'écart de tas JavaScript après collecte, tuiles encore montées. Ce sont des ordres de grandeur sur un poste rapide, pas des objectifs : ceux-ci restent à fixer au lot 00.

| Graphique | Points | Tuiles | Rendu | Total (ms) | Par tuile (ms) | Tas (Mo) |
|---|---:|---:|---|---:|---:|---:|
| barres | 100 | 1 | SVG | 31,7 | 31,7 | 1,8 |
| barres | 100 | 1 | CANVAS | 4,9 | 4,9 | 1,4 |
| barres | 100 | 12 | SVG | 27,1 | 2,3 | 4,5 |
| barres | 100 | 12 | CANVAS | 19,2 | 1,6 | 4,9 |
| barres | 1000 | 1 | SVG | 9,5 | 9,5 | 6,5 |
| barres | 1000 | 1 | CANVAS | 8,8 | 8,8 | 5,1 |
| barres | 1000 | 12 | SVG | 71,4 | 5,9 | 21,1 |
| barres | 1000 | 12 | CANVAS | 55,0 | 4,6 | 24,3 |
| barres | 10000 | 1 | SVG | 48,1 | 48,1 | 25,7 |
| barres | 10000 | 1 | CANVAS | 42,3 | 42,3 | 12,9 |
| barres | 10000 | 12 | SVG | 543,1 | 45,3 | 174,3 |
| barres | 10000 | 12 | CANVAS | 415,8 | 34,6 | 134,2 |
| ligne | 100 | 1 | SVG | 3,6 | 3,6 | −0,1 |
| ligne | 100 | 1 | CANVAS | 2,7 | 2,7 | 0,7 |
| ligne | 100 | 12 | SVG | 12,8 | 1,1 | 6,4 |
| ligne | 100 | 12 | CANVAS | 11,0 | 0,9 | 5,7 |
| ligne | 1000 | 1 | SVG | 3,2 | 3,2 | 1,9 |
| ligne | 1000 | 1 | CANVAS | 3,0 | 3,0 | 1,7 |
| ligne | 1000 | 12 | SVG | 16,7 | 1,4 | 14,6 |
| ligne | 1000 | 12 | CANVAS | 15,6 | 1,3 | 10,7 |
| ligne | 10000 | 1 | SVG | 8,9 | 8,9 | 8,5 |
| ligne | 10000 | 1 | CANVAS | 7,8 | 7,8 | 6,1 |
| ligne | 10000 | 12 | SVG | 61,6 | 5,1 | 35,2 |
| ligne | 10000 | 12 | CANVAS | 49,3 | 4,1 | 19,1 |

Lecture :

- Le premier cas, barres 100 points en SVG, porte le préchauffage du moteur JavaScript. Sa valeur n'est pas représentative.
- Un écart de tas négatif est un bruit de collecte, pas une libération réelle.
- Jusqu'à 1 000 points, une tuile se construit en moins de 10 ms dans les deux rendus.
- À 10 000 barres sur 12 tuiles, le SVG coûte environ 30 % de temps et de mémoire de plus que le canvas. Ce volume n'est pas lisible en barres ; il doit être agrégé avant le dessin.
- Les lignes restent légères à tous les volumes mesurés.

**Non mesuré** : la latence des interactions (sélection, survol, changement de thème). Le §6.3 la demande ; le plan 02 ne l'a pas prévue. Elle est à ajouter à la page de mesure avant de figer les objectifs du lot 00.

Poids du build de production : le bloc partagé, qui contient ECharts, Arrow et React, pèse 913 ko, soit 296 ko compressés en gzip. Vite le signale au-delà de 500 ko. Le découpage par écran est à traiter au lot 02, quand plusieurs écrans existeront.

## Limites constatées

- **Mesure du texte.** ECharts mesure le texte sur un canvas, même en rendu SVG. Les tests simulent ce canvas.
- **Clavier.** ECharts ne fournit pas de parcours clavier des éléments. Board le construit : flèches, Début et Fin, Entrée ou Espace pour sélectionner, Échap pour tout désélectionner, mise en avant par `dispatchAction` et annonce `aria-live`. L'aria générée par ECharts est désactivée au profit d'une description rédigée depuis les données.
- **Waterfall.** Il repose sur une base transparente empilée. Un cumul négatif est refusé explicitement, et un pont dont les totaux ne recoupent pas les variations refuse de se dessiner.
- **Rupture d'axe.** Les deux graduations au bord de la rupture se touchent (« 9,1 M€ » et « 958 k€ »).
- **Heatmap.** ECharts exige un `visualMap` pour colorer une heatmap. Il est masqué au profit de la légende HTML par paliers.
- **Étiquettes de valeurs.** Elles sont retirées au-delà de 40 barres. Les graduations d'un axe de valeurs qui se chevauchent sont masquées ; la grille reste.
- **Forme étroite.** Sous 480 px de conteneur, le waterfall et la heatmap retirent les montants posés sur les marques et inclinent les étiquettes de catégories. Les montants restent dans l'onglet Tableau et dans l'annonce clavier.
- **Étiquettes de catégories.** Elles reviennent à la ligne aux espaces et après les traits d'union, jamais au milieu d'un mot.

## Écarts aux maquettes (`RULES.md` §5.8)

- **Polices.** Écart aux maquettes : les polices viennent de Google Fonts. Solution retenue : IBM Plex auto-hébergé, sous-ensembles latin et latin étendu, pour ne dépendre d'aucun service externe.
- **Espacements.** Écart aux maquettes : des espacements de 18, 14 et 2 px n'existent pas dans les tokens. Solution retenue : le token le plus proche.
- **Axes et grille.** Écart aux maquettes : les couleurs `#8A96A1` et `#E3E7EA` n'existent pas dans les tokens. Solution retenue : `lineStrong` et `lineSoft`.
- **Tendance des KPI.** Écart aux maquettes : la sparkline est dessinée en SVG simple, sans ECharts, pour ne pas initialiser un graphique par tuile.
- **Identité.** Écart aux maquettes : la pastille verte suppose une identité établie. Solution retenue : « Identité non établie · données de démonstration » sur fond neutre, jusqu'à l'authentification du lot 02.
- **Total de sélection.** Écart aux maquettes : la barre de sélection affiche un total. Solution retenue : « non disponible », avec la demande de calcul contextuel qui serait envoyée ; le calcul est branché au lot 05.
- **Téléphone.** Le design system laisse les formats mobiles ouverts. Les seuils de 760 px pour la coque et de 480 px pour la forme étroite des graphiques ne sont pas des tokens. Ils sont à confirmer ou à ajouter aux tokens.

## Ce que le porteur doit trancher

1. Valider ECharts et le rendu SVG par défaut, ou demander un second essai sur une autre bibliothèque.
2. Accepter la forme étroite des graphiques, qui retire des montants posés sur les marques sous 480 px.
3. Fixer les objectifs chiffrés de performance au lot 00, à partir de ces ordres de grandeur, et décider si la latence d'interaction doit être mesurée avant.
