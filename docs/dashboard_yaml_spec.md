# Spécification « Dashboard as YAML » v1

Source de vérité : [`packages/dashboard-spec/schema/dashboard.v1.json`](../packages/dashboard-spec/schema/dashboard.v1.json)
(JSON Schema draft 2020-12, `$id: https://skifer-board.dev/schema/dashboard.v1.json`). Ce document
en est la référence lisible ; en cas de divergence, le schéma fait foi.

Une tuile de dashboard est une `SemanticQuery` — des **noms** de modèle, métriques, dimensions,
filtres et période, jamais de SQL — accompagnée d'une spec de visualisation elle-même sémantique
(jamais d'options brutes d'un renderer comme ECharts ou Vega). Le renderer n'est pas tranché par
cette spec (voir décision D7 du [plan 01](roadmap/01_skifer_board_foundation_plan.md)) : un
dashboard v1 reste valide quel que soit le renderer choisi ensuite.

## Exemple complet

```yaml
apiVersion: skifer-board/v1
kind: Dashboard
metadata:
  slug: sales-overview
  title: "Ventes - vue d'ensemble"
  owner: sales-analytics
  tags: [sales, gold]
spec:
  layout: {columns: 12}
  filters:
    - name: region
      dimension: region
      default: null
    - name: period
      kind: period
      default: last_12_months
  tiles:
    - id: kpi_revenue
      title: CA total
      position: {x: 0, y: 0, w: 4, h: 3}
      query:
        model: sales.orders
        metrics: [revenue]
        filters:
          - column: region
            operator: eq
            value: $filters.region
        period: $filters.period
      viz:
        kind: kpi
        metric: revenue
        format: {revenue: currency_eur}
    - id: revenue_by_month
      title: CA mensuel
      position: {x: 4, y: 0, w: 8, h: 4}
      query:
        model: sales.orders
        metrics: [revenue]
        group_by: [order_month]
        period: $filters.period
      viz:
        kind: line
        x: order_month
        series: [revenue]
        format: {revenue: currency_eur}
```

## Champs

### Racine

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| `apiVersion` | const `skifer-board/v1` | oui | Version de la spec. Tout ajout futur reste additif ; une v2 changerait cette valeur. |
| `kind` | const `Dashboard` | oui | Seul type de document reconnu en v1. |
| `metadata` | objet | oui | Identité du dashboard. |
| `spec` | objet | oui | Contenu du dashboard. |

### `metadata`

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| `slug` | string, `^[a-z0-9][a-z0-9-]*$` | oui | Identifiant stable, utilisé dans les URLs. |
| `title` | string, non vide | oui | Titre affiché. |
| `description` | string | non | |
| `owner` | string | non | Équipe ou personne responsable. |
| `tags` | tableau de string, sans doublon | non | |

### `spec`

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| `layout.columns` | entier, 1 à 24, défaut 12 | non | Largeur de la grille en colonnes. |
| `filters` | tableau de filtres globaux | non | Voir « Filtres globaux et liaisons ». |
| `tiles` | tableau de tuiles, au moins une | oui | |

### Tuile

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | string, `^[a-z][a-z0-9_]*$` | oui | Unique dans le dashboard (règle `DUPLICATE_TILE_ID`, couche semantic). |
| `title`, `description` | string | non | |
| `position` | `{x, y, w, h}`, entiers, `x, y ≥ 0`, `w, h ≥ 1` | oui | Position et taille dans la grille. |
| `query` | `SemanticQuery` | oui | Voir ci-dessous. |
| `viz` | spec de visualisation | oui | Voir ci-dessous. |
| `provenance.show` | boolean, défaut `true` | non | Affiche le pied de provenance de la tuile (phase 2). |
| `ignore_filters` | tableau de noms de filtres globaux | non | Exclut cette tuile de l'application implicite d'un filtre (D12). |

### `query` (`SemanticQuery`)

