# Plan 21 — Consultation et partage ciblé des dashboards (lot 08a)

Date : 23 novembre 2026 · Statut : **à réaliser**. Premier plan du lot 08, ouvert sur la composition des dashboards livrée par les plans [19](19_composition_dashboards_plan.md) et [20](20_themes_modeles_composants_plan.md).

Le porteur a fait ses choix le 23 novembre :
- **partage ciblé** : personnel, tout l'espace, ou des membres et groupes nommés, chacun en lecture ou en modification ;
- **interactions de consultation limitées** au tri des tableaux, à l'agrandissement d'un visuel et aux infobulles ;
- **export d'image seulement**, avec son contexte ;
- **développement sur le VPS**, avec une demande de fusion par tranche que le porteur relit et fusionne.

Le développement de chaque tranche est confié à Codex (gpt-6.1-terra), puis relu par Claude Sonnet 5.5 avant commit. L'orchestrateur, sur le VPS :
- rédige les consignes ;
- passe le gate complet ;
- relit les captures ;
- rédige la section « Réalisation » ;
- commite et ouvre une demande de fusion par tranche.

Le porteur relit et fusionne.

Le lot 08 n'est pas déclaré livré à la fin de ce plan. Restent à planifier :
- la sélection croisée ;
- l'ouverture de l'analyse d'un visuel dans l'Explorateur et l'exploration personnelle (« modifier pour moi ») ;
- les liens entre dashboards ;
- les signets personnels ;
- l'accueil de l'espace ;
- l'export des données.

