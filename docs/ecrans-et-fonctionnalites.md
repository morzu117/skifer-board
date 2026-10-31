# Skifer Board — Écrans et fonctionnalités attendus

Date : 31 octobre 2026

Statut : inventaire de cadrage dérivé du [plan de développement](plan-de-developpement.md). Base pour les maquettes et les spécifications courtes de chaque lot (§12 du plan). Rien ici n’est maquetté.

Chaque écran est rattaché aux objets du §4.1, aux lots du §8 et aux rôles du plan. Chaque écran dit aussi ce qu’il **ne fait pas**, pour garder la frontière : Board n’émet jamais de SQL, n’a aucune couche sémantique propre, et ne pose jamais lui-même une restriction de sécurité (§2, §4.3 du plan).

Les écrans marqués **[option A]** n’existent que si l’arbitrage du §3.3 du plan confie des connexions à Board. Dans les options B et C ils disparaissent au profit d’une seule frontière, l’adaptateur Skifer.

## 0. Conventions

### 0.1 Rôles

| Rôle | Ce qu’il voit | Ce qu’il peut faire |
|---|---|---|
| Lecteur | Dashboards publiés de l’environnement, données évaluées pour lui. | Filtrer, sélectionner, ouvrir l’analyse d’un visuel, explorer sans sauvegarder. |
| Créateur | Lecteur + catalogue, explorateur, analyses, éditeur de dashboards, thèmes. | Sauvegarder des analyses, composer des dashboards, créer des calculs adhoc, partager. |
| Déployeur (par environnement) | Créateur + déploiements de l’environnement cible. | Composer, contrôler et activer une release, revenir en arrière. |
| Administrateur de l’espace | Tout. | Membres, rôles, environnements, paramètres, rattachement Atlas, [option A] connexions. |

Un rôle ne donne jamais de droit sur les données : la donnée dépend de l’identité et du RLS (§4.3 du plan), pas du rôle Board.

### 0.2 États standards de tout contenu dépendant d’une exécution

Tout visuel, tableau ou résultat passe par ces états et les rend distinctement (critère d’acceptation du lot 05) :

| État | Rendu | Ce qu’il ne fait jamais |
|---|---|---|
| Chargement | Squelette du composant, exécution annulable si longue. | Afficher un ancien résultat sans son âge. |
| Vide | Message « aucune ligne pour ce contexte » avec les filtres actifs. | Se confondre avec un refus. |
| Refus (`DENY`, `REQUIRE_HUMAN`) | Bandeau avec `decision`, `reasons`, `recommended_action`, jamais de lignes. | Être mis en cache comme un succès, être masqué par une personnalisation. |
| Erreur | Type d’erreur (requête invalide, limite dépassée, moteur indisponible, délai dépassé, connexion expirée) et identifiant de trace. | Exposer un secret ou du SQL. |
| Tronqué | Résultat affiché avec un bandeau « résultat partiel » ; tout total dérivé est étiqueté « sur le résultat chargé ». | Se présenter comme un total complet. |
| Non autorisé après changement de contexte | Le résultat disparaît et se recalcule. | Rester affiché. |
| Référence non résolue | Visuel remplacé par un diagnostic : métrique, version ou modèle introuvable dans l’environnement. | Basculer silencieusement vers une autre version. |

### 0.3 Pied de provenance (composant transverse, invariant I4)

Présent sous chaque visuel, chaque tableau et chaque export :

- `evidence_id`, `sql_hash` (copiable), statut de certification des sources (certifié, non certifié, mixte), âge de la donnée, durée d’exécution.
- Pour un calcul contextuel : l’exécution source, le périmètre (sélection courante, résultat chargé, périmètre filtré) et la règle de réagrégation appliquée.
- Un clic ouvre le **panneau Preuves** (0.4).

### 0.4 Panneau Preuves (tiroir transverse)