Corps identique à `SK-02.2` (contrat skifer), **sans `limit`**, et fermé
(`additionalProperties: false`) : un champ `sql`, `order_by`, `mode`, `view_name`,
`explanation` ou `response_format` est une erreur structurelle (`SCHEMA_VIOLATION`).

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| `model` | string, `^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$` | oui | Clé du modèle sémantique (ex. `sales.orders`). |
| `metrics` | tableau de noms, ≤ 50 | non | |
| `group_by` | tableau de noms, ≤ 50 | non | |
| `filters` | tableau `{column, operator, value?}`, ≤ 50 | non | `operator` ∈ `eq, neq, gt, lt, gte, lte, in, like, is_null, is_not_null`. `value` : scalaire, tableau de scalaires (≤ 50), ou liaison `$filters.<nom>`. |
| `date_from`, `date_to` | date ISO (`YYYY-MM-DD`) | non | **Dates littérales uniquement en v1** — aucune liaison possible (D5). |
| `period` | string non vide, littéral ou liaison `$filters.<nom>` | non | |

Au moins une des deux couches de validation attrape une requête invalide : le schéma pour un champ
interdit ou mal typé, la couche semantic (2.2) pour une requête vide (`EMPTY_QUERY` : ni `metrics`
ni `group_by`).

### `viz`

Quatre types en v1 (décision D6) : `kpi`, `table`, `bar`, `line`. `area`, `pie`, `scatter`,
`heatmap` arriveront par ajout à l'énumération, sans casser la v1.

| `kind` | Champs propres | Description |
|---|---|---|
| `kpi` | `metric` (nom, obligatoire) | Une seule valeur agrégée. |
| `table` | `columns` (tableau de noms, optionnel — toutes les colonnes si absent) | |
| `bar` | `x` (nom, obligatoire), `series` (tableau de noms, ≥ 1, obligatoire) | |
| `line` | `x` (nom, obligatoire), `series` (tableau de noms, ≥ 1, obligatoire) | |

Tous les types acceptent `format` : un objet dont les clés sont des noms de métrique ou de
dimension et les valeurs un format nommé fermé — `number`, `integer`, `percent`, `currency_eur`,
`currency_usd`. Jamais d'option brute de renderer (pas de `echarts:`, `vega:`, couleurs, styles…) :
ce sont des erreurs structurelles. Le schéma ne contraint pas la forme des clés de `format` :
c'est la couche semantic (`FORMAT_KEY_UNKNOWN`) qui vérifie qu'une clé est bien un nom de
`query.metrics` ou `query.group_by`.

## Filtres globaux et liaisons (D12)

Un filtre déclaré sous `spec.filters` s'applique **implicitement** à chaque tuile dont le modèle
expose la dimension (ou, pour un filtre de période, à chaque tuile qui référence `period` via
`$filters.<nom>`). Il n'y a pas de déclaration explicite par tuile ; une tuile s'exclut d'un filtre
avec `ignore_filters: [<nom>]`. La résolution effective (valeur du filtre → requête envoyée à
skifer) se fait à l'exécution (phase 2, F2.2/F2.3) ; la v1 ne valide que les références statiques.

Deux formes de filtre global, discriminées par `kind` :

- **Filtre de dimension** (`kind: dimension`, valeur par défaut de `kind` si absent) —
  `required: [name, dimension]`. `default` : scalaire, tableau de scalaires, ou `null`.
- **Filtre de période** (`kind: period`, obligatoire) — `required: [name, kind]`, pas de champ
  `dimension`. `default` : nom de période du calendrier skifer (string) ou `null`.

Une liaison `$filters.<nom>` (motif `^\$filters\.[a-z][a-z0-9_]*$`) n'est admise qu'à deux
endroits, et seulement comme valeur entière du champ :

- `query.period`, vers un filtre `kind: period` ;
- `query.filters[].value`, vers un filtre `kind: dimension`, quand `value` est le scalaire
  lui-même. Un élément de tableau qui commence par `$filters.` (`value` étant alors une liste)
  est une erreur `BINDING_IN_LIST` (D16) : une liste littérale reste admise, mais aucun de ses
  éléments ne peut être une liaison.

Le schéma structurel ne distingue pas syntaxiquement un nom de période littéral (`ytd`) d'une
liaison (`$filters.period`) : les deux sont des chaînes non vides valides pour `period`, et une
liaison est elle-même une chaîne valide pour `value` (une chaîne de moins de 1024 caractères). La
vérification qu'une liaison pointe vers un filtre du bon type (`BINDING_KIND_MISMATCH`) et qu'elle
référence un filtre existant (`UNKNOWN_FILTER_REFERENCE`, qui couvre aussi `ignore_filters`) relève
de la couche semantic (2.2), pas du schéma structurel.

