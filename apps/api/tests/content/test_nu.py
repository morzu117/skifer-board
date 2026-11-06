"""Dépôt nu dédié à Board : rien à synchroniser, donc rien à écraser (plan 18, A1).

Board refuse tout dépôt qui n'est pas un dépôt nu au chemin configuré. Les quatre scénarios de
la contre-relecture (écrasement d'une modification manuelle, perte d'une modification indexée,
écrasement entre la publication et la synchronisation, suppression d'un fichier temporaire
prévisible) supposaient un arbre de travail ou un index réel : ils sont ici impossibles par
construction, et chaque test le montre sur le clone de l'exploitant ou sur le dépôt lui-même.
"""

from __future__ import annotations

import os
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from skifer_board.content import ContentError, ContentRepository, dumps
from skifer_board.content import repository as repository_module

from .monde import ACTOR, document, fichier, git, init, new_id, propre, relative, repository


def ecrire(depot: ContentRepository, espace: str, ident: str, **modif: Any) -> Any:
    return depot.write(espace, ident, document(ident, **modif), expected_revision=None, actor=ACTOR)


def refus(appel: Callable[[], Any], raison: str) -> None:
    with pytest.raises(ContentError) as erreur:
        appel()
    assert (erreur.value.code, erreur.value.reason) == ("content_unavailable", raison)
    assert erreur.value.violations == ()


def ecritures(depot: ContentRepository) -> list[Callable[[], Any]]:
    espace, ident = new_id(), new_id()
    return [
        lambda: ecrire(depot, espace, ident),
        lambda: depot.read(espace, ident),
        lambda: depot.history(espace, ident),
        lambda: depot.delete(espace, ident, expected_revision=1, actor=ACTOR),
    ]


def instantane(racine: Path) -> dict[str, bytes]:
    """Tous les fichiers du dépôt hors objets, références et journaux."""
    return {
        p.relative_to(racine).as_posix(): p.read_bytes()
        for p in sorted(racine.rglob("*"))
        if p.is_file() and p.relative_to(racine).parts[0] not in {"objects", "refs", "logs"}
    }


def cloner(racine: Path, destination: Path) -> Path:
    git(racine.parent, "clone", "-q", str(racine), str(destination))
    return destination


# -- ce que Board accepte comme dépôt ------------------------------------------------------


def test_un_depot_non_nu_est_refuse_sans_rien_ecrire(tmp_path: Path) -> None:
    racine = tmp_path / "ordinaire"
    racine.mkdir()
    git(racine, "init", "-q")
    for appel in ecritures(repository(racine)):
        refus(appel, "not_bare")
    assert not (racine / "analyses").exists()
    assert not (racine / ".git" / repository_module.LOCK_NAME).exists()
    assert git(racine, "status", "--porcelain=v1", "--untracked-files=all") == ""


def test_un_depot_nu_declare_non_nu_est_refuse(tmp_path: Path) -> None:
    racine = init(tmp_path / "contenus")
    git(racine, "config", "core.bare", "false")
    for appel in ecritures(repository(racine)):
        refus(appel, "not_bare")


def test_un_git_fichier_ou_une_indirection_est_refuse(tmp_path: Path) -> None:
    reel = init(tmp_path / "reel", commit=True)
    avant = instantane(reel)
    dossier = tmp_path / "indirect"
    dossier.mkdir()
    (dossier / ".git").write_text(f"gitdir: {reel}\n")
    for appel in ecritures(repository(dossier)):
        with pytest.raises(ContentError) as erreur:
            appel()
        assert erreur.value.code == "content_unavailable"
        assert erreur.value.reason in {"not_bare", "unexpected_root"}
    # Même un dépôt nu qui contient lui-même une indirection `.git` : racine inattendue.
    autre = init(tmp_path / "autre")
    (autre / ".git").write_text(f"gitdir: {reel}\n")
    for appel in ecritures(repository(autre)):
        refus(appel, "unexpected_root")
    assert instantane(reel) == avant
    assert not (reel / "analyses").exists()


