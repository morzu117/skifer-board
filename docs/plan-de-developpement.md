# Skifer Board — Plan de développement

Date : 31 octobre 2026

Statut : plan de cadrage pour revue, avant spécifications détaillées et implémentation.

## 1. Objectif produit

Permettre à un utilisateur de construire facilement une analyse, de l’explorer, de la sauvegarder et de la diffuser dans un dashboard fortement personnalisable. Les définitions métier s’appuient sur Atlas, les calculs sur les capacités de Skifer et les résultats respectent les droits du lecteur.

Le parcours de référence est :

> Ouvrir un espace → choisir des données ou métriques accessibles → explorer → créer éventuellement un calcul adhoc → sauvegarder une analyse → composer un dashboard → valider en TEST → publier en PROD → consulter selon ses droits.

Le caractère distinctif de Board repose sur trois capacités : continuité entre adhoc et métriques gouvernées, liberté de présentation, et déploiement versionné entre environnements.

## 2. Décisions retenues

| Sujet | Décision |
|---|---|
| Distribution | Application web partagée. |
| Atlas | Référentiel des définitions, versions, variantes, sources et étapes métier. |
| Skifer | Moteur de préparation et d’interrogation, contrôles et preuves disponibles. |
| Board | Exploration, analyses, dashboards, partage, contexte de consultation et connexions propres. |
| Responsabilité des calculs | Skifer garantit le sens et les règles des calculs analytiques ; Board exécute les agrégations contextuelles compatibles avec les résultats reçus. Atlas porte les définitions gouvernées. |
| Identité du lecteur | Le résultat dépend de l’identité, du RLS applicable et des filtres, notamment d’entité. |
| Métriques adhoc | Les usages alimentent le système de promotion de métriques prévu dans l’écosystème ; les métriques promues ont vocation à rejoindre Atlas. |
| Environnements | DEV, TEST et PROD, avec promotion et paramètres de déploiement. |
| Personnalisation | La composition du dashboard et les graphiques doivent être fortement personnalisables. |
| Graphiques | Apache ECharts est le candidat initial retenu pour validation par prototype. |
| Vault commun | Un éventuel skifer-vault est hors programme à ce stade. Board doit néanmoins gérer les secrets de ses connexions. |

### Propositions à confirmer pendant le cadrage technique

- Un espace Board est rattaché à un espace Atlas et possède plusieurs environnements.
- L’analyse sauvegardée est un objet réutilisable ; les dashboards référencent des versions d’analyses.
- L’éditeur utilise sections et conteneurs avec une mise en page responsive.
- Les responsabilités initiales sont consulter, créer et administrer, auxquelles s’ajoute le droit de déployer par environnement.
- La première intégration distante vise Databricks. Les autres connecteurs restent des extensions.

## 3. État des dépendances et points d’attention

La lecture initiale des dépôts a été effectuée le 30 octobre 2026. Les capacités doivent être revérifiées au démarrage des lots concernés.

- Skifer expose notamment un catalogue et une API de requête sémantique ; ses résultats peuvent inclure preuves et certification. Son API observée est locale : elle ne constitue pas à elle seule le backend authentifié d’une application web partagée.
- Atlas possède un modèle de documents versionnés, un catalogue, une gouvernance par propositions, un compilateur et des fonctions de comparaison. Son serveur actuel est un sidecar local d’une application Tauri.
- Atlas compile déjà ses graphes séparément de la couche sémantique de Skifer. Le passage d’un KPI Atlas à une requête Board exécutable doit être contractualisé ; aucun format commun directement interchangeable n’est présumé.
- Le système de promotion de métriques est une dépendance fonctionnelle confirmée par le porteur du projet. Les documents Plan 44 consultés dans Skifer portaient encore une mention « rien d’implémenté ». Le premier lot doit vérifier l’état réel, les branches concernées et les interfaces disponibles.
- Les scopes d’API et la certification ne prouvent pas l’existence d’un RLS de bout en bout. Son emplacement et la propagation d’identité doivent être vérifiés explicitement.

