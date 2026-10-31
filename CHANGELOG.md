# Changelog

Toutes les évolutions notables de skifer-board. Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/). La version est gérée par le porteur du projet.

## [Unreleased]

### Added

- Plan 01, 1.1 : squelette du dépôt après le reboot. uv workspace (`apps/api`, paquet `skifer_board`, Python 3.12), `pyarrow` comme format pivot des résultats, gate `pnpm run check` (ruff, mypy strict, pytest avec couverture de branches à 100 %, contrôle YAML et changelog), `CLAUDE.md` minimal portant les invariants du plan de développement.
- Plan 01, 1.2 : contrat de résultat et règles des métriques (`skifer_board.contextual`). `MetricRule.from_skifer_metric` lit une métrique de modèle sémantique skifer (`type`, `additivity`, `non_additive_dimensions`) sans importer skifer ; composantes optionnelles d'une moyenne (`AvgComponents`, en attente de SK-11). `ResultContract` porte le grain, les règles et la complétude (`complete`, `truncated`, `top_n`) ; `ContextualResult` refuse une colonne manquante, une métrique non numérique et un résultat qui n'est pas à grain unique (ligne de sous-total ou doublon).