def test_un_chemin_qui_est_un_lien_symbolique_est_refuse(tmp_path: Path) -> None:
    reel = init(tmp_path / "reel", commit=True)
    avant = instantane(reel)
    lien = tmp_path / "lien"
    lien.symlink_to(reel)
    for appel in ecritures(repository(lien)):
        refus(appel, "symlink_path")
    assert instantane(reel) == avant
    propre(reel)


@pytest.mark.parametrize(
    "nom", ["objects/info/alternates", "objects/info/http-alternates", "commondir"]
)
def test_des_objets_ou_une_racine_etrangers_sont_refuses(tmp_path: Path, nom: str) -> None:
    racine = init(tmp_path / "contenus", commit=True)
    (racine / "objects" / "info").mkdir(exist_ok=True)
    avant = instantane(racine)
    (racine / nom).write_text(str(tmp_path / "ailleurs") + "\n")
    for appel in ecritures(repository(racine)):
        refus(appel, "foreign_objects")
    (racine / nom).unlink()
    assert instantane(racine) == avant
    assert not (racine / repository_module.LOCK_NAME).exists()


def test_un_lien_dangereux_meme_mort_est_detecte(tmp_path: Path) -> None:
    racine = init(tmp_path / "contenus")
    (racine / "objects" / "info").mkdir(exist_ok=True)
    (racine / "objects" / "info" / "alternates").symlink_to(tmp_path / "mort")
    refus(ecritures(repository(racine))[0], "foreign_objects")


# -- les quatre scénarios de la contre-relecture : impossibles par construction --------------


def test_un_fichier_modifie_dans_le_clone_de_l_exploitant_n_est_jamais_ecrase(
    tmp_path: Path,
) -> None:
    """Modification manuelle égale à la révision précédente, ou fichier absent."""
    racine = init(tmp_path / "contenus")
    depot = repository(racine)
    espace, ident = new_id(), new_id()
    ecrire(depot, espace, ident)
    clone = cloner(racine, tmp_path / "clone")
    chemin = clone / relative(espace, ident)
    un = chemin.read_bytes()
    # À la main : le fichier repasse à une révision précédente (ici la 1, déjà égale à la tête).
    depot.write(espace, ident, document(ident, name="b"), expected_revision=1, actor=ACTOR)
    chemin.write_bytes(un)
    depot.write(espace, ident, document(ident, name="c"), expected_revision=2, actor=ACTOR)
    assert chemin.read_bytes() == un
    # À la main : le fichier disparaît du clone après la première révision.
    chemin.unlink()
    depot.write(espace, ident, document(ident, name="d"), expected_revision=3, actor=ACTOR)
    assert not chemin.exists()
    assert fichier(racine, espace, ident) == dumps(document(ident, name="d"))
    assert git(clone, "status", "--porcelain=v1").strip() == f"D {relative(espace, ident)}"
    propre(racine)


def test_une_modification_indexee_dans_le_clone_n_est_jamais_perdue(tmp_path: Path) -> None:
    racine = init(tmp_path / "contenus")
    depot = repository(racine)
    espace, ident = new_id(), new_id()
    ecrire(depot, espace, ident)
    assert not (racine / "index").exists()
    clone = cloner(racine, tmp_path / "clone")
    chemin = clone / relative(espace, ident)
    chemin.write_bytes(chemin.read_bytes() + b"# indexe a la main\n")
    git(clone, "add", relative(espace, ident))
    stagee = git(clone, "diff", "--cached")
    assert stagee != ""
    depot.write(espace, ident, document(ident, name="b"), expected_revision=1, actor=ACTOR)
    assert git(clone, "diff", "--cached") == stagee
    assert chemin.read_bytes().endswith(b"# indexe a la main\n")
    assert not (racine / "index").exists()
    propre(racine)


