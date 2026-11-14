"""Catalogue dérivé des tokens graphiques.

Régénérer depuis la racine : `uv run python -m skifer_board.content.token_catalog`.
Les noms imbriqués sont séparés par un point (par exemple `success.fg`).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[5]
TOKENS = ROOT / "docs/design/tokens.json"
CONTRACT = ROOT / "contracts/themes/tokens.v1.json"
BASES = {"skifer-clair": "surface", "skifer-ardoise": "slate900"}


def luminance(hex_color: str) -> float:
    """Même transformation sRGB que `charts/theme.ts`."""
    channels = [int(hex_color[start : start + 2], 16) / 255 for start in (1, 3, 5)]
    linear = [v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4 for v in channels]
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]


def contrast(a: float, b: float) -> float:
    """Rapport de deux luminances relatives, sans arrondi avant comparaison."""
    light, dark = sorted((a, b), reverse=True)
    return (light + 0.05) / (dark + 0.05)


def admissible(ratio: float, threshold: float) -> bool:
    return ratio >= threshold


def catalog(tokens: dict[str, Any]) -> dict[str, Any]:
    """Calcule le catalogue à partir du contenu JSON, sans accès aux fichiers ni mutation."""
    colors: dict[str, str] = {}

    def collect(node: dict[str, Any], prefix: str = "") -> None:
        for key, value in node.items():
            name = f"{prefix}.{key}" if prefix else key
            if isinstance(value, dict):
                collect(value, name)
            else:
                colors[name] = value

    collect(tokens["color"])
    lights = {name: luminance(value) for name, value in colors.items()}
    bases: dict[str, Any] = {}
    for base, surface in BASES.items():
        ratios = {name: contrast(value, lights[surface]) for name, value in lights.items()}
        bases[base] = {
            "surface": surface,
            "mark": {name: ratios[name] for name in colors if admissible(ratios[name], 3.0)},
            "text": {name: ratios[name] for name in colors if admissible(ratios[name], 4.5)},
        }
    return {"api_version": "board.theme_tokens/v1", "luminance": lights, "bases": bases}


def main() -> None:
    tokens = json.loads(TOKENS.read_text(encoding="utf-8"))
    CONTRACT.parent.mkdir(parents=True, exist_ok=True)
    CONTRACT.write_text(
        json.dumps(catalog(tokens), ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