Board intègre ces capacités par des adaptateurs et des contrats versionnés. Les simulateurs servent au développement, mais ne suffisent pas à déclarer une intégration livrée.

## 4. Modèle fonctionnel cible

### 4.1 Objets

| Objet | Contenu et responsabilité |
|---|---|
| Espace | Membres, accès, rattachement Atlas, environnements et contenus partagés. |
| Environnement | Connexions effectives, paramètres, droits de déploiement et release active. |
| Connexion logique | Référence stable utilisée par les analyses, par exemple `finance`. |
| Liaison de connexion | Configuration et référence de secret propres à un environnement. |
| Référence métier | Identité Atlas, version et éventuelle déclinaison ; correspondance avec le modèle exécutable. |
| Métrique adhoc | Calcul structuré, identité stable, révisions et référence au cycle de promotion externe. |
| Analyse | Requête structurée, métriques, dimensions, filtres, période, calculs contextuels avec leur périmètre et présentation par défaut. |
| Dashboard | Pages ou sections, composants, références d’analyses et filtres communs. |
| Thème | Typographie, couleurs, espacements, formats et valeurs visuelles par défaut. |
| Exécution | Contexte autorisé, statut, résultat borné, grain, règles de réagrégation, composantes nécessaires, complétude, fraîcheur et preuves disponibles. |
| Release | Manifeste immuable des versions de contenus et dépendances déployées. |
| Promotion | Passage d’une release vers un environnement, paramètres résolus, contrôles et journal. |

Les objets ont une identité logique stable et des révisions immuables. La requête, la présentation du visuel et la disposition dans la page sont sauvegardées séparément.

### 4.2 Exploration et réutilisation

- Sélection de métriques et dimensions, filtres et périodes ; seules les combinaisons prises en charge sont exécutables.
- Résultat sous forme de tableau ou de graphique ; accès à la définition métier et aux preuves disponibles.
- Une analyse peut être personnelle ou partagée et alimenter plusieurs dashboards.
- Modifier une analyse réutilisée affiche ses consommateurs ; l’utilisateur peut créer une nouvelle révision ou une copie indépendante.
- Les explorations d’un lecteur ne modifient pas la définition partagée ; une sauvegarde personnelle exige le droit de création.
- Une future entrée en langage naturel produit le même objet d’analyse inspectable et modifiable.

### 4.3 Droits et contexte de consultation

Les restrictions de sécurité et les filtres d’exploration sont distincts. Enlever un filtre ne peut jamais élargir les droits du lecteur. Partager un contenu n’accorde aucun droit sur ses données.

Le backend établit l’identité et le contexte autorisé. Les identités, entités ou rôles reçus du navigateur ne sont pas des preuves d’autorisation.

Le choix entre identité déléguée à la source et compte de service avec politiques imposées doit être documenté par connecteur. Un compte de service ne permet pas de prétendre que le RLS natif de la source représente automatiquement le lecteur.

Tout cache doit être isolé par espace, environnement, version de requête, paramètres et contexte effectif d’autorisation. Une évolution de droits doit invalider ou rendre inaccessibles les résultats précédemment autorisés. Les exports et prévisualisations suivent les mêmes règles.

### 4.4 Métriques adhoc et promotion métier

Board conserve une définition structurée et transmet des événements d’usage au système de promotion. Une simple égalité de libellés ne suffit pas à identifier deux métriques ; la détection doit inclure le contexte sémantique et les dépendances du calcul.

Les seuils, décisions et états de promotion appartiennent au mécanisme de l’écosystème. Board affiche ces états et assure la continuité des références lorsqu’une métrique rejoint Atlas. Une modification de sens nécessite une nouvelle version et une migration explicite des consommateurs.

La promotion métier d’une métrique et la promotion technique d’une release entre environnements sont deux cycles indépendants.