- Métriques avec leur hash de définition et leur statut de certification ; dimensions ; filtres normalisés, en distinguant l’origine `policy` (RLS, jamais retirable) de l’origine exploration.
- Sources, modèles, lineage disponible.
- Politique évaluée : décision, raisons, horodatage.
- Exécution : statut, durée, `statement_id`, troncature.
- Le SQL n’est affiché que si l’evidence le fournit (`sql_redacted` à `false`) et que l’utilisateur a le droit correspondant ; sinon seul le `sql_hash`.
- Lien vers la définition métier Atlas de chaque métrique (écran 2).

### 0.5 Coque applicative

- **Sélecteur d’espace** en permanence visible ; tout le reste est contextualisé par l’espace.
- **Sélecteur d’environnement** (DEV / TEST / PROD ou le nommage arbitré, §10 du plan), avec couleur distinctive et rappel sur chaque écran qui exécute des données. Un lecteur ne voit que les environnements où il a un droit.
- **Identité** : qui je suis, mon rôle dans l’espace, mes droits de déploiement ; aucun champ saisissable.
- **Recherche globale** : dashboards, analyses, métriques du catalogue.
- **Centre d’exécutions** : exécutions en cours, longues ou en échec, annulation (écran 10).
- **Navigation** : Accueil, Catalogue, Explorer, Analyses, Dashboards, Thèmes, Déploiements, Administration. Les entrées sont filtrées par rôle.

## 1. Accueil des espaces et accueil de l’espace

### 1.1 Accueil des espaces (lot 02)

- Liste des espaces accessibles, rôle dans chacun, environnements disponibles, espace Atlas rattaché.
- Création d’un espace réservée aux administrateurs : nom, rattachement à un espace Atlas, environnements initiaux.
- Invitation en attente : accepter, refuser.

### 1.2 Accueil de l’espace (lot 02, enrichi par 06, 07, 08)

- Dashboards publiés dans l’environnement courant, épinglés et récents.
- Mes analyses personnelles et mes explorations non sauvegardées récentes.
- Contenus partagés avec moi.
- Pour un déployeur : releases en attente de contrôle ou d’activation.
- Pour un créateur : analyses dont une révision impacte des consommateurs.

## 2. Catalogue métier (lot 04)

Porte d’entrée vers les métriques et dimensions exécutables. Lecture seule : les définitions appartiennent à Atlas.

### 2.1 Liste

- Recherche par nom et synonymes ; filtres domaine, propriétaire, statut Atlas, disponibilité dans l’environnement courant, certification.
- Tableau : métrique, domaine, version Atlas courante, déclinaisons, modèle sémantique correspondant, disponibilité (exécutable, référence non résolue, Atlas indisponible), statut de certification.
- Dimensions et périodes exposées par modèle.
- Entrée « métriques adhoc de l’espace » (écran 4.3), distinguées visuellement des métriques gouvernées.

### 2.2 Fiche métrique (tiroir, puis page)

- Définition métier Atlas : libellé, description, domaine, propriétaire, version, lien vers la fiche KPI Atlas.
- Déclinaisons par entité et déclinaison résolue pour le contexte du lecteur.
- Correspondance exécutable : modèle sémantique skifer, métrique, type d’agrégation, `additivity`, dimensions non additives, `grain`, calendrier. C’est le contrat de réagrégation que l’explorateur appliquera.
- Versions : historique, version épinglée par défaut dans l’espace, écart avec la dernière.
- Consommateurs dans l’espace : analyses et dashboards qui l’utilisent, par environnement.
- Bouton **Explorer** : ouvre l’explorateur avec la métrique présélectionnée.

### 2.3 Écrans intermédiaires

- **Référence non résolue** : diagnostic (version retirée, modèle absent de l’environnement, Atlas indisponible), consommateurs touchés, action possible (épingler une autre version, ouvrir Atlas).
- **Atlas indisponible** : bandeau d’espace, catalogue servi depuis le dernier index connu avec son âge, toute création de référence bloquée.

### 2.4 Ce que l’écran ne fait pas

Aucune création ni modification de définition métier. « Proposer une modification » renvoie vers Atlas.

## 3. Explorateur (lot 05)

Construire une requête sémantique par noms et la voir, sans LLM, sans SQL.

### 3.1 Disposition

