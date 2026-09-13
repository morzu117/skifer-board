# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Development roadmap (`docs/roadmap/00_roadmap.md`) and expectations toward skifer
  (`docs/roadmap/00_attendus_skifer.md`).
- Foundation plan (`docs/roadmap/01_skifer_board_foundation_plan.md`): monorepo pnpm + uv,
  Dashboard as YAML v1 spec, skifer mock and contract tests, typed client, minimal identity.
- Open source scaffolding: MIT license, README, contributing guide, code of conduct, security
  policy, issue and pull request templates, CI placeholder.
- Monorepo root and Python API skeleton under `uv` (`apps/api`, package `skifer_board`), with the
  `pnpm check` / `check:api` gate (ruff, ruff format, mypy strict, pytest) and a test guarding
  against `skifer` and `pyspark` imports from the board's own code.
- Minimal Next.js web app (`apps/web`, package `@skifer-board/web`) with a single landing page,
  eslint, `tsc --noEmit`, and vitest, wired into the `check:web` gate (`pnpm check` now runs
  `check:api` then `check:web`).
- CI job `check` in `.github/workflows/ci.yml`, running `pnpm run check` against both layers.
  Manifest gates `api` and `web` track each layer independently; `docs` gate unchanged.
- README section "Develop" with prerequisites, installation, commands, and layout.
- Dashboard as YAML v1 JSON Schema (`packages/dashboard-spec/schema/dashboard.v1.json`, draft
  2020-12), its reference documentation (`docs/dashboard_yaml_spec.md`), and a fixture corpus
  (`packages/dashboard-spec/fixtures/`: 10 valid dashboards, 15 invalid ones each paired with an
  `*.expected.json` describing the expected structural or semantic error), validated by
  `apps/api/tests/test_dashboard_spec_fixtures.py`.
