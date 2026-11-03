# Plan 13 — Catalogue Atlas : index occupé (lot 04c)

Date : 3 novembre 2026 · Statut : **13.1 planifié**. Suite ciblée des plans [04](04_catalogue_atlas_plan.md) et [05](05_versions_atlas_plan.md), indépendante de l'exécution bloquée du lot 03.

## 1. Constat et portée

Board épingle `skifer-atlas` à `fe334267`. Depuis `c49b66a`, Atlas réessaie l'ouverture d'une base DuckDB tenue par un autre processus puis lève `RepoError("index_busy")` ; le correctif `db9e9df6` reconnaît les deux libellés de verrou sur la version épinglée de DuckDB. L'[attendu AT-01](../attendus/atlas.md) demande à Board de relayer ce code comme une indisponibilité, sans dire que le clone est illisible. Atlas `main` a été vérifié le 3 novembre 2026 ; AT-02 reste absent et aucun KPI ne devient exécutable par cette mise à jour.

Aujourd'hui, `CatalogService._read_fresh` convertit tout `RepoError` en `repository_unreadable`. Une lecture de liste ou de fiche essaie ensuite l'ancien index ; si sa base est encore verrouillée, cette seconde ouverture peut à son tour échouer sans réponse de catalogue. L'historique et l'écart n'ont pas ce repli, mais leur raison serait tout aussi inexacte.

## 2. Décisions

| # | Décision | Effet vérifiable |
|---|---|---|
| B1 | Épingler Atlas à `db9e9df6` dans la source uv, en conservant skifer `v4.0.0`. | Les tests utilisent le code qui produit `index_busy` ; le verrou reste reproductible. |
| B2 | Ajouter `index_busy` aux raisons fermées de provenance et d'indisponibilité. | L'API et le décodeur web refusent une raison inconnue ; l'écran dit « index occupé », sans accusation d'illisibilité du clone. |
| B3 | Sur `index_busy`, ne pas tenter un second accès à la même base en repli. Répondre indisponible pour la liste, la fiche, l'historique et l'écart. | Aucune erreur de verrou non gérée ; aucune donnée ancienne servie comme fraîche. |
| B4 | Garder le repli `stale` existant pour un clone réellement absent ou illisible. | Un incident de clone conserve sa provenance et son dernier index quand celui-ci est lisible. |

## 3. Point et vérification

### 13.1 — Indisponibilité explicite d'un index occupé

Mettre à jour la dépendance Atlas et son verrou ; adapter `catalog/model.py`, `catalog/service.py`, les décodeurs et libellés web, les messages de liste et de fiche, les exemples de contrat pertinents et le changelog. Tester le `RepoError("index_busy")` sur les quatre lectures, l'absence de second accès, la sérialisation HTTP, le refus d'un code inconnu, le message web et le repli `stale` conservé pour les autres raisons. Les tests sont sans réseau ni processus Atlas externe ; le gate complet `pnpm run check` doit passer.

Un seul commit de code `feat(plan13-13.1)`. Le présent plan est commité avant ce code. Board ne modifie ni le dépôt Atlas ni le dépôt skifer.