- **Panneau gauche, champs** : choix du modèle (ou de la métrique de départ, qui impose le modèle), métriques, dimensions, dimensions de temps, recherche. Les combinaisons non prises en charge sont grisées avec la raison (grain, chemin de jointure, dimension non additive pour la métrique choisie).
- **Zone de requête** : métriques retenues, dimensions, filtres typés (égalité, liste, plage, texte, selon le type logique), période (relative ou absolue, calendrier du modèle), tri et top-N si SK-03 est livré, limite affichée.
- **Résultat** : onglets Tableau et Graphique ; type de graphique proposé automatiquement d’après la forme de la requête, modifiable ; pied de provenance.
- **Panneau droit, Preuves** (0.4) et **Diagnostics** : pourquoi une combinaison est refusée, pourquoi un résultat est tronqué, ce que le moteur a normalisé.
- **Barre d’actions** : Exécuter, Annuler l’exécution, Réinitialiser, Sauvegarder comme analyse, Épingler à un dashboard, Exporter (soumis aux mêmes droits).

### 3.2 Calculs contextuels (§4.6 du plan)

- Sélection de lignes ou de barres : bandeau de sélection avec total, part et effectif, calculés localement **seulement** si la métrique est additive sur les dimensions sélectionnées et que le résultat est complet ; sinon bouton « demander au moteur ».
- Regroupements et sous-totaux par dimension, dans les mêmes conditions.
- Chaque chiffre dérivé porte son périmètre (sélection courante, résultat chargé, périmètre filtré) et sa règle. Un calcul indisponible l’est avec sa raison, jamais approximé.
- Tant que SK-11 n’est pas livré : les moyennes, ratios et comptes distincts ne sont jamais réagrégés localement.

### 3.3 Écrans intermédiaires

- **Sauvegarder comme analyse** : nom, description, personnelle ou partagée, dossier, aperçu de ce qui est sauvegardé (requête, calculs contextuels, présentation par défaut). Exige le droit de création.
- **Épingler à un dashboard** : choisir un dashboard existant ou en créer un, choisir la section cible ; crée une analyse si l’exploration n’en est pas une.
- **Combinaison incompatible** : explication et propositions (retirer une dimension, changer de modèle).
- **Exécution longue** : progression, annulation, bascule en arrière-plan vers le centre d’exécutions.
- **Exploration depuis un visuel** (écran 6) : l’explorateur s’ouvre préchargé avec la requête du visuel et les filtres du dashboard appliqués, sans droit d’écriture sur l’analyse source.

### 3.4 Ce que l’écran ne fait pas

Pas de saisie SQL, pas d’assemblage libre de tables tant que l’arbitrage « adhoc limité aux modèles » du §10 n’est pas rendu, pas de filtre qui retire une restriction `policy`.

## 4. Analyses (lot 06)

### 4.1 Liste des analyses

- Mes analyses, analyses partagées, analyses de l’espace ; filtres par métrique, modèle, auteur, environnement où elles sont déployées, état (révision en cours, référence non résolue).
- Tableau : nom, métriques, dernière révision, consommateurs (dashboards), état dans chaque environnement.

### 4.2 Fiche analyse

- En-tête : nom, auteur, révision courante, visibilité, référence stable.
- Onglets : **Requête** (lecture, bouton Ouvrir dans l’explorateur), **Calculs contextuels** (définitions, périmètres, ordre d’application), **Présentation par défaut**, **Révisions** (historique immuable, diff entre deux révisions), **Consommateurs** (dashboards et releases, par environnement), **Usage** (événements durables, utile au lot 10), **Preuves** de la dernière exécution.
- Actions : Nouvelle révision, Dupliquer (copie indépendante), Partager, Supprimer (refusé si consommée, avec la liste).

### 4.3 Métriques adhoc

- Liste des calculs adhoc de l’espace : identité stable, révision, empreinte sémantique, analyses qui l’utilisent, état de promotion externe (inconnu tant que SK-10 n’est pas livré).
- **Éditeur de calcul adhoc** (dialogue plein écran) : définition structurée par formulaire (opérandes = métriques gouvernées ou adhoc, opérateurs fermés, périmètre), validation immédiate contre le contrat de réagrégation, aperçu sur un échantillon autorisé, nom et description, détection d’un calcul de même sens déjà existant (empreinte, pas libellé).
- Badge « non certifié » partout où le calcul apparaît.

