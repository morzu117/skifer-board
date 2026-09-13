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