### 4.5 Répartition des calculs

| Niveau | Exemples | Définition et exécution |
|---|---|---|
| Métier | CA net, marge, clients actifs | Définition gouvernée dans Atlas ou candidate créée dans Board ; validation et exécution analytique sous la responsabilité de Skifer, avec push-down vers la source lorsque possible. |
| Contextuel | Total de la sélection, regroupement, sous-total, part du résultat affiché | Définition sauvegardée dans l’analyse ; calcul dans Board lorsque le contrat du résultat le permet, sinon nouvelle requête au moteur. |
| Présentation | Arrondi d’affichage, unité, couleur conditionnelle, étiquette | Configuration du visuel et exécution dans Board. |

Une métrique adhoc doit pouvoir être exécutée avant sa promotion dans Atlas : le contrat cible prévoit une définition structurée temporaire, validée par Skifer et soumise aux mêmes restrictions d’accès. La disponibilité de cette capacité doit être vérifiée au lot 00. La promotion conserve la sémantique d’exécution ; un changement de sens crée une nouvelle version.

Board possède une couche de calcul contextuel distincte du moteur de rendu graphique. ECharts reçoit les résultats préparés ; ses transformations ne constituent pas une définition métier parallèle. Cette couche peut calculer dans le navigateur sur les données déjà autorisées, sans appel réseau pour chaque sélection. Son placement technique et ses limites de volume seront précisés dans les spécifications.

### 4.6 Agrégations contextuelles et contrat des résultats

Exemple : sélectionner trois régions peut immédiatement afficher leur CA cumulé et leur part dans le résultat chargé, si le montant est additif sur cette dimension et que le résultat contient les données nécessaires.

Les opérations autorisées dépendent de la métrique et des dimensions :

| Nature de la mesure | Règle de réagrégation |
|---|---|
| Montant additif | Somme sur les dimensions déclarées compatibles, sans double comptage. |
| Moyenne | Recalcul à partir de la somme et de l’effectif ; pas de moyenne simple de moyennes. |
| Taux ou ratio | Recalcul à partir du numérateur et du dénominateur selon leur propre règle d’agrégation. |
| Nombre distinct | Pas de somme des comptes par groupe ; nouvelle requête sauf représentation de fusion explicitement prise en charge. |
| Stock ou autre mesure semi-additive | Agrégation selon les dimensions autorisées ; une somme dans le temps n’est pas présumée valide. |

Le contrat retourné par Skifer doit fournir le grain du résultat, les opérations et dimensions compatibles, les composantes nécessaires et autorisées, ainsi que l’état de complétude (pagination, troncature, top N et périmètre couvert). L’absence d’une règle ne vaut pas autorisation de sommer. Les règles de précision numérique, de valeurs nulles et de dénominateur nul doivent être définies pour conserver la cohérence entre Board et le moteur.

Chaque calcul précise son périmètre : **sélection courante**, **résultat chargé** ou **ensemble du périmètre filtré**. Un total sur une page ou un top N peut être affiché comme tel, mais jamais présenté comme le total complet. Pour une part du total, le dénominateur et les filtres d’exploration conservés ou retirés sont explicites. Le RLS n’est jamais retiré.

Si les données sont insuffisantes ou la réagrégation incompatible, Board demande au moteur un résultat au grain et au périmètre requis. Si cette opération n’est pas prise en charge, le calcul est déclaré indisponible avec une explication ; aucune approximation silencieuse n’est produite.

Les composantes intermédiaires retournées au navigateur respectent elles aussi les droits du lecteur. Tout calcul local conserve la référence de l’exécution source et son périmètre ; il ne reçoit pas artificiellement un statut de certification métier. Un changement d’identité, de droits ou de contexte invalide également les résultats contextuels associés.