### 4.4 Écrans intermédiaires

- **Impact d’une révision** : avant de sauvegarder une analyse consommée, liste des dashboards et releases touchés, choix entre nouvelle révision (les consommateurs épinglés ne bougent pas) et copie indépendante.
- **Migration de référence** : quand une métrique adhoc rejoint Atlas ou change de sens, assistant qui liste les analyses à migrer et propose la nouvelle référence, sans migration implicite.

## 5. Éditeur de dashboard (lot 07)

### 5.1 Disposition

- **Barre d’outils** : annuler/rétablir, aperçu responsive (largeurs), enregistrer, prévisualiser en lecteur, publier dans l’environnement courant (si droit), historique des révisions.
- **Palette à gauche** : sections, colonnes, conteneurs imbriqués, visuel d’analyse, KPI, tableau, texte, image, séparateur, filtre commun, onglets de page.
- **Canevas au centre** : composition par conteneurs, déplacement et redimensionnement, sélection multiple, repères d’alignement. Pas de positionnement libre au pixel en V1.
- **Panneau de propriétés à droite**, trois niveaux (§6.2 du plan) : **Composition** (dimensions, espacements, fond, comportement responsive), **Graphique** (type, axes, échelles, légendes, formats, couleurs conditionnelles, seuils, annotations, infobulles, interactions : sélection, filtrage d’une autre vue, navigation vers l’analyse), **Données** (analyse référencée et sa révision épinglée, filtres communs appliqués ou ignorés, périmètre des calculs contextuels affichés).
- **Panneau bas** : Problèmes (références non résolues, filtres sans cible, analyses non disponibles dans l’environnement), Structure (arbre des sections et composants), Filtres (liste et cibles).

### 5.2 Filtres communs

- Création d’un filtre à partir d’une dimension ou d’une période ; cibles explicites : s’applique à chaque visuel dont le modèle expose la dimension, avec exclusion par visuel.
- Valeurs par défaut, valeurs autorisées, dépendances entre filtres.
- Un filtre ne peut jamais cibler un paramètre de déploiement (§5.1 du plan).

### 5.3 Écrans intermédiaires

- **Ajouter une analyse** : sélecteur avec recherche, aperçu, choix de la révision (dernière ou épinglée).
- **Nouveau dashboard** : nom, modèle de page (écran 7), thème.
- **Conflit de révision** : une analyse référencée a une nouvelle révision ; comparer, adopter ou garder l’épingle.
- **Aperçu lecteur** : le dashboard tel qu’un lecteur donné le verrait, sans ses données (les données restent celles de l’éditeur, le bandeau le dit).

### 5.4 Ce que l’écran ne fait pas

Aucune personnalisation ne change un calcul métier ; aucun script d’auteur ne s’exécute chez les lecteurs ; les options du moteur graphique ne sont jamais exposées brutes, seulement par les propriétés sémantiques.

## 6. Consultation d’un dashboard (lot 08)

### 6.1 Mode lecteur

- Rendu du dashboard publié dans l’environnement courant, données évaluées pour le lecteur.
- Barre de filtres communs ; réinitialiser ; indication des filtres `policy` non retirables.
- Interactions : sélection croisée entre visuels, infobulles, tri des tableaux, agrandir un visuel, ouvrir l’analyse d’un visuel dans l’explorateur (3.3), navigation vers un autre dashboard.
- Pied de provenance sous chaque visuel ; bandeau de dashboard si une source est non certifiée ou un résultat tronqué.
- Signets personnels : jeu de filtres sauvegardé pour soi, jamais pour les autres.

### 6.2 Partage

- **Dialogue Partager** : membres ou groupes de l’espace, rôle lecture ou création, lien interne. Rappel explicite : partager n’accorde aucun droit sur les données. Révocation immédiate.
- Pas de lien public anonyme en V1.

### 6.3 Exports

