"""Contrat généré et seuils du catalogue de tokens."""

import json
import math
from pathlib import Path

import pytest
from skifer_board.content.token_catalog import (
    BASES,
    CONTRACT,
    TOKENS,
    admissible,
    catalog,
    contrast,
    luminance,
)


def test_contrat_a_jour() -> None:
    tokens = json.loads(TOKENS.read_text(encoding="utf-8"))
    expected = json.dumps(catalog(tokens), ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    assert CONTRACT.read_text(encoding="utf-8") == expected
    result = catalog(tokens)
    assert result["bases"]["skifer-clair"]["surface"] == "surface"
    assert result["bases"]["skifer-ardoise"]["surface"] == "slate900"
    assert "success.fg" in result["luminance"]
    for base, surface in BASES.items():
        for category, threshold in (("mark", 3.0), ("text", 4.5)):
            expected_names = {
                name
                for name, light in result["luminance"].items()
                if contrast(light, result["luminance"][surface]) >= threshold
            }
            assert set(result["bases"][base][category]) == expected_names


@pytest.mark.parametrize("threshold", [3.0, 4.5])
def test_seuil_inclusif(threshold: float) -> None:
    assert admissible(threshold, threshold)
    assert admissible(math.nextafter(threshold, math.inf), threshold)
    assert not admissible(math.nextafter(threshold, -math.inf), threshold)
    assert contrast(0.0, 0.05 * (threshold - 1)) == pytest.approx(threshold)


def test_luminance_et_contraste() -> None:
    assert luminance("#000000") == 0
    assert luminance("#FFFFFF") == pytest.approx(1)
    assert luminance("#010A00") == pytest.approx(0.2126 / 255 / 12.92 + 0.7152 * 10 / 255 / 12.92)
    assert luminance("#0B0000") == pytest.approx(0.2126 * ((11 / 255 + 0.055) / 1.055) ** 2.4)
    assert contrast(0, 1) == contrast(1, 0) == 21
    assert contrast(0.4, 0.4) == 1


@pytest.mark.parametrize("generator_first", [True, False])
def test_catalogue_perime_reste_detecte_dans_les_deux_ordres(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, generator_first: bool
) -> None:
    from . import test_plan20_errors
    from . import test_token_catalog as module

    tokens = json.loads(TOKENS.read_text(encoding="utf-8"))
    tokens["color"]["blue"] = "#010203"
    altered = tmp_path / "source.json"
    altered.write_text(json.dumps(tokens), encoding="utf-8")
    saved = tmp_path / "contract.json"
    saved.write_text(CONTRACT.read_text(encoding="utf-8"), encoding="utf-8")

    def check() -> None:
        with monkeypatch.context() as patch:
            patch.setattr(module, "TOKENS", altered)
            patch.setattr(module, "CONTRACT", saved)
            with pytest.raises(AssertionError):
                test_contrat_a_jour()

    def generate() -> None:
        with monkeypatch.context() as patch:
            test_plan20_errors.test_generateur(tmp_path, patch)

    if generator_first:
        generate()
        check()
    else:
        check()
        generate()
    assert json.loads(altered.read_text())["color"]["blue"] == "#010203"