La définition des calculs contextuels, leur ordre d’application et leurs règles de périmètre sont versionnés avec l’analyse et transportés dans les releases. Les sélections temporaires du lecteur restent personnelles, sauf sauvegarde explicite d’une exploration.

## 5. Environnements et déploiement

### 5.1 Paramètres

Les paramètres de déploiement sont déclarés avec un type, un caractère obligatoire ou optionnel, une éventuelle valeur par défaut et des contraintes. Ils ne sont pas modifiables par les filtres du dashboard.

| Référence | DEV | TEST | PROD |
|---|---|---|---|
| Connexion logique `finance` | Connexion DEV | Connexion TEST | Connexion PROD |
| Catalogue | `finance_dev` | `finance_test` | `finance_prod` |
| Schéma | `analytics` | `analytics` | `analytics` |
| Authentification | Référence de secret DEV | Référence de secret TEST | Référence de secret PROD |

La substitution est typée et validée ; elle ne repose pas sur des remplacements libres de chaînes dans du SQL. Une liaison cible doit être compatible avec les champs et modèles attendus.

### 5.2 Contenu d’une release

Une release fige dashboards, analyses, calculs adhoc, thèmes, composants visuels, paramètres déclarés et références métier. Les dépendances transitives sont incluses ou référencées par version vérifiable.

Elle ne transporte ni données, ni caches, ni secrets. Elle ne déploie pas automatiquement des pipelines Skifer ou des définitions Atlas : les versions nécessaires doivent exister dans la cible, sinon le déploiement échoue avec un diagnostic explicite.

### 5.3 Parcours

1. Choisir les contenus et calculer leurs dépendances.
2. Comparer la release avec l’état cible ; identifier les impacts et conflits.
3. Résoudre les paramètres et liaisons de connexion.
4. Vérifier les autorisations, dépendances, schémas et compatibilités.
5. Exécuter les contrôles de recette requis.
6. Autoriser l’activation selon le droit de déploiement de la cible.
7. Activer atomiquement la release et conserver son journal.

Un échec laisse la release active inchangée. Les mises à jour concurrentes sont détectées. Un retour arrière réactive une release antérieure après vérification de ses dépendances ; il ne restaure pas les données des plateformes sources.

## 6. Visualisation et personnalisation

### 6.1 Choix à valider

| Option | Licence | Positionnement |
|---|---|---|
| Apache ECharts | Apache-2.0 | Candidat initial : variété de graphiques, thèmes, interactions et séries personnalisées. |
| Vega / Vega-Lite | BSD-3-Clause | Alternative pour une grammaire déclarative et des compositions avancées. |
| visx | MIT | Alternative pour des composants React construits sur mesure, avec davantage de développement. |

La V1 doit utiliser un seul moteur graphique principal. Une interface de rendu interne laisse une possibilité d’extension sans imposer plusieurs moteurs dès le départ.

### 6.2 Trois niveaux de personnalisation

1. **Composition** : sections, colonnes, conteneurs imbriqués, textes, images, fonds, dimensions, espacements, filtres et comportement responsive.
2. **Graphiques** : axes, échelles, légendes, formats, couleurs conditionnelles, seuils, annotations, infobulles, sélection et navigation vers une analyse.
3. **Réutilisation** : thèmes, modèles de pages et composants approuvés, versionnés et transportables dans les releases.

Les valeurs sont héritées du thème, puis ajustables sur le dashboard et le composant. Une personnalisation visuelle ne doit pas changer silencieusement le calcul métier.

La V1 privilégie un éditeur structuré par conteneurs. Le positionnement libre au pixel, les scripts arbitraires et une place de marché de composants ne sont pas requis pour la première livraison. Les extensions programmées passent par un mécanisme maîtrisé ; aucun JavaScript saisi par un auteur ne s’exécute librement dans la session des lecteurs.

### 6.3 Prototype de décision

Éprouver ECharts sur un graphique combiné, un waterfall, une heatmap, un KPI enrichi et une sélection filtrant une autre vue. Inclure thème personnalisé, redimensionnement, clavier, alternative tabulaire et export visuel si retenu.