- Export d’un visuel ou du dashboard (image, tableau de données, PDF si retenu), évalué pour l’exportateur, avec contexte (espace, environnement, filtres, horodatage, provenance) imprimé dans l’export. Un refus ou une troncature apparaît dans l’export.

### 6.4 Écrans intermédiaires

- **Exploration personnelle** : « modifier pour moi » ouvre une copie d’exploration non sauvegardée ; la sauvegarde exige le droit de création et crée une analyse personnelle.
- **Contenu indisponible** : analyse ou métrique non résolue dans l’environnement, avec la version attendue.

## 7. Thèmes, modèles de page et composants (lot 07)

- Liste des thèmes de l’espace : nom, version, dashboards qui l’utilisent, par environnement.
- **Éditeur de thème** : typographie, palette (séquentielle, catégorielle, divergente), espacements, formats de nombres et de dates, valeurs visuelles par défaut par type de graphique ; aperçu sur un dashboard de référence ; les changements de thème ne touchent jamais une requête.
- Modèles de page et composants approuvés : création depuis un dashboard existant, version, approbation par un administrateur, inclusion dans les releases.

## 8. Déploiements (lot 09)

### 8.1 Liste des releases

- Par environnement : release active, releases candidates, historique ; auteur, date, contenu résumé, résultat des contrôles.
- Comparaison rapide entre la release active et la dernière candidate.

### 8.2 Assistant de release (parcours §5.3 du plan)

1. **Contenus** : choisir dashboards, analyses, calculs adhoc, thèmes, composants ; fermeture automatique des dépendances, affichée.
2. **Diff avec la cible** : ajouts, modifications, retraits, conflits ; impacts sur les consommateurs.
3. **Paramètres et liaisons** : résolution des paramètres déclarés pour la cible, typés et validés ; [option A] liaisons de connexion.
4. **Vérifications** : autorisations, dépendances présentes dans la cible (versions Atlas, modèles skifer), schémas, compatibilités ; une dépendance absente bloque, avec un diagnostic.
5. **Contrôles de recette** : exécutions de référence, résultats attendus.
6. **Autorisation** : droit de déploiement de la cible, approbation distincte si la politique l’exige (§10 du plan).
7. **Activation** : atomique, journalisée ; le manifeste devient immuable.

### 8.3 Détail d’une release

- Manifeste (versions de chaque contenu et dépendance), paramètres résolus (jamais de secret), journal des contrôles et de l’activation, auteur et approbateurs.
- **Retour arrière** : réactiver une release antérieure après revérification de ses dépendances ; ne restaure aucune donnée source.
- Détection de concurrence : une activation sur une cible modifiée entre-temps est refusée avec le diff.

## 9. Administration de l’espace (lots 02, 03, 09)

- **Membres et rôles** : lecteur, créateur, administrateur ; droit de déploiement par environnement ; groupes du fournisseur d’identité.
- **Environnements** : liste, ordre de promotion, règles de validation (droit simple ou approbation), release active.
- **Paramètres de déploiement déclarés** : nom, type, obligatoire ou optionnel, défaut, contraintes ; valeurs par environnement.
- **Rattachement Atlas** : espace Atlas lié, version épinglée ou suivi contrôlé, dernier index, état de la connexion au référentiel.
- **Connexions logiques et liaisons [option A]** : registre `finance`, etc., liaison par environnement, référence de secret (jamais la valeur), test de connexion, mode d’identité par connecteur. Dans les options B et C, cet onglet devient « Moteur » : URL de l’API skifer par environnement, état, scopes accordés à Board.
- **Journal** : partages, déploiements, changements de rôles, révocations.

## 10. Centre d’exécutions (lot 03)

- Exécutions en cours et récentes de l’utilisateur : analyse ou dashboard d’origine, environnement, statut, durée, troncature, annulation.
- Pour un administrateur : vue de l’espace, limites atteintes, exécutions longues.
- Détail : evidence complète (0.4), erreurs typées, identifiant de trace à transmettre au support.

## 11. Promotion métier (lot 10, dépend de SK-10)