def test_une_modification_faite_pendant_la_publication_n_est_jamais_ecrasee(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    racine = init(tmp_path / "contenus")
    depot = repository(racine)
    espace, ident = new_id(), new_id()
    ecrire(depot, espace, ident)
    clone = cloner(racine, tmp_path / "clone")
    chemin = clone / relative(espace, ident)
    reel = repository_module._Git.run

    def run(self: Any, args: Any, **kwargs: Any) -> Any:
        resultat = reel(self, args, **kwargs)
        if args[0] == "update-ref":
            chemin.write_bytes(b"# entre la publication et la fin\n")
        return resultat

    monkeypatch.setattr(repository_module._Git, "run", run)
    deux = depot.write(espace, ident, document(ident, name="b"), expected_revision=1, actor=ACTOR)
    monkeypatch.undo()
    assert deux.revision.number == 2
    assert chemin.read_bytes() == b"# entre la publication et la fin\n"
    assert fichier(racine, espace, ident) == dumps(document(ident, name="b"))


def test_un_fichier_au_nom_temporaire_previsible_n_est_jamais_supprime(tmp_path: Path) -> None:
    racine = init(tmp_path / "contenus")
    depot = repository(racine)
    espace, ident = new_id(), new_id()
    dossier = racine / "analyses" / espace
    dossier.mkdir(parents=True)
    (dossier / f".{ident}.yaml.tmp").write_text("a moi\n")
    (dossier / f"{ident}.yaml").write_text("a moi aussi\n")
    avant = instantane(racine)
    ecrire(depot, espace, ident)
    depot.write(espace, ident, document(ident, name="b"), expected_revision=1, actor=ACTOR)
    depot.delete(espace, ident, expected_revision=2, actor=ACTOR)
    assert (dossier / f".{ident}.yaml.tmp").read_text() == "a moi\n"
    assert (dossier / f"{ident}.yaml").read_text() == "a moi aussi\n"
    apres = instantane(racine)
    assert set(apres) - set(avant) == {repository_module.LOCK_NAME}
    assert {k: v for k, v in apres.items() if k != repository_module.LOCK_NAME} == avant
    clone = cloner(racine, tmp_path / "clone")
    assert not (clone / "analyses" / espace / f".{ident}.yaml.tmp").exists()


def test_board_n_ecrit_que_des_objets_des_references_et_son_verrou(tmp_path: Path) -> None:
    racine = init(tmp_path / "contenus", commit=True)
    depot = repository(racine)
    avant = instantane(racine)
    espace, ident = new_id(), new_id()
    ecrire(depot, espace, ident)
    depot.write(espace, ident, document(ident, name="b"), expected_revision=1, actor=ACTOR)
    depot.read(espace, ident, 1)
    depot.delete(espace, ident, expected_revision=2, actor=ACTOR)
    apres = instantane(racine)
    assert set(apres) - set(avant) == {repository_module.LOCK_NAME}
    assert {k: v for k, v in apres.items() if k != repository_module.LOCK_NAME} == avant
    assert not (racine / "analyses").exists()
    refs = sorted(
        p.relative_to(racine).as_posix() for p in (racine / "refs").rglob("*") if p.is_file()
    )
    assert refs == ["refs/heads/master"]
    nouveaux = [p for p in (racine / "objects").rglob("*") if p.is_file() and "pack" not in p.parts]
    assert nouveaux
    assert not [
        p
        for p in racine.rglob("*")
        if p.name.endswith((".tmp", ".lock")) and p.name != repository_module.LOCK_NAME
    ]
    # L'exploitant lit le contenu par un clone, qui voit la suppression.
    clone = cloner(racine, tmp_path / "clone")
    assert not (clone / "analyses").exists()
    assert git(clone, "rev-list", "--count", "HEAD").strip() == "4"
    assert os.listdir(clone / ".git") != []