Sources :
- [plan de développement](../plan-de-developpement.md) : §4.3 (droits et RLS), §8 lot 08, §12 (règles de réalisation) ;
- [écrans](../ecrans-et-fonctionnalites.md) : §0.1 à §0.5, §6 (Consultation d'un dashboard) et la matrice des rôles (§13) ;
- plans [08](08_espaces_et_roles_plan.md) (espaces, rôles, groupes), [18](18_analyses_versionnees_plan.md) (droits des contenus), [19](19_composition_dashboards_plan.md) et [20](20_themes_modeles_composants_plan.md).

## 1. Point de départ

État du code au commit `4ceb811` de `main`.

**Visibilité et droits.**
- Un dashboard est `personal` ou `shared` (`contracts/dashboards/dashboard.v1.json`), et « partagé » veut dire **tout l'espace** (`content/web.py`, `visible_to`). Il n'existe aucune liste d'accès par personne ou par groupe.
- Les droits rendus à la lecture sont `{owner, revise, delete, duplicate}`. Réviser exige le rôle `creator` et la propriété, ou le rôle `admin` sur un dashboard partagé. Seul le propriétaire change la visibilité.
- Un dashboard partagé ne référence que des analyses partagées (`personal_reference`) et des thèmes ou composants approuvés (`unapproved_reference`).

**Membres et groupes.**
- Les rôles d'espace sont `reader`, `creator` et `admin`. Ils se lient à une personne ou à un groupe OIDC (`spaces/model.py`) et sont recalculés à chaque requête.
- Les groupes d'une personne sont figés dans sa session à la connexion.
- La liste des membres (`GET …/members`) et la recherche de personnes sont réservées aux administrateurs.

**Consultation.**
- Il n'existe aucune vue de lecture. `#/espaces/<s>/dashboards/<id>` ouvre toujours l'éditeur, en lecture seule si `revise` est faux. Les tuiles s'y exécutent sous l'identité de la personne qui ouvre le dashboard.
- L'« Aperçu lecteur » de l'éditeur reprend les résultats déjà calculés.
- Les filtres communs ont une valeur de travail distincte du défaut enregistré.
- La provenance et le panneau Preuves sont sous chaque tuile.

**Interactions et export.**
- `DataTable` ne trie pas, et rien n'agrandit un visuel.
- « Exporter l'image » produit un SVG sans aucun contexte : ni filtres, ni provenance, ni date.

**Ce qui est explicitement renvoyé au lot 08** : plan 19 (hors périmètre et B9), plan 20 (hors périmètre).

## 2. Décisions

| # | Décision | Conséquence vérifiable |
|---|---|---|
| E1 | **Audience d'un dashboard.**<br>• Le document garde `visibility` : `personal` ou `shared`. « Shared » veut désormais dire « ouvert à une audience », et les règles `personal_reference` et `unapproved_reference` s'appliquent inchangées.<br>• L'**audience** d'un dashboard partagé est un **état** en base, pas un contenu git. Comme les liaisons de rôles, elle est propre à l'espace, n'est pas versionnée avec le document et ne se promeut pas entre environnements.<br>• Une audience est une liste d'entrées. Chaque entrée vise l'espace entier, un membre (émetteur et sujet) ou un groupe lié à l'espace, avec un droit `read` ou `edit`.<br>• Un dashboard personnel n'a pas d'audience. Le passer en personnel efface son audience dans la même transaction que la révision. | Migration 0018. Matrice audience × rôle × action par route. Un dashboard personnel ne peut recevoir aucune entrée. |
| E2 | **Fail-closed.**<br>• Un dashboard partagé **sans entrée d'audience** n'est visible que de son propriétaire et des administrateurs, jamais de l'espace.<br>• La migration 0018 donne une entrée « espace entier, lecture » à chaque dashboard déjà partagé, ce qui conserve le comportement actuel.<br>• Une réindexation depuis le dépôt ne recrée aucune audience. Elle signale les dashboards partagés sans audience. | Un test de migration couvre l'existant. Après une réindexation sur une base vierge, aucun dashboard partagé n'est visible d'un lecteur, et le rapport les liste. |
| E3 | **Droits effectifs.**<br>• **Lire** : le propriétaire, un administrateur de l'espace, ou une personne visée par une entrée de l'audience (elle-même, l'un de ses groupes, ou l'espace entier), qui a un rôle dans l'espace.<br>• **Réviser** : ce que l'audience permet, borné par le rôle. Une entrée `edit` ne fait réviser qu'une personne qui a le rôle `creator` ou plus. Un `reader` visé par `edit` lit seulement, et l'écran le dit.<br>• **Changer la visibilité, gérer l'audience, supprimer** : le propriétaire, ou un administrateur de l'espace.<br>• **Dupliquer** : toute personne qui lit le dashboard et a le rôle `creator`. La copie est personnelle et n'emporte pas l'audience.<br>• Un refus de lecture répond `dashboard_not_found`, sans dire si le dashboard existe. Les droits sont recalculés à chaque requête, et `permissions` gagne `share`.<br>• **Partager un dashboard n'accorde ni ne retire aucun droit sur les données, ni sur les analyses partagées qu'il référence.** Chaque tuile reste exécutée avec l'identité de la personne qui l'ouvre. | Matrice complète par route. Tests de fuite : liste, lecture, historique, diff, consommateurs et duplication. Test de révocation : la requête suivante est refusée. |
| E4 | **Journal des partages.** Chaque ajout, changement ou retrait d'une entrée est consigné en base : qui, quoi, pour qui, quand, révision du dashboard. Le propriétaire et les administrateurs le lisent dans le dialogue Partager. Rien n'est jamais supprimé de ce journal, même à la suppression du dashboard. | Tests du journal sur chaque opération, ordre et contenu. Il est illisible pour les autres. |
| E5 | **Annuaire de partage.** Une route en lecture seule, réservée aux rôles `creator` et `admin`, donne les membres liés à l'espace (nom affiché et identifiant de principal) et les groupes liés à l'espace. Elle ne donne ni adresse, ni rôle, ni aucun autre attribut. On ne partage qu'avec un principal de cet annuaire. Une personne qui n'est pas membre ne voit rien, même visée par une entrée. | Tests de champs exacts : aucun champ en plus. Un lecteur est refusé. Une entrée vers un principal hors annuaire est refusée (`unknown_principal`). |
| E6 | **Routes de l'audience.**<br>• `GET …/dashboards/{id}/audience` lit l'audience et le journal.<br>• `PUT …/dashboards/{id}/audience` remplace l'audience entière, avec la version d'audience attendue (`audience_conflict` sinon). Une modification concurrente n'est donc jamais écrasée.<br>• La liste des dashboards indique pour chacun « à moi », « partagé avec moi » ou « partagé avec l'espace ». Le résumé de l'audience n'est donné qu'au propriétaire et aux administrateurs. | Contrats d'exemple produits par le serveur réel. Conflit testé. La liste ne révèle pas l'audience aux autres personnes. |
| E7 | **Vue de consultation.**<br>• `#/espaces/<s>/dashboards/<id>` ouvre désormais la **consultation**. L'éditeur passe à `…/dashboards/<id>/edition`.<br>• La consultation rend le dashboard avec son thème épinglé, sous l'identité de la personne qui l'ouvre.<br>• **Barre des filtres communs.** Elle porte les valeurs de travail et « Réinitialiser », jamais enregistrées. Les restrictions d'origine `policy` rapportées par les preuves y apparaissent comme non retirables.<br>• **Bandeau.** Il apparaît si une tuile est non certifiée, tronquée ou refusée.<br>• **Tuiles.** Provenance sous chacune, et tous les états du §0.2.<br>• **Actions selon les droits** : « Modifier » vers l'éditeur, « Partager », « Dupliquer ».<br>• **Révision ancienne.** Une révision ancienne s'ouvre en consultation avec un bandeau.<br>• **Éditeur sans droit.** Sans droit de révision, l'adresse de l'éditeur ouvre la consultation et dit pourquoi : le mode « éditeur en lecture seule » disparaît.<br>• **Rien n'est écrit.** Aucune action de consultation n'écrit au serveur. | Parcours Playwright : un lecteur ne voit ni « Modifier » ni « Partager ». Le journal du simulateur n'a aucune écriture pendant la consultation. Les specs e2e existantes ne changent que leurs adresses d'éditeur, sans aucune assertion modifiée, et la Réalisation l'énumère. |
| E8 | **Révocation effective à l'écran.**<br>• La consultation et l'éditeur relisent le dashboard et ses droits avant chaque nouvelle exécution (changement de filtre, « Actualiser ») et au retour du focus sur la fenêtre.<br>• Un refus efface toutes les tuiles et leurs résultats, et affiche le refus tel quel.<br>• Un changement de rôle ou de groupe pris en compte par le serveur suit la même voie.<br>• Les groupes figés à la connexion sont une limite connue, dite dans la Réalisation et dans l'aide du dialogue Partager : un retrait de groupe chez le fournisseur ne compte qu'à la reconnexion. | Test web : une révocation entre deux exécutions efface les résultats. Parcours Playwright de révocation pendant une consultation ouverte. |
| E9 | **Dialogue Partager.**<br>• **Audience.** Il montre l'audience courante et propose d'ajouter une entrée (espace entier, ou un membre ou groupe de l'annuaire, en lecture ou modification), de changer un droit ou de retirer une entrée.<br>• **Passage en partagé.** Un dashboard personnel doit d'abord passer en partagé. Le dialogue le propose comme une révision ; une analyse personnelle ou un contenu non approuvé est alors refusé avec ses chemins, comme aujourd'hui.<br>• **Effet immédiat.** Le rappel « Partager n'accorde aucun droit sur les données » est toujours visible. L'enregistrement de l'audience et la révocation sont immédiats, et le dialogue relit l'audience après chaque écriture.<br>• **Cas signalés.** Une entrée `edit` vers un lecteur est signalée (« lecture seule pour ce rôle »). Un conflit d'audience garde la saisie et propose de relire.<br>• **Journal.** Il apparaît en bas du dialogue.<br>• **Copier le lien.** Il copie l'adresse interne de la consultation. Le lien ne porte aucun droit : la personne qui l'ouvre sans être dans l'audience reçoit « introuvable ». | Tests de composants à 100 %. Axe sous les deux bases. Captures ordinateur et téléphone du dialogue : audience vide, espace entier, liste nommée, conflit et refus. |
| E10 | **Liste des dashboards.** Les sections deviennent « Mes dashboards », « Partagés avec moi » et « Partagés avec l'espace ». « Nouveau dashboard » n'est affiché qu'aux rôles `creator` et `admin`. | Parcours lecteur et créateur. Aucun dashboard n'apparaît dans deux sections. |
| E11 | **Interactions de consultation.**<br>• **Tri des tableaux.** Il porte sur les lignes chargées, ascendant ou descendant, avec `aria-sort`, et il est accessible au clavier. Si le résultat est tronqué, le tableau dit « tri sur le résultat chargé ». Le tri ne soumet aucune requête et n'est jamais enregistré.<br>• **Agrandir un visuel.** Un dialogue plein écran montre le même résultat, sans nouvelle exécution, avec sa provenance. Échap le ferme et le focus revient au bouton.<br>• **Infobulles.** Les défauts du thème (C2 du plan 20) s'appliquent. L'alternative tabulaire reste accessible au clavier.<br>Ces interactions servent aussi dans l'éditeur et l'Explorateur, partout où `ChartCard` et `DataTable` sont utilisés. | Tests de composants. Un test vérifie qu'aucune exécution n'est soumise par un tri ou un agrandissement. |
| E12 | **Export d'image avec contexte.**<br>• L'export d'un visuel produit un SVG qui contient le graphique et un bloc de contexte : titre, espace, environnement, filtres effectifs (`policy` compris), horodatage de l'export, âge des données, `evidence_id`, `sql_hash` et certification.<br>• Un résultat tronqué porte « résultat partiel ». Une tuile refusée, en erreur ou non résolue n'a pas d'export, et la raison est dite.<br>• L'export reprend le résultat déjà évalué pour la personne qui exporte, sans nouvelle exécution.<br>• Les couleurs viennent des tokens du thème rendu, et aucun SQL n'apparaît. | Test du SVG produit : contexte complet, aucune valeur absente, aucun SQL. Test de troncature et de refus. Parcours Playwright de téléchargement. |

## 3. Tranches et commits

Chaque tranche a ses tests, une entrée dans `CHANGELOG.md` sous `Unreleased`, un commit `feat(plan21-21.x)` et sa propre demande de fusion. Les tests sont hors réseau, sans clé ni cluster, sur des dépôts git et des bases jetables. Chaque tranche web apporte, dans son propre commit, ses tests unitaires, ses tests de non-régression et ses parcours Playwright. La suite e2e complète passe, lancée seule, avant la relecture.

### 21.1 — Audience, droits et routes

- La migration 0018 crée l'audience et le journal des partages, et reprend les dashboards déjà partagés (E1, E2, E4).
- `rights()` et la visibilité des dashboards suivent E3 sur chaque route existante, `share` compris.
- Les routes de l'audience et de l'annuaire (E5, E6) sont ajoutées, et la liste porte sa section par dashboard.
- La réindexation est fail-closed et produit son rapport (E2).
- Les contrats d'exemple sont produits par le serveur réel, avec la télémétrie des nouvelles opérations, la matrice des droits et les tests de fuite et de confidentialité.

### 21.2 — Contrat web

Cette tranche livre les décodeurs stricts et les clients des routes 21.1 : audience, journal, annuaire, `permissions.share` et section de liste.

### 21.3 — Vue de consultation

- La consultation (E7), avec la relecture des droits et l'effacement sur refus (E8).
- Le changement d'adresse de l'éditeur.
- La liste des dashboards (E10).

### 21.4 — Dialogue Partager

Le dialogue (E9), avec le passage en partagé, l'annuaire, le journal et la copie du lien.

### 21.5 — Interactions et export

Le tri, l'agrandissement et les infobulles (E11), puis l'export d'image avec contexte (E12).

### 21.6 — Parcours d'acceptation et captures

Le parcours du §4 et les captures de tous les états des écrans de ce plan, sur ordinateur et téléphone.

## 4. Acceptation du plan

Le parcours d'acceptation se déroule ainsi :
1. Une créatrice partage son dashboard avec un groupe en lecture et avec une personne en modification. Le rappel sur les données est visible, et le journal consigne les deux entrées.
2. **Données évaluées pour chacun.** Un lecteur du groupe ouvre le lien. Il voit la consultation, sans « Modifier » ni « Partager ». Ses données sont évaluées pour lui : deux lecteurs aux droits de données différents voient chacun leurs lignes, sur le même dashboard.
3. La personne en modification révise le dashboard. Un lecteur visé par `edit` reste en lecture, et l'écran le dit.
4. Une personne de l'espace hors de l'audience ouvre le même lien et reçoit « introuvable ». Un non-membre est refusé. **Un lien partagé ne contourne pas les droits.**
5. La créatrice retire le groupe. La consultation ouverte du lecteur efface ses tuiles à l'action suivante ou au retour du focus. **La révocation est effective.**
6. **La consultation ne modifie pas le dashboard partagé.** En consultation, un lecteur change les filtres, trie un tableau et agrandit un visuel. Aucune écriture n'est envoyée.
7. Il exporte un visuel. L'image porte le contexte complet, et « résultat partiel » si le résultat est tronqué. Une tuile refusée n'a pas d'export.

Les vérifications transverses sont les suivantes :
- aucune fuite de l'audience, du journal ou de l'annuaire vers une personne qui n'y a pas droit ;
- les restrictions `policy` sont toujours affichées et jamais retirables ;
- aucun SQL n'apparaît dans un export ni dans un corps envoyé ;
- tout est utilisable au clavier, aux trois largeurs et sous les deux bases.

Le lot 08 n'est pas déclaré livré : voir l'en-tête.

## 5. Risques et hors périmètre

| Risque | Mesure prévue |
|---|---|
| Une audience perdue ou absente ouvre un dashboard à tout l'espace. | Fail-closed (E2) : sans entrée, propriétaire et administrateurs seulement. Test de réindexation. |
| Un lien ou une route contourne l'audience. | Un seul filtre de visibilité par route, avec la matrice et les tests de fuite par route (E3). |
| Partager est compris comme un droit sur les données. | Rappel permanent dans le dialogue. Exécution toujours sous l'identité de la personne qui ouvre le dashboard. |
| Une modification concurrente de l'audience écrase une révocation. | Version d'audience attendue, `audience_conflict` (E6). |
| L'annuaire expose des données personnelles. | Champs fermés, testés exactement, et réservés aux créateurs et administrateurs (E5). |
| Le changement d'adresse de l'éditeur casse des parcours. | Les specs existantes ne changent que leurs adresses, sans assertion modifiée, et la liste est tenue dans la Réalisation (E7). |
| Un retrait de groupe chez le fournisseur n'est pas vu tout de suite. | Limite dite dans l'écran et la Réalisation ; les groupes sont relus à la reconnexion (E8). |

Hors périmètre :
- sélection croisée ;
- ouverture de l'analyse d'un visuel dans l'Explorateur et « modifier pour moi » ;
- liens entre dashboards ;
- signets personnels et accueil de l'espace ;
- export des données (CSV) et impression du dashboard ;
- partage d'analyses par audience (les analyses gardent `personal` ou `shared` avec tout l'espace) ;
- lien public anonyme (exclu de la V1, §6.2 des écrans) ;
- publication par environnement et releases (lot 09) ;
- événement d'usage `viewed` des dashboards.