Le prototype mesure le temps de rendu, les interactions et la mémoire sur des tailles de résultats et un nombre de tuiles définis avant l’essai. Il produit une décision argumentée ; les objectifs chiffrés de performance restent à fixer au lot 00.

## 7. Architecture cible

```text
Navigateur Board
  Exploration · éditeur · consultation · déploiements
                         │
Backend Board authentifié
  Espaces et droits · contenus versionnés · exécutions
  Connexions · paramètres · releases · événements d’usage
          │                    │                    │
    Adaptateur Atlas    Adaptateur Skifer    Connexions Board
    Définitions         Requêtes / preuves   Identité et accès source
    Versions            Promotion métier    Databricks d’abord (proposé)
```

La frontière fonctionnelle des calculs est fixée aux §4.5–4.6. Le lot 00 doit préciser sa réalisation : transmission du contexte et des connexions Board au moteur, contrat de réagrégation et intervention éventuelle d’un composant Atlas. Il doit aussi définir comment les compilateurs Atlas et Skifer garantissent la cohérence d’un même KPI. Aucun chemin direct ni calcul contextuel ne doit contourner les politiques retenues.

Proposition de socle à confirmer : frontend React/TypeScript, backend Python/FastAPI pour la proximité avec l’écosystème, base transactionnelle PostgreSQL pour les métadonnées Board. Le déploiement des services, le fournisseur d’identité et le mécanisme de stockage des secrets restent à sélectionner.

Les requêtes longues sont représentées par des exécutions suivies et annulables. Les limites de résultats et délais sont explicites ; une troncature ne peut pas être présentée comme un total complet. Les traces permettent de relier l’analyse, l’environnement, l’exécution et les preuves retournées sans journaliser les secrets.

## 8. Lots de développement

Les tailles sont relatives : S = limité, M = plusieurs composants, L = transverse. Elles ne constituent pas un calendrier.

| Lot | Livrable | Dépendances | Taille |
|---|---|---|---|
| 00 | Contrats d’intégration, décisions techniques et périmètre V1 | — | M |
| 01 | Prototype de personnalisation et choix graphique | 00, partie visualisation | M |
| 02 | Socle web, identité, espaces et environnements | 00 | L |
| 03 | Connexions, paramètres et exécution autorisée | 02 | L |
| 04 | Catalogue Atlas et correspondances exécutables | 00, 02 | M |
| 05 | Exploration visuelle sur données réelles | 01, 03, 04 | L |
| 06 | Analyses versionnées et calculs adhoc | 05 | L |
| 07 | Éditeur de dashboards et thèmes | 01, 06 | L |
| 08 | Partage, consultation et interactions | 03, 07 | M |
| 09 | Promotion DEV/TEST/PROD | 02, 03, 04, 06, 07 | L |
| 10 | Intégration du cycle de promotion des métriques | 06, contrat externe disponible | M |
| 11 | Recette de bout en bout et pilote | 08, 09, 10 | L |

### Lot 00 — Cadrage et contrats

**Travaux** : vérifier les API réellement disponibles, choisir l’accès partagé à Atlas, définir la correspondance KPI/modèle exécutable, le contexte d’identité, le contrat des résultats, les paramètres et le protocole de promotion métier. Fixer les parcours V1, volumes de référence et objectifs de performance. Décider la stack et l’hébergement.

Le contrat des résultats inclut grain, règles de réagrégation par dimension, composantes autorisées, précision et complétude. Définir le protocole de retour au moteur lorsqu’un calcul contextuel ne peut pas être exécuté dans Board.

**Acceptation** : décisions enregistrées ; exemples de requêtes et réponses versionnés ; une métrique Atlas reliée sans ambiguïté à un calcul exécutable ; état réel du système de promotion documenté ; stratégie RLS démontrable avec deux lecteurs. Chaque capacité absente a un responsable et un lot de dépendance externe.

