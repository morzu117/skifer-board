# Contributing to skifer-board

Thanks for your interest. This project is young and opinionated; the fastest way to contribute is
to read the roadmap first and open a discussion before writing code.

## Ground rules

1. **Plan before code.** Every feature or slice starts as `docs/roadmap/<NN>_<feature>_plan.md`:
   context, phases with files created/modified, risks, verification strategy. The plan is
   committed and validated by a maintainer before any implementation commit.
2. **One plan point = one commit.** Commit messages reference the plan: `feat(plan01-2.1): ...`.
3. **Every code change ships with a test and a `CHANGELOG.md` entry** under `## [Unreleased]`.
4. **Never bump the version.** Maintainers manage versioning.
5. **Tests are hermetic.** No network, no API keys, no cluster. LLM calls are always mocked. The
   skifer API is replaced by the mock server in `tools/skifer_mock/` (phase 1).
6. **The board never emits SQL and never bypasses skifer.** A pull request that adds a direct data
   access path, a SQL string, or a way to skip a certification decision will not be merged.
7. **Permissive licenses only.** Adding a dependency requires an entry in `docs/licenses.md`.

## Workflow

```bash
git clone https://github.com/morzu117/skifer-board.git
cd skifer-board
# tooling (pnpm + uv) arrives with the foundation plan; until then the repo is documentation only
```

- Open an issue (bug or feature template) or a discussion before a large change.
- Branch from `main`, keep pull requests small (one slice), fill in the PR template.
- CI must be green: lint, type-check, unit tests, build.

## Code style

- Python: `ruff`, `mypy --strict`, Python 3.12+, no `pyspark` dependency, ever.
- TypeScript: `eslint`, `tsc --noEmit` strict, React 19, conventions aligned with shadcn.
- Documentation: English for public docs, French is accepted in `docs/roadmap/` plans for now.

## Reporting security issues

See [SECURITY.md](SECURITY.md). Do not open a public issue for a vulnerability.
