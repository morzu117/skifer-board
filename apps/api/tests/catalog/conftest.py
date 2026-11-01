"""Espace Atlas local, versionné sans réseau ni configuration git globale."""

import os
import shutil
import subprocess
from datetime import UTC, datetime
from pathlib import Path

import pytest
from skifer_board.catalog import CatalogConfig, CatalogService

INSTANT = datetime(2026, 11, 1, 10, 30, tzinfo=UTC)


def git(depot: Path, *arguments: str) -> str:
    """Exécute git avec une identité limitée au processus et sans signature."""
    return subprocess.run(
        [
            "git",
            "-c",
            "user.name=Tests catalogue",
            "-c",
            "user.email=catalogue@example.invalid",
            "-c",
            "commit.gpgsign=false",
            "-c",
            "core.hooksPath=/dev/null",
            "-C",
            str(depot),
            *arguments,
        ],
        check=True,
        capture_output=True,
        text=True,
        env={**os.environ, "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_NOSYSTEM": "1"},
    ).stdout.strip()


def commettre(depot: Path) -> str:
    """Versionne les fichiers de la fixture uniquement."""
    git(depot, "add", ".")
    git(depot, "commit", "-m", "Espace de test du catalogue")
    return git(depot, "rev-parse", "HEAD")


@pytest.fixture
def espace(tmp_path: Path) -> Path:
    """Copie les YAML versionnés dans un dépôt jetable."""
    depot = tmp_path / "clone"
    shutil.copytree(Path(__file__).parent / "espace", depot)
    git(depot, "init", "-b", "main")
    commettre(depot)
    return depot


@pytest.fixture
def service(espace: Path, tmp_path: Path) -> CatalogService:
    """Place l'état hors du clone, dans un dossier initialement absent."""
    return CatalogService(CatalogConfig(espace, tmp_path / "etat" / "catalogue"), lambda: INSTANT)


@pytest.fixture
def espace_versionne(espace: Path) -> Path:
    """Trois versions taguées de « revenu-net » après l'espace initial (plan 05) : une v3 dont
    le graphe ne se résout pas, la v4 de l'espace, puis une v5 qui renomme un filtre et
    retire les avoirs du calcul. La version courante est la v5."""
    kpi = espace / "kpis" / "revenu-net.yaml"
    v4 = kpi.read_text(encoding="utf-8")
    etapes = (
        (3, v4.replace("  version: 4\n", "  version: 3\n").replace("output: n05", "output: n99")),
        (4, v4),
        (
            5,
            v4.replace("  version: 4\n", "  version: 5\n")
            .replace("label: Factures validées", "label: Factures émises")
            .replace("montant_ttc - montant_taxes - avoirs", "montant_ttc - montant_taxes"),
        ),
    )
    for version, texte in etapes:
        kpi.write_text(texte, encoding="utf-8")
        git(espace, "commit", "--allow-empty", "-am", f"Revenu net v{version}")
        git(espace, "tag", f"doc/revenu-net/v{version}")
    return espace