### Lot 01 — Prototype graphique

**Travaux** : réaliser les cinq cas du §6.3 dans une page composée, tester les personnalisations et le comportement responsive, comparer une alternative seulement si un besoin clé échoue.

**Acceptation** : un thème change les visuels sans modifier les analyses ; les sélections produisent des événements exploitables par Board ; les limites de rendu et d’accessibilité sont documentées ; décision de bibliothèque enregistrée.

### Lot 02 — Socle partagé

**Travaux** : authentification, sessions, espaces, appartenance, autorisations, environnements, persistance et migrations. Coque de navigation avec espace et environnement visibles.

**Acceptation** : deux espaces sont isolés côté API ; un lecteur ne peut pas écrire ; les droits de déploiement sont vérifiés côté serveur ; les environnements d’un même espace possèdent des configurations distinctes. Une base vierge peut être initialisée et une base existante migrée.

### Lot 03 — Connexions et exécution

**Travaux** : registre de connexions logiques et liaisons par environnement, secrets côté serveur, test de connexion, propagation d’identité, exécution suivie, annulation, limites et preuves. Pas de cache partagé avant démonstration de son isolation.

**Acceptation** : deux lecteurs avec des droits différents reçoivent uniquement leurs données ; un filtre retiré ne change pas ces droits ; le navigateur ne reçoit aucun secret ; connexion expirée, délai dépassé et résultat tronqué sont explicitement distingués ; une annulation est propagée selon les capacités du connecteur.

Les résultats et composantes de réagrégation respectent le même contexte d’autorisation. Les métadonnées de grain et de complétude sont présentes ; une demande de total hors de la sélection ne retire jamais le RLS.

### Lot 04 — Catalogue métier

**Travaux** : recherche par domaine et synonyme, métriques, dimensions, versions, variantes, état de disponibilité et correspondances avec les connexions et modèles.

**Acceptation** : chaque métrique exécutable possède une référence métier traçable ; une référence non résolue est signalée ; une indisponibilité d’Atlas a un comportement explicite ; une analyse épinglée à une version ne bascule pas silencieusement vers la dernière.

### Lot 05 — Exploration

**Travaux** : sélection des métriques/dimensions, filtres typés, périodes, tableaux, premiers graphiques, diagnostics de combinaisons incompatibles et inspection des preuves.

Implémenter la couche d’agrégation contextuelle de Board : regroupements, sous-totaux, total de sélection et parts de total, avec contrôle des règles et retour au moteur si nécessaire. Afficher le périmètre de chaque résultat dérivé.

**Acceptation** : un utilisateur réalise une analyse de bout en bout sur une source réelle sans écrire de SQL ; les résultats correspondent à une requête de référence ; les états chargement, vide, refus, erreur et troncature sont traités ; le changement de contexte ne réaffiche pas un résultat devenu non autorisé.

Cas de recette supplémentaires : somme d’une sélection compatible sans requête ; moyenne pondérée sur groupes de tailles différentes ; ratio recalculé ; refus de sommer des comptes distincts et un stock dans le temps sans règle adaptée ; total d’un résultat tronqué clairement limité au résultat chargé ; retour au moteur pour le total complet ; cohérence numérique entre calcul local et requête de référence. Un changement de droits invalide aussi les résultats dérivés.

### Lot 06 — Analyses et adhoc

**Travaux** : sauvegarde, révisions, duplication, références stables, calculs structurés dans le périmètre retenu, empreinte sémantique et événements d’usage durables.

Sauvegarder les définitions et périmètres des calculs contextuels avec l’analyse, séparément des sélections temporaires. Inclure ces définitions dans le versionnement et le manifeste de release.

**Acceptation** : une analyse sauvegardée peut être réouverte avec la même intention ; un calcul invalide ou une combinaison de granularités non prise en charge est refusé ; deux calculs de même nom mais de sens différent ne sont pas fusionnés ; les événements sont identifiables pour déduplication et reprise.

