# CLAUDE.md — skifer-board

Application web partagée de self-service BI de l’écosystème Skifer. Les définitions métier viennent d’Atlas (`../skifer-atlas`), le moteur sémantique de skifer (`../skifer`).

Source de vérité : `docs/plan-de-developpement.md` (décisions, arbitrages, attendus externes) et `docs/ecrans-et-fonctionnalites.md`. Les plans de réalisation sont dans `docs/roadmap/NN_<sujet>_plan.md`.

## Invariants (plan §2)

- Board **n’émet ni ne stocke jamais de SQL**, y compris pour ses calculs locaux : ceux-ci passent par l’API de calcul d’Arrow.
- **Une seule frontière** vers les données. Qui la tient (API skifer ou skifer en bibliothèque) est l’arbitrage ouvert du §3.3 : ne rien coder qui le présume.
- **Fail-closed** : une décision `DENY` ou `REQUIRE_HUMAN` s’affiche telle quelle, n’est jamais contournée ni mise en cache comme un succès.
- **Tout ce qui est affiché a une provenance** (`evidence_id`, `sql_hash`, certification, âge).
- Board ne pose jamais lui-même une restriction de sécurité et un filtre d’exploration ne retire jamais une restriction.
- Aucune approximation silencieuse : un calcul impossible est rendu indisponible avec sa raison.

## Conventions

- Plan commité avant le code. Un point de plan = un commit, message `feat(planNN-x.y): …`.
- Toute modification de code = test associé + entrée dans `CHANGELOG.md` sous `## [Unreleased]`.
- Ne jamais bumper la version.
- Tests sans réseau, sans clé, sans cluster ; LLM toujours mocké.
- Ne rien écrire dans `../skifer` ni `../skifer-atlas` sans accord explicite.

## Commandes

```bash
uv sync --locked      # environnement Python
pnpm run check        # gate complet : ruff, mypy strict, pytest (couverture 100 %), YAML, changelog
uv run pytest         # tests seuls
pnpm install --frozen-lockfile   # dépendances web
pnpm run check:web    # web seul : typecheck, lint, tests (couverture 100 %), build
pnpm --filter @skifer-board/web dev   # serveur de développement
```
