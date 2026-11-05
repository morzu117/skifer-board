"""Un identifiant hostile est refusé avant tout appel git (plan 18, A1)."""

from __future__ import annotations

import subprocess
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from skifer_board.content import ContentError, ContentRepository

from .monde import ACTOR, document, git, init, new_id, repository

HOSTILES = [
    "../x",
    "../../etc/passwd",
    "..",
    ".",
    "",
    "--exec=touch pwn",
    "-c",
    "--upload-pack=touch pwn",
    "a/b",
    "a\\b",
    "x\x00y",
    "\x00",
    "5f1d7c52-3b0e-4d36-9a54-0c7a3e1b9d20\n",
    "5f1d7c52-3b0e-4d36-9a54-0c7a3e1b9d20 ",
    " 5f1d7c52-3b0e-4d36-9a54-0c7a3e1b9d20",
    "5F1D7C52-3B0E-4D36-9A54-0C7A3E1B9D20",
    "5f1d7c523b0e4d369a540c7a3e1b9d20",
    "5f1d7c52-3b0e-4d36-9a54-0c7a3e1b9d20/../x",
    "５f1d7c52-3b0e-4d36-9a54-0c7a3e1b9d20",
    "HEAD:analyses",
    "$(touch pwn)",
    "`touch pwn`",
    "; touch pwn",
    "x" * 5000,
]


def sans_git(monkeypatch: pytest.MonkeyPatch) -> list[Any]:
    appels: list[Any] = []

    def interdit(*args: Any, **kwargs: Any) -> Any:
        appels.append(args)
        raise AssertionError("git lancé avec un identifiant hostile")

    monkeypatch.setattr(subprocess, "run", interdit)
    return appels


def operations(depot: ContentRepository, espace: str, ident: str) -> list[Callable[[], Any]]:
    return [
        lambda: depot.read(espace, ident),
        lambda: depot.read(espace, ident, 1),
        lambda: depot.history(espace, ident),
        lambda: depot.diff(espace, ident, 1, 2),
        lambda: depot.write(espace, ident, document(new_id()), expected_revision=None, actor=ACTOR),
        lambda: depot.delete(espace, ident, expected_revision=1, actor=ACTOR),
    ]


@pytest.mark.parametrize("hostile", HOSTILES, ids=lambda v: repr(v)[:40])
def test_analysis_id_hostile(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, hostile: str) -> None:
    racine = init(tmp_path / "contenus", commit=True)
    depot = repository(racine)
    avant = git(racine, "rev-parse", "HEAD")
    appels = sans_git(monkeypatch)
    for appel in operations(depot, new_id(), hostile):
        with pytest.raises(ContentError) as erreur:
            appel()
        assert erreur.value.code == "invalid_analysis"
        assert [(v.path, v.rule) for v in erreur.value.violations] == [("/id", "bad_identifier")]
    assert appels == []
    monkeypatch.undo()
    assert git(racine, "rev-parse", "HEAD") == avant
    assert sorted(p.name for p in tmp_path.rglob("pwn")) == []


# Un espace porte l'identifiant du plan 08 (`finance`) : 32 chiffres hexadécimaux en font un
# valide, les autres formes hostiles restent refusées, avec celles que l'UUID excluait déjà.
SPACE_HOSTILES = [
    hostile for hostile in HOSTILES if hostile != "5f1d7c523b0e4d369a540c7a3e1b9d20"
] + ["-finance", "finance-", "fin.ance", "Finance", "fin_ance", "a", "é" * 4, "x" * 41, "a\nb"]


@pytest.mark.parametrize("hostile", SPACE_HOSTILES, ids=lambda v: repr(v)[:40])
def test_space_id_hostile(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, hostile: str) -> None:
    racine = init(tmp_path / "contenus", commit=True)
    depot = repository(racine)
    appels = sans_git(monkeypatch)
    for appel in operations(depot, hostile, new_id()):
        with pytest.raises(ContentError) as erreur:
            appel()
        assert erreur.value.code == "invalid_analysis"
        assert [(v.path, v.rule) for v in erreur.value.violations] == [
            ("/space_id", "bad_identifier")
        ]
    assert appels == []
    assert not (racine / "analyses").exists()


@pytest.mark.parametrize("hostile", [None, 12, b"abc", ["x"], object()])
def test_identifiant_qui_n_est_pas_un_texte(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, hostile: Any
) -> None:
    depot = repository(init(tmp_path / "contenus"))
    appels = sans_git(monkeypatch)
    for appel in operations(depot, hostile, new_id()):
        with pytest.raises(ContentError) as erreur:
            appel()
        assert erreur.value.code == "invalid_analysis"
    assert appels == []


def test_un_nom_hostile_dans_le_document_ne_devient_jamais_un_argument(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    racine = init(tmp_path / "contenus")
    depot = repository(racine)
    espace, ident = new_id(), new_id()
    vus: list[list[str]] = []
    reel = subprocess.run

    def espion(argv: Any, **kwargs: Any) -> Any:
        vus.append(list(argv))
        return reel(argv, **kwargs)

    monkeypatch.setattr(subprocess, "run", espion)
    contenu = document(
        ident,
        name="--exec=touch pwn",
        description="$(touch pwn)\n; rm -rf /\n--upload-pack=x",
    )
    depot.write(espace, ident, contenu, expected_revision=None, actor=ACTOR)
    assert vus
    for argv in vus:
        assert not any("touch pwn" in a or "rm -rf" in a for a in argv)
    assert depot.read(espace, ident).document["name"] == "--exec=touch pwn"
    assert not list(tmp_path.rglob("pwn"))


@pytest.mark.parametrize(
    "espace", ["finance", "rh", "local", "a1", "5f1d7c523b0e4d369a540c7a3e1b9d20"]
)
def test_un_espace_lisible_est_un_chemin_valide(tmp_path: Path, espace: str) -> None:
    racine = init(tmp_path / "contenus")
    depot = repository(racine)
    ident = new_id()
    depot.write(espace, ident, document(ident), expected_revision=None, actor=ACTOR)
    assert git(racine, "ls-tree", "-r", "--name-only", "HEAD").split() == [
        f"analyses/{espace}/{ident}.yaml"
    ]
    assert depot.read(espace, ident).document["id"] == ident
