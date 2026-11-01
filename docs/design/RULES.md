# Skifer Board — Règles de design et d'arbitrage

À lire avant de toucher à une interface. Fichier fait pour être lu par une personne **ou** par un agent (Claude Code, etc.) : si l'implémentation technique s'écarte d'une maquette, appliquer ces règles pour décider, puis consigner l'écart.

Référence : `DESIGN-SYSTEM.md`, `tokens.css`, `mockups/`, `../plan-de-developpement.md`.

## 1. Règles non négociables (produit)

1. Ne jamais afficher une donnée sans que l'identité du lecteur et l'environnement soient visibles.
2. Retirer un filtre d'exploration n'élargit jamais les droits. Un filtre imposé par les droits est affiché verrouillé, avec la mention « imposé par vos droits ».
3. Tout chiffre calculé dans Board indique son **périmètre** : sélection courante, résultat chargé ou ensemble du périmètre filtré.
4. Un total sur un résultat tronqué (page, top N) est signalé comme tel. Aucun bandeau ne dit « total » sans que le résultat soit complet.
5. Réagrégation : somme uniquement pour les montants additifs ; moyenne et ratio recalculés depuis leurs composantes ; nombre distinct et stock dans le temps jamais sommés. Si la règle manque, afficher « Indisponible » + raison + « Demander au moteur ». Aucune approximation silencieuse.
6. Un calcul local ne porte jamais le badge « certifié ». Le badge de certification se rattache à l'exécution du moteur.
7. Une analyse épinglée à une révision ne bascule jamais silencieusement vers la dernière ; la révision est affichée (`r4`).
8. Aucun secret n'est affiché : seules les références de secret apparaissent.
9. Les états refusé, vide, erreur, tronqué, chargement et connexion expirée sont **distincts** visuellement et par le texte.
10. Les sélections temporaires du lecteur sont personnelles et ne modifient pas le dashboard partagé ; l'interface le dit.
11. Un échec de promotion laisse la release active inchangée ; le bouton d'activation désactivé explique pourquoi.
12. Promotion métier (usage → Atlas) et promotion technique (release DEV → TEST → PROD) sont deux notions distinctes : ne pas les mélanger dans les libellés ni les écrans.

## 2. Règles visuelles

1. N'utiliser que les tokens (`tokens.css`). Pas de couleur, taille, rayon ou espacement hors du système.
2. Un seul bouton principal (cuivre) par vue.
3. Le cuivre signifie « action principale » ou « sélection de données ». Pas de cuivre décoratif.
4. Couleurs sémantiques réservées aux états. Toujours doublées d'un mot ou d'un signe.
5. Valeurs, versions, périodes, environnements, identifiants : IBM Plex Mono. Le reste : IBM Plex Sans.
6. Nombres : virgule décimale, espace pour les milliers, unité séparée (`16,5 M€`, `52,5 %`).
7. Série non sélectionnée : `seriesMuted`, ou `seriesMutedLight` avec bordure `seriesEdge`. Jamais une teinte claire sans bordure.
8. Cartes : bordure 1 px, rayon 8, pas d'ombre. Pas de dégradé. Pas d'émoji.
9. L'ordre `DEV | TEST | PROD` est invariable.

## 3. Règles d'accessibilité

1. Cibles interactives ≥ 44 px. Vrais éléments `button`, `a`, `input` + `label` ; pas de `div` cliquable.
2. Texte ≥ 4,5:1 (3:1 à partir de 24 px) ; éléments graphiques ≥ 3:1.
3. Tout graphique : description textuelle (`aria-label`), **alternative tableau**, navigation clavier des éléments sélectionnables.
4. Icône seule : `aria-label`. Icône décorative : `aria-hidden`.
5. L'éditeur de dashboard et la consultation sont utilisables au clavier et à plusieurs largeurs. Aucune mise en page ne dépend d'un survol.
6. Pas de défilement horizontal de page ; seuls les tableaux larges défilent dans leur conteneur.

## 4. Règles de structure d'écran

- Pages de gestion : navigation latérale 232 + barre supérieure + contenu en cartes.
- Édition : barre sombre pleine largeur, palette 240 / canvas / propriétés 320.
- Consultation : contenu centré ≤ 1 200, filtres communs en tête, pastille de droits sous le titre.
- Panneaux à états : l'état (chargement, vide, refus, erreur, tronqué) occupe l'emplacement du contenu attendu et garde la taille de la tuile.
- Éditeur : conteneurs imbriqués ; pas de positionnement libre au pixel ; aucun script d'auteur exécuté chez le lecteur.

## 5. Improviser quand le technique diverge

Si une contrainte technique empêche de suivre une maquette :

1. **Garder le sens avant la forme.** Les règles §1 priment sur les règles §2, qui priment sur la mise en page des maquettes.
2. **Dégrader en conservant l'information.** Exemple : si la sélection croisée est impossible, afficher le tableau filtré et indiquer le périmètre ; si les preuves ne sont pas disponibles, afficher « Preuves non disponibles » au lieu de masquer le bloc.
3. **Réutiliser un composant existant** (carte, bandeau, tableau, badge) avant d'en créer un.
4. **Choisir la valeur la plus proche dans les tokens.** Pas de nouvelle valeur.
5. **Capacité absente côté Atlas/Skifer** (RLS, preuves, réagrégation, promotion) : l'écran montre l'état « non disponible » avec la cause, pas une valeur inventée.
6. **Bibliothèque graphique différente d'ECharts** : conserver palette, sélection cuivre, seuil pointillé, étiquettes mono, alternative tableau.
7. **Nouvel écran non couvert** (catalogue, espaces et connexions, langage naturel) : composer avec carte + tableau + panneau de détail, comme `02-analyses.html`.
8. **Consigner l'écart** : une ligne dans une décision d'architecture (« Écart à la maquette X : raison, solution retenue »).

## 6. Cas fréquents

| Situation | Comportement attendu |
|---|---|
| Résultat tronqué | Bandeau attention : « {n} affichés sur {N}. Le total n'est pas celui du périmètre complet. » |
| Métrique non autorisée | Tuile refusée : cadenas, « Accès refusé », qui contacter. Pas de valeur, pas de trou silencieux. |
| Connexion expirée | Carte d'erreur distincte du refus : « Connexion expirée », action « Se reconnecter ». |
| Dépendance manquante en cible | Contrôle « Bloqué » avec l'objet manquant ; activation désactivée. |
| Métrique adhoc | Badge « candidate » ; l'état de promotion vient de l'écosystème, Board ne définit pas de seuil. |
| Changement de droits ou d'identité | Résultats dérivés invalidés et recalculés ; jamais de résultat devenu non autorisé réaffiché. |
| Modifier une analyse partagée | Afficher les dashboards consommateurs avant d'agir ; proposer « Créer une révision » ou « Copie indépendante ». |

## 7. Pour un agent de code

- Charger `tokens.css` ; ne pas dupliquer les valeurs.
- Reproduire les structures des maquettes dans `mockups/` (HTML statique, styles en ligne) comme référence visuelle, pas comme code à copier tel quel.
- Les données des maquettes sont fictives ; ne pas les coder en dur.
- En cas de doute entre deux comportements, appliquer §1 puis §5 et le noter dans la description du changement.