Une analyse partagée puis promue entre environnements conserve les mêmes règles d’agrégation contextuelle et de dénominateur, tout en recalculant sur les données autorisées du lecteur dans l’environnement cible.

### Lot 07 — Composition des dashboards

**Travaux** : sections et conteneurs, déplacement/redimensionnement, analyses référencées, blocs éditoriaux, filtres communs, thèmes, propriétés avancées, annuler/rétablir et aperçu responsive.

**Acceptation** : deux mises en page très différentes peuvent utiliser les mêmes analyses ; modifier le thème ne change pas les résultats ; la sauvegarde/relecture conserve la composition ; les cibles des filtres sont explicites ; le dashboard est utilisable au clavier et à différentes largeurs.

### Lot 08 — Consultation et partage

**Travaux** : droits de lecture/création, liens internes, ouverture d’une analyse depuis un visuel, sélection croisée, explorations personnelles et impacts des révisions.

**Acceptation** : un lien partagé ne contourne pas les droits ; les données sont évaluées pour le lecteur ; une exploration ne modifie pas le dashboard partagé ; la révocation d’un accès est effective. Tout export inclus respecte les mêmes restrictions et indique son contexte.

### Lot 09 — Pipeline de déploiement

**Travaux** : manifeste de release, fermeture des dépendances, diff, paramètres typés, précontrôles, droit de promotion, activation atomique, historique et retour arrière.

**Acceptation** : le même dashboard utilise les connexions DEV/TEST/PROD sans édition de son calcul ; une dépendance ou un paramètre manquant bloque l’activation ; une analyse modifiée en DEV n’affecte pas PROD ; un échec conserve la release active ; une concurrence est détectée ; aucun secret ou résultat n’est transféré.

### Lot 10 — Cycle de promotion métier

**Travaux** : transmission fiable des usages au système existant, affichage des statuts, retour de l’identité Atlas et migration des références.

**Acceptation** : une utilisation répétée est reconnue par le mécanisme externe ; les reprises ne doublent pas les événements ; une promotion conserve les consommateurs lorsque le sens est inchangé ; une définition modifiée exige une migration explicite. Aucun seuil de promotion concurrent n’est inventé dans Board.

Si le service externe manque, l’adaptateur et sa file d’événements peuvent être développés, mais ce lot et le parcours de promotion ne sont pas considérés comme livrés.

### Lot 11 — Pilote et exploitation

**Travaux** : parcours complet sur source réelle, tests multi-utilisateurs, charge représentative, observabilité, sauvegarde/restauration, documentation auteur/lecteur/administrateur et exploitation.

**Acceptation** : recette du parcours de référence, isolation démontrée, budgets de performance respectés, restauration des métadonnées et retour arrière vérifiés, erreurs diagnostiquables. La couverture réellement livrée du cycle de promotion est explicitement indiquée.

## 9. Jalons

| Jalon | Résultat observable |
|---|---|
| A — Fondations validées | Contrats et prototype graphique approuvés ; limites de l’écosystème identifiées. |
| B — Première analyse réelle | Un utilisateur authentifié explore une métrique Atlas via une connexion Board avec ses droits. |
| C — Création et partage | Analyses réutilisables, calculs adhoc et dashboard personnalisé consultable par plusieurs lecteurs. |
| D — Livraison contrôlée | Promotion DEV → TEST → PROD, paramètres, diff, historique et retour arrière. |
| E — Pilote complet | Usages reliés au cycle de promotion métier et recette d’exploitation terminée. |

Le chemin principal suit 00 → 02 → 03/04 → 05 → 06 → 07 → 08/09 → 11. Le prototype graphique peut avancer après le cadrage visuel ; le lot 10 dépend aussi de la disponibilité externe du système de promotion.

## 10. Arbitrages à fermer