`date_from` et `date_to` restent des dates littérales en v1 : aucun filtre global ne produit de
date, donc aucune liaison n'y est admise (une liaison dans `date_from`/`date_to` est une erreur
structurelle, le motif `isoDate` ne la reconnaît pas).

## Volontairement absent de v1, et pourquoi

- **`order_by` et le top-N** : `SK-03` (tri côté skifer) n'existe pas encore côté skifer ; les
  ajouter maintenant promettrait un tri que le moteur ne sait pas exécuter. Ajout additif en v2
  quand `SK-03` sera livré (D5).
- **`viz.kind: area, pie, scatter, heatmap`** : reportés pour ne pas sur-spécifier une grammaire de
  viz avant d'avoir rendu une seule tuile (D6). Ajout par extension de l'énumération, sans rupture.
- **Filtres de section** (portée intermédiaire entre dashboard et tuile) : seuls les filtres
  globaux existent en v1 (D12). La v1 ne réserve aucun champ pour une portée de section ; ce sera
  un ajout, pas une réécriture.
- **Liaisons de date** (`date_from`/`date_to` vers un filtre) : aucun filtre global de type date
  n'existe en v1 (D5) ; seuls `period` et `filters[].value` admettent une liaison.

## Codes d'erreur

Deux couches de validation, chacune avec ses propres codes stables.

### Couche `structural` (JSON Schema)

| Code | Signification |
|---|---|
| `SCHEMA_VIOLATION` | Le document ne respecte pas `dashboard.v1.json` : champ interdit ou manquant, type, motif, énumération, `oneOf` (ex. `viz.kind` inconnu), borne de taille. Code unique pour toute violation structurelle. |

### Couche `semantic` (règles inter-champs, implémentées à la sous-tâche 2.2 côté Python — pas
par le schéma)

| Code | Déclenché quand |
|---|---|
| `DUPLICATE_TILE_ID` | Deux tuiles partagent le même `id`. |
| `DUPLICATE_FILTER_NAME` | Deux filtres globaux partagent le même `name`. |
| `TILE_OUT_OF_GRID` | `position.x + position.w > spec.layout.columns`. |
| `TILE_OVERLAP` | Deux tuiles occupent une même cellule de la grille. |
| `EMPTY_QUERY` | `query` ne déclare ni `metrics` ni `group_by`. |
| `VIZ_X_NOT_IN_GROUP_BY` | `viz.x` (bar/line) n'est pas dans `query.group_by`. |
| `VIZ_SERIES_NOT_IN_METRICS` | Un élément de `viz.series` (bar/line) n'est pas dans `query.metrics`. |
| `VIZ_KPI_METRIC_NOT_IN_METRICS` | `viz.metric` (kpi) n'est pas dans `query.metrics`. |
| `VIZ_TABLE_COLUMN_UNKNOWN` | Une colonne de `viz.columns` (table) n'est ni dans `query.metrics` ni dans `query.group_by`. |
| `FORMAT_KEY_UNKNOWN` | Une clé de `viz.format` n'est ni dans `query.metrics` ni dans `query.group_by`. |
| `UNKNOWN_FILTER_REFERENCE` | Une liaison `$filters.<nom>` ou une entrée de `ignore_filters` référence un filtre global qui n'existe pas dans `spec.filters`. |
| `BINDING_KIND_MISMATCH` | `query.period` lie un filtre de dimension, ou `query.filters[].value` lie un filtre de période. |
| `BINDING_IN_LIST` | Un élément de `query.filters[].value` (quand `value` est un tableau) commence par `$filters.` (D16). |

Les fixtures de `packages/dashboard-spec/fixtures/invalid/` illustrent chacun de ces codes (au
moins un exemple par code obligatoire), avec pour chacune un fichier `<nom>.expected.json`
`{layer, code, path}` où `path` est le pointeur JSON de l'emplacement fautif.

Convention de `path` (D13) : l'élément le plus précis, avec son index dans une liste — ainsi
`VIZ_SERIES_NOT_IN_METRICS` pointe `.../viz/series/<k>` (l'entrée fautive de `viz.series`) et
`VIZ_TABLE_COLUMN_UNKNOWN` pointe `.../viz/columns/<k>`, jamais le tableau entier.
