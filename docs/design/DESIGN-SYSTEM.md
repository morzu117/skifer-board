# Skifer Board — Design system

Version 0.1 · 1er novembre 2026 · dérivé des cinq maquettes de `mockups/`.
Sources : `tokens.css` (variables), `tokens.json` (mêmes valeurs, pour les outils), `design-system.html` (page de référence visuelle), `RULES.md` (règles d'arbitrage).

Statut : base de travail issue du plan de développement (`../plan-de-developpement.md`). Les choix graphiques (ECharts ou autre) restent à valider au lot 01 ; ce document décrit l'apparence cible, pas la bibliothèque.

## 1. Principes

1. **Le droit de lecture est visible.** L'identité et l'entité du lecteur, l'environnement et la fraîcheur sont toujours affichés. Ce qui est refusé, tronqué ou indisponible est dit, jamais masqué.
2. **Le périmètre d'un chiffre est écrit à côté du chiffre** : sélection courante, résultat chargé, ensemble du périmètre filtré.
3. **Sobre et dense.** Interface d'outil de travail : fonds neutres, un seul accent (cuivre), couleurs sémantiques réservées aux états.
4. **La présentation ne change jamais le calcul.** Thème, couleurs conditionnelles et formats sont des réglages visuels distincts de l'analyse.
5. **L'environnement ne se confond pas.** DEV, TEST et PROD ont toujours la même représentation et le même emplacement.

## 2. Couleurs

| Rôle | Token | Valeur | Usage |
|---|---|---|---|
| Texte | `ink` | `#1B2128` | Texte principal |
| Texte secondaire | `ink2` | `#3E4954` | Descriptions, valeurs secondaires |
| Libellé | `muted` | `#55606B` | Légendes, en-têtes de tableau, aides |
| Fond de page | `ground` | `#F5F6F4` | Arrière-plan |
| Surface | `surface` | `#FFFFFF` | Cartes, panneaux, en-têtes |
| Bordure | `line` / `lineStrong` / `lineSoft` | `#DADFE3` / `#C5CCD2` / `#E8EBED` | Cartes / contrôles / lignes de tableau |
| Ardoise | `slate900` / `slate700` | `#1F262D` / `#323E49` | Navigation, onglet actif, bascule d'environnement active |
| Accent | `copper` | `#A4521F` | Action principale, sélection de données |
| Accent doux | `copperSoft` / `copperEdge` / `copperInk` | `#FBF1E9` / `#E8C9B3` / `#7A3A12` | Fond de sélection, bordure, texte sur ce fond |
| Accent sur fond sombre | `copperOnDark` | `#C9743D` | Bouton principal d'un bandeau ardoise, texte `ink` |
| Bleu données | `blue` / `link` | `#2F5D8A` / `#1F4E7C` | Focus d'édition, avatar, lien |
| Série atténuée | `seriesMuted` | `#7A93AB` | Données non sélectionnées ou sous le seuil |
| Série claire | `seriesMutedLight` + `seriesEdge` | `#C3D0DC` + `#5E7A94` | Idem, **uniquement avec la bordure** `seriesEdge` |

États sémantiques (fond / texte) : succès `#E1F0E8` / `#17553A` · attention `#FBEFD0` / `#4F3500` · refus ou blocage `#F8E0DB` / `#7A1F14` · neutre `#EEF2F5` / `#3E4954`. Texte d'écart négatif sur fond blanc : `#8A2B1F`.

Contrastes vérifiés (ratio calculé le 1er novembre 2026) : `ink` sur blanc 16,2 · `muted` sur blanc 6,4 et sur `ground` 5,9 · blanc sur cuivre 5,5 · cuivre sur `copperSoft` 5,0 · `copperInk` sur `copperSoft` 7,7 · succès 7,4 · attention 10,0 · refus 8,2 · `onSlate` sur ardoise 11,0 · `ink` sur `copperOnDark` 4,7. Série atténuée `#7A93AB` sur blanc : 3,2 (seuil 3 pour un élément graphique).

Règles :
- Une information ne repose jamais sur la couleur seule : sélection = cuivre **et** clair/foncé, état = **mot** + couleur, écart = signe (+/−) + couleur.
- Écart positif/négatif : vert et rouge sont acceptés parce que doublés du signe et du texte.
- Pas de dégradé, pas d'ombre portée décorative, pas d'émoji.

## 3. Typographie

Police : **IBM Plex Sans** (400, 500, 600) pour l'interface ; **IBM Plex Mono** (400, 500) pour tout ce qui est donnée ou code : valeurs, périodes, révisions (`r4`), versions de release, environnements, identifiants.

| Style | Taille / graisse | Usage |
|---|---|---|
| Titre de dashboard, valeur KPI | 28 / 600 | Consultation, tuiles KPI |
| Titre de page | 24 / 600 | `h1` des écrans de gestion |
| Titre de détail | 18 / 600 | Panneau latéral |
| Titre de carte | 16 / 600 | `h2` de bloc |
| Corps | 14 / 400 | Texte courant, boutons |
| Tableau, valeur dense | 13 / 400–500 | Cellules, filtres, listes |
| Légende, libellé | 12 / 400–600 | Aide, en-têtes de tableau |
| Surtitre de section | 12 / 600, majuscules, interlettrage 0,8 px | Panneaux (Métriques, Filtres…) |
| Badge | 11 / 500 | Étiquettes d'état |

Interligne 1,45 en corps. Chiffres : séparateur décimal virgule, milliers espace, unité accolée avec espace (`16,5 M€`, `52,5 %`). Dates `31/10/2026`, heures `06:12`.

## 4. Espacement, rayons, gabarits

- Espacement (px) : 4 · 6 · 8 · 10 · 12 · 16 · 20 · 24 · 32. Écart entre blocs 20 ; remplissage de carte 18 × 20 ; remplissage de page 24.
- Rayons : 4 (étiquette flottante) · 6 (contrôles, lignes) · 8 (cartes) · 20 (pastille).
- Gabarits : navigation 232 · panneau constructeur 300 · panneau de propriétés 320 · panneau de détail ≤ 460 · lecture centrée ≤ 1 200 · page d'édition 880.
- Cible interactive minimale : **44 px** de haut.
- Responsive : page fluide, colonnes en `flex-wrap`, contenu principal `flex: 999 1 520px; min-width: 0`, tableaux dans un conteneur à défilement horizontal, menu empilé sur téléphone.

## 5. Composants

Pour chacun : structure, états, règles.

**Navigation latérale.** Fond ardoise, marque en haut, six entrées (Explorer, Analyses, Dashboards, Catalogue Atlas, Déploiements, Espace & connexions), pied avec l'espace Atlas rattaché. Entrée active : fond `slate700`, texte blanc, graisse 500. Icônes trait 1,7 px.

**Barre supérieure.** Fil d'Ariane (espace / écran), bascule d'environnement, pastille d'identité, avatar. Fond blanc, bordure basse.

**Bascule d'environnement.** Trois segments `DEV | TEST | PROD` en mono 12 px. Segment actif : fond `slate900`, texte blanc. Toujours dans cet ordre.

**Pastille d'identité / droits.** Fond succès, cadenas, texte « Données évaluées pour {nom} · Entité {x} ». Présente sur toute vue qui affiche des données.

**Bouton.** Principal : fond cuivre, texte blanc, 500 (une seule fois par vue). Secondaire : bordure `lineStrong`, fond blanc. Contour sombre : bordure `slate900`, pour une action de promotion. Désactivé : fond `line`, texte `muted`, accompagné de la raison à côté. Hauteur 44.

**Carte.** Fond blanc, bordure `line`, rayon 8, remplissage 18 × 20, titre 16/600 puis contenu, `gap` 10–16.

**Badge d'état.** Rayon pastille, 11–12 px, 500. Variantes : certifié / version Atlas (succès), candidate / modifié / tronqué (attention), bloqué / refusé (refus), inchangé / en attente (neutre).

**Tableau.** En-tête 12/600 `muted` ; cellules 13, remplissage 10 ; séparateur `lineSoft` ; nombres en mono alignés à droite ; ligne sélectionnée sur `copperSoft`. Largeur minimale puis défilement horizontal.

**Constructeur d'analyse.** Sections : Métriques (ligne par métrique avec badge Atlas ; sélectionnée = bordure cuivre + fond `copperSoft`), « Calcul adhoc » en pointillé avec badge « candidate », Dimensions (pastilles, active = fond ardoise), Filtres (champ verrouillé sur `subtle` avec cadenas et mention « imposé par vos droits »).

**Barre de sélection.** Fond `copperSoft`, bordure `copperEdge`, valeurs en mono 15 px, mention de provenance « Calculé dans Board · sans requête » ou « Demandé au moteur ».

**Tableau de calculs contextuels.** Colonnes Calcul · Périmètre · Valeur · Exécution. Un calcul impossible affiche « Indisponible », la raison, et l'action « Demander au moteur ».

**Bandeau d'alerte.** Fond attention, icône triangle, texte `warning.fg`, action éventuelle en bouton blanc. Sert à : résultat tronqué, calcul indisponible, dépendance.

**Tuile KPI.** Libellé 12 `muted`, valeur 28 mono 600, écart 12 coloré avec signe. Variante refusée : bordure pointillée, fond `subtle`, cadenas, « Accès refusé » et conduite à tenir.

**Graphique.** Histogramme : axe `#8A96A1`, grille `#E3E7EA`, valeurs mono 11–12 au-dessus des barres, étiquettes d'axe 11 `ink2`. Sélection = cuivre ; non sélectionné = `seriesMuted` (ou `seriesMutedLight` + bordure `seriesEdge`). Seuil = ligne pointillée cuivre avec étiquette `copperInk`. Toujours un `aria-label` décrivant le contenu et la sélection ; une alternative tableau est requise (voir RULES).

**Éditeur de dashboard.** Palette gauche (Structure, Contenu, Analyses disponibles), canvas central à sections séparées par un trait pointillé, panneau de propriétés droit. Composant sélectionné : bordure 2 px `blue` + étiquette flottante `blue`. Pastilles d'héritage : Thème → Dashboard → Composant (surcharges comptées).

**Chronologie de révisions.** Point 10 px (cuivre = révision courante, `seriesEdge` = antérieures), trait vertical, `rN · auteur · date` puis note.

**Pipeline d'environnements.** Trois cartes reliées par flèches ; la cible a fond `copperSoft` et bordure cuivre 2 px.

**Contrôle de promotion.** Ligne avec état en majuscules (OK, Bloqué, Attente) + texte, fond sémantique.

## 6. Iconographie

Icônes en trait 1,7–2 px, 14–18 px, `currentColor`, jeu Lucide-like dessiné en SVG en ligne. Marque : trois strates d'ardoise (cuivre / clair / gris). Pas d'icône seule sans `aria-label`.

## 7. Contenu rédactionnel

- Français, vouvoiement, phrases courtes, termes du plan : analyse, révision, release, environnement, périmètre, résultat chargé, sélection courante.
- Vocabulaire fixe : « Enregistrer l'analyse », « Créer une révision », « Copie indépendante », « Demander au moteur », « Activer {release} sur {env} ».
- Ne jamais présenter un total de page ou de top N comme le total complet.

## 8. Écrans de référence

`mockups/01-exploration.html` · `02-analyses.html` · `03-editeur-dashboard.html` · `04-consultation.html` · `05-promotion-environnements.html`. Les données sont **inventées** pour illustrer.

## 9. Ce que les maquettes ne tranchent pas

Bibliothèque graphique, comportement exact de l'approbation PROD, profondeur de personnalisation en V1, formats de mobile, catalogue Atlas, gestion des espaces et connexions, saisie en langage naturel. Voir `RULES.md` §5 pour improviser sans dériver.
