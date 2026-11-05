"""Un dépôt piégé n'exécute jamais de programme lancé par Board (plan 18, A1).

Le piège est réel : attributs dans l'arbre et dans `info/attributes`, filtres clean, smudge et
process, textconv, fsmonitor, hooks, inclusion de configuration. Chaque mécanisme dépose un
témoin dans un dossier de marques ; le test d'activité montre que git, lancé sans les
protections de Board, les exécute bel et bien. Deux couches sont éprouvées séparément : la
liste blanche de configuration, qui refuse le dépôt piégé, et, cette liste neutralisée, les
commandes de Board elles-mêmes, qui ne lancent rien.
"""

from __future__ import annotations

import stat
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from skifer_board.content import ContentError, ContentRepository
from skifer_board.content import repository as repository_module

from .monde import ACTOR, commit, document, fichier, git, init, new_id, repository


def script(chemin: Path, corps: str) -> str:
    chemin.write_text(f"#!/bin/sh\n{corps}\n")
    chemin.chmod(chemin.stat().st_mode | stat.S_IXUSR)
    return str(chemin)


def marques(dossier: Path) -> list[str]:
    return sorted(p.name for p in dossier.iterdir())


def installer(racine: Path, gitdir: Path, tmp_path: Path) -> Path:
    """Pose attributs, configuration et hooks piégés ; rend le dossier des témoins."""
    temoins = tmp_path / "temoins"
    temoins.mkdir()
    (gitdir / "info").mkdir(exist_ok=True)
    (gitdir / "info" / "attributes").write_text("* filter=evil diff=evil\n")
    outils = tmp_path / "outils"
    outils.mkdir()

    def temoin(nom: str, suite: str = "cat") -> str:
        return script(outils / nom, f'touch "{temoins}/{nom}"\n{suite}')

    inclus = tmp_path / "inclus.config"
    inclus.write_text(f'[filter "autre"]\n\tclean = {temoin("inclus")}\n')
    configuration = {
        "filter.evil.clean": temoin("clean"),
        "filter.evil.smudge": temoin("smudge"),
        "filter.evil.process": temoin("process", "exit 1"),
        "diff.evil.textconv": temoin("textconv", 'cat "$1"'),
        "core.fsmonitor": temoin("fsmonitor", "printf 'jeton\\0/\\0'"),
        "include.path": str(inclus),
    }
    for cle, valeur in configuration.items():
        git(racine, "config", "--local", cle, valeur)
    for nom in ("pre-commit", "post-commit", "reference-transaction", "post-index-change"):
        script(gitdir / "hooks" / nom, f'touch "{temoins}/hook"')
    return temoins


def piege(tmp_path: Path) -> tuple[Path, Path]:
    """Dépôt nu piégé, avec ses attributs versionnés ; et le dossier des témoins."""
    racine = init(tmp_path / "contenus", commit=True)
    commit(racine, {".gitattributes": b"*.yaml filter=evil diff=evil merge=evil\n"}, "attributs")
    return racine, installer(racine, racine, tmp_path)


def test_le_piege_est_actif_quand_git_n_est_pas_protege(tmp_path: Path) -> None:
    racine = tmp_path / "vivant"
    racine.mkdir()
    git(racine, "init", "-q")
    (racine / ".gitattributes").write_text("*.yaml filter=evil diff=evil\n")
    temoins = installer(racine, racine / ".git", tmp_path)
    # Un filtre `process` qui échoue interrompt git : on ne garde que clean et smudge.
    git(racine, "config", "--local", "--unset", "filter.evil.process")
    fichier_yaml = racine / "analyses" / "x.yaml"
    fichier_yaml.parent.mkdir()
    fichier_yaml.write_text("a: 1\n")
    git(racine, "add", "analyses/x.yaml")
    git(racine, "commit", "-q", "-m", "x")
    git(racine, "status", "--porcelain=v1")
    fichier_yaml.write_text("a: 2\n")
    git(racine, "diff", "--textconv")
    fichier_yaml.unlink()
    git(racine, "checkout", "--", "analyses/x.yaml")
    assert set(marques(temoins)) >= {"clean", "hook", "smudge", "textconv", "fsmonitor"}