| Question | Conséquence | Échéance |
|---|---|---|
| Adhoc limité aux modèles métier ou assemblage de tables accessibles ? | Périmètre du constructeur, jointures, granularités et sécurité. | Lot 00, avant 05/06 |
| Comment Atlas est-il accessible depuis le backend partagé ? | Service hébergé, bibliothèque, dépôt synchronisé ou autre contrat pris en charge. | Lot 00 |
| Où se fait l’exécution et comment reçoit-elle les connexions Board ? | Intégration réelle Engine/Atlas/Board. | Lot 00 |
| Quel mécanisme d’identité et de RLS pour le premier connecteur ? | Exactitude et isolation des résultats. | Lots 00/03 |
| Quel est l’état réel du service de promotion des métriques ? | Contrats, dépendances et calendrier du lot 10. | Lot 00 |
| Quelles règles de validation des déploiements en PROD ? | Droit simple ou approbation distincte ; politique configurable à préciser. | Avant lot 09 |
| Version Atlas épinglée ou suivi contrôlé des évolutions ? | Stratégie de migration et reproductibilité. | Lots 00/04 |
| Quels volumes, nombre de tuiles et temps de réponse cibles ? | Dimensionnement et critères de performance. | Lot 00 |
| Quelle profondeur de personnalisation dès la V1 ? | Liste des contrôles graphiques et types de composants à figer après prototype. | Lot 01 |

## 11. Hors périmètre initial

- Skifer-vault partagé entre produits.
- Place de marché publique de composants et scripts arbitraires d’auteurs.
- Déploiement automatique de pipelines ou de définitions Atlas depuis Board.
- Multiplication des moteurs graphiques et des connecteurs avant validation du premier parcours.
- Envois planifiés, abonnements et rafraîchissements sous comptes de service : à concevoir séparément avec leur contexte de droits.
- Assistant en langage naturel complet : extension du même modèle d’analyse après stabilisation du parcours visuel.
- Positionnement libre au pixel et collaboration simultanée de plusieurs éditeurs : évolutions possibles, non requises pour le pilote.

## 12. Règles de réalisation

Avant chaque lot, produire une spécification courte comprenant les contrats, les parcours, les erreurs, les migrations et les critères de recette. Consigner les arbitrages dans des décisions d’architecture. Développer des tranches utilisables de bout en bout et vérifier les intégrations réelles dès qu’elles sont disponibles.

Les tests doivent porter en priorité sur les frontières : isolation entre utilisateurs/espaces/environnements, exactitude analytique, conservation des versions, intégrité des promotions et absence de fuite par le cache ou les exports.

Un lot terminé possède un livrable démontrable, ses contrôles pertinents, une documentation d’usage et des limites explicites. Ce plan ne vaut pas validation des arbitrages ouverts ni preuve que les fonctions des autres dépôts sont déjà disponibles.

## 13. Références

- [Skifer](https://github.com/morzu117/skifer) et [API](https://github.com/morzu117/skifer/tree/main/src/skifer/api/routes).
- [Skifer Atlas](https://github.com/morzu117/skifer-atlas) et [documentation du cœur](https://github.com/morzu117/skifer-atlas/blob/main/core/README.md).
- [Atlas — compilation et exécution](https://github.com/morzu117/skifer-atlas/blob/main/docs/decisions/0004-compilation-sqlglot-execution-par-atlas.md).
- [Skifer — Plan 44](https://github.com/morzu117/skifer/blob/main/docs/roadmap/44_metric_candidates_plan.md), état à revérifier.
- [Apache ECharts](https://github.com/apache/echarts), [styles](https://echarts.apache.org/handbook/en/concepts/style/) et [séries personnalisées](https://echarts.apache.org/handbook/en/how-to/custom-series/).
- [Vega](https://github.com/vega/vega), [Vega-Lite](https://github.com/vega/vega-lite) et [visx](https://github.com/airbnb/visx).