- Tableau des métriques adhoc de l’espace avec leur état dans le cycle externe (candidate, en revue, promue, rejetée), usage mesuré, date du dernier événement transmis.
- File d’événements d’usage : transmis, en attente, en erreur, avec reprise sans doublon.
- Quand une métrique est promue : identité Atlas reçue, assistant de migration des références (4.4).
- Aucun seuil, aucune décision de promotion dans Board.

## 12. Hors V1

Référencés pour que la navigation les prévoie, non maquettés :

- **Chat** : entrée en langage naturel produisant une analyse inspectable (même objet que l’explorateur), consommant `GenBIAgent` via l’API skifer.
- **Rapports** : planification, abonnements, exports récurrents sous identité de service, alertes.
- **KPI packs** : installation d’un pack déclaratif (modèle sémantique template et dashboards template).

## 13. Matrice écrans, lots et rôles

| Écran | Lot | Lecteur | Créateur | Déployeur | Admin |
|---|---|---|---|---|---|
| 0 Coque, états, provenance, preuves | 02, 03, 05 | ✓ | ✓ | ✓ | ✓ |
| 1 Accueils | 02 | ✓ | ✓ | ✓ | ✓ |
| 2 Catalogue métier | 04 | lecture | ✓ | ✓ | ✓ |
| 3 Explorateur | 05 | sans sauvegarde | ✓ | ✓ | ✓ |
| 4 Analyses et adhoc | 06 | — | ✓ | ✓ | ✓ |
| 5 Éditeur de dashboard | 07 | — | ✓ | ✓ | ✓ |
| 6 Consultation et partage | 08 | ✓ | ✓ | ✓ | ✓ |
| 7 Thèmes et composants | 07 | — | ✓ | ✓ | approbation |
| 8 Déploiements | 09 | — | lecture | ✓ (sa cible) | ✓ |
| 9 Administration | 02, 03, 09 | — | — | — | ✓ |
| 10 Centre d’exécutions | 03 | les siennes | les siennes | les siennes | espace |
| 11 Promotion métier | 10 | — | lecture | lecture | ✓ |

## 14. Écrans intermédiaires, récapitulatif

| Intermédiaire | Déclenché depuis | Lot |
|---|---|---|
| Panneau Preuves | tout pied de provenance | 03, 05 |
| Exécution longue, annulation | 3, 6, 10 | 03 |
| Référence non résolue, Atlas indisponible | 2, 4, 5, 6 | 04 |
| Combinaison incompatible | 3 | 05 |
| Demander au moteur (calcul contextuel) | 3, 6 | 05 |
| Sauvegarder comme analyse | 3 | 06 |
| Épingler à un dashboard | 3, 4 | 06, 07 |
| Impact d’une révision | 4 | 06 |
| Éditeur de calcul adhoc | 4 | 06 |
| Migration de référence | 4, 11 | 06, 10 |
| Ajouter une analyse, nouveau dashboard | 5 | 07 |
| Conflit de révision | 5 | 07 |
| Aperçu lecteur, aperçu responsive | 5 | 07 |
| Partager, révoquer | 4, 6 | 08 |
| Exploration personnelle depuis un visuel | 6 | 08 |
| Export avec contexte | 3, 6 | 08 |
| Assistant de release (7 étapes) | 8 | 09 |
| Retour arrière, conflit de concurrence | 8 | 09 |
| Test de connexion [option A] / état du moteur | 9 | 03 |

## 15. Ce qui reste à décider avant les maquettes

- L’arbitrage du §3.3 du plan : il décide de l’onglet « Connexions » ou « Moteur » de l’écran 9 et de la présence des liaisons dans l’assistant de release.
- Le nommage des environnements et la source de vérité d’une source par environnement (§10 du plan).
- La profondeur de personnalisation V1, figée après le prototype du lot 01 : liste exacte des propriétés de l’écran 5.
- Le fournisseur d’identité : il décide du contenu de « Membres et rôles » et de la coque.
- Le guide de style : réutiliser les tokens et composants d’Atlas (`docs/design/tokens.css`, `style-guide.md` du dépôt Atlas) pour une famille visuelle commune, ou en dériver un propre à Board.