def parcours(depot: ContentRepository, temoins: Path) -> None:
    """Écriture, lecture, historique, diff, révision et suppression ; aucun témoin entre deux."""
    temoins.mkdir(exist_ok=True)
    espace, ident = new_id(), new_id()
    un = depot.write(espace, ident, document(ident), expected_revision=None, actor=ACTOR)
    assert marques(temoins) == []
    assert depot.read(espace, ident).revision == un.revision
    assert [r.number for r in depot.history(espace, ident)] == [1]
    assert marques(temoins) == []
    deux = depot.write(espace, ident, document(ident, name="b"), expected_revision=1, actor=ACTOR)
    assert deux.revision.number == 2
    assert depot.read(espace, ident, 1).document["name"] == "Chiffre d'affaires"
    assert [c.path for c in depot.diff(espace, ident, 1, 2)] == ["/name"]
    assert marques(temoins) == []
    depot.delete(espace, ident, expected_revision=2, actor=ACTOR)
    assert [r.action for r in depot.history(espace, ident)] == ["save", "save", "delete"]
    assert marques(temoins) == []


def test_aucune_commande_de_board_n_execute_le_piege(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Liste blanche neutralisée : les seules commandes de Board ne lancent rien."""
    racine, temoins = piege(tmp_path)
    monkeypatch.setattr(ContentRepository, "_check_config", staticmethod(lambda place: None))
    parcours(repository(racine), temoins)
    espace, ident = new_id(), new_id()
    contenu = document(ident, description="a\nb")
    repository(racine).write(espace, ident, contenu, expected_revision=None, actor=ACTOR)
    assert fichier(racine, espace, ident) is not None
    assert repository(racine).read(espace, ident).document["description"] == "a\nb"
    assert marques(temoins) == []
    git(racine, "fsck", "--strict", "--no-dangling")


def operations(depot: ContentRepository) -> list[Callable[[], Any]]:
    espace, ident = new_id(), new_id()
    return [
        lambda: depot.write(espace, ident, document(ident), expected_revision=None, actor=ACTOR),
        lambda: depot.read(espace, ident),
        lambda: depot.history(espace, ident),
        lambda: depot.diff(espace, ident, 1, 2),
        lambda: depot.delete(espace, ident, expected_revision=1, actor=ACTOR),
    ]


def test_un_depot_piege_est_refuse_avant_toute_commande(tmp_path: Path) -> None:
    racine, temoins = piege(tmp_path)
    avant = git(racine, "rev-parse", "HEAD")
    depot = repository(racine)
    for appel in operations(depot):
        with pytest.raises(ContentError) as erreur:
            appel()
        assert (erreur.value.code, erreur.value.reason) == ("content_unavailable", "unsafe_config")
        assert erreur.value.violations == ()
    assert marques(temoins) == []
    assert git(racine, "rev-parse", "HEAD") == avant
    assert not (racine / "analyses").exists()


# Chacune de ces clés désigne un programme, en modifie la sélection ou est inconnue : refusée.
REFUSEES = [
    ("filter.evil.clean", "true"),
    ("filter.evil.smudge", "true"),
    ("filter.evil.process", "true"),
    ("filter.evil.required", "true"),
    ("diff.evil.textconv", "true"),
    ("diff.evil.command", "true"),
    ("diff.external", "true"),
    ("merge.evil.driver", "true"),
    ("difftool.evil.cmd", "true"),
    ("mergetool.evil.cmd", "true"),
    ("core.fsmonitor", "true"),
    ("core.sshCommand", "true"),
    ("core.pager", "true"),
    ("core.editor", "true"),
    ("core.askPass", "true"),
    ("core.gitProxy", "true"),
    ("core.hooksPath", "/tmp"),
    ("core.attributesFile", "/tmp/attributs"),
    ("core.worktree", "/tmp"),
    ("core.autocrlf", "true"),
    ("core.futureSetting", "x"),
    ("future.section.key", "x"),
    ("extensions.worktreeConfig", "true"),
    ("include.path", "/tmp/inclus"),
    ("includeIf.gitdir:/tmp/.path", "/tmp/inclus"),
    ("alias.ls", "!true"),
    ("credential.helper", "true"),
    ("credential.https://exemple.test.helper", "true"),
    ("gpg.program", "true"),
    ("gpg.ssh.program", "true"),
    ("gpg.ssh.defaultKeyCommand", "true"),
    ("uploadpack.packObjectsHook", "true"),
    ("receive.procReceiveRefs", "refs/x"),
    ("receive.denyNonFastForwards", "true"),
    ("sequence.editor", "true"),
    ("remote.origin.vcs", "true"),
    ("remote.origin.uploadpack", "true"),
    ("remote.origin.pushurl", "https://exemple.test"),
    ("user.name", "Exploitant"),
    ("branch.master.remote", "origin"),
    ("push.default", "current"),
    ("commit.gpgsign", "true"),
    ("gc.pruneExpire.extra", "x"),
    ("gc.recentObjectsHook", "true"),
    ("gc.cruftPacks", "false"),
    ("gc.logExpiry", "1.day"),
    ("gc.writeCommitGraph", "false"),
    ("gc.refs/heads/*.reflogExpire", "1"),
    ("url.https://exemple.test/.insteadOf", "ext::"),
]


@pytest.mark.parametrize(("cle", "valeur"), REFUSEES, ids=[c for c, _ in REFUSEES])
def test_une_cle_hors_de_la_liste_blanche_est_refusee(
    tmp_path: Path, cle: str, valeur: str
) -> None:
    racine = init(tmp_path / "contenus", commit=True)
    git(racine, "config", "--local", cle, valeur)
    avant = git(racine, "rev-parse", "HEAD")
    for appel in operations(repository(racine)):
        with pytest.raises(ContentError) as erreur:
            appel()
        assert (erreur.value.code, erreur.value.reason) == ("content_unavailable", "unsafe_config")
    assert git(racine, "rev-parse", "HEAD") == avant
    assert not (racine / "analyses").exists()
    assert not (racine / repository_module.LOCK_NAME).exists()


ACCEPTEES = {
    "core.sharedRepository": "group",
    "core.logAllRefUpdates": "true",
    "core.symlinks": "false",
    "core.ignoreCase": "true",
    "core.precomposeUnicode": "true",
    "core.repositoryFormatVersion": "1",
    "extensions.objectFormat": "sha1",
    "gc.reflogExpire": "30",
    "gc.reflogExpireUnreachable": "30",
    "gc.auto": "0",
    "gc.autoPackLimit": "50",
    "gc.bigPackThreshold": "2g",
    "gc.pruneExpire": "2.weeks.ago",
    "remote.origin.url": "https://exemple.invalid/contenus.git",
    "remote.origin.fetch": "+refs/heads/*:refs/remotes/origin/*",
    "remote.mirror.v2.url": "https://exemple.invalid/miroir.git",
}


def test_une_configuration_de_depot_nu_ordinaire_est_acceptee(tmp_path: Path) -> None:
    racine = init(tmp_path / "contenus", commit=True)
    for cle, valeur in ACCEPTEES.items():
        git(racine, "config", "--local", cle, valeur)
    espace, ident = new_id(), new_id()
    sauvee = repository(racine).write(
        espace, ident, document(ident), expected_revision=None, actor=ACTOR
    )
    assert sauvee.revision.number == 1
    assert fichier(racine, espace, ident) is not None


def test_la_liste_blanche_est_insensible_a_la_casse_et_complete() -> None:
    def admise(cle: str) -> bool:
        return repository_module._ALLOWED.fullmatch(cle) is not None

    assert all(admise(cle) and admise(cle.upper()) for cle in ACCEPTEES)
    assert not any(admise(cle) for cle, _ in REFUSEES)
    assert not admise("core.filemodes") and not admise("xcore.filemode")
    assert not admise("gc.") and not admise("gc.a.b") and not admise("remote.origin.urlx")


def test_une_url_de_depot_distant_n_est_jamais_lue_ni_executee(tmp_path: Path) -> None:
    """`remote.*.url` est admise : aucune commande de Board ne contacte un dépôt distant."""
    racine = init(tmp_path / "contenus", commit=True)
    temoin = tmp_path / "ext-lance"
    outil = script(tmp_path / "ext.sh", f'touch "{temoin}"')
    git(racine, "config", "--local", "remote.origin.url", f"ext::{outil} %S")
    git(racine, "config", "--local", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*")
    # Témoin d'activité : un transport explicitement autorisé lance bien l'outil.
    git(racine, "-c", "protocol.ext.allow=always", "ls-remote", "origin", check=False)
    assert temoin.exists()
    temoin.unlink()
    parcours(repository(racine), tmp_path / "vide")
    assert not temoin.exists()
