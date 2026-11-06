"""Dépôt absent, inattendu ou altéré : `content_unavailable` et rien d'écrit (plan 18, A1)."""

from __future__ import annotations

import errno
import fcntl
import os
import stat
import subprocess
import tempfile
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from skifer_board.content import ContentConfig, ContentError, ContentRepository, dumps
from skifer_board.content import repository as repository_module
from skifer_board.content.repository import LOCK_NAME

from .monde import (
    ACTOR,
    GIT,
    commit,
    document,
    fichier,
    git,
    init,
    new_id,
    propre,
    relative,
    repository,
)

INSTANT = datetime(2026, 11, 5, 12, 30, 15, tzinfo=UTC)


def ecrire(depot: ContentRepository, espace: str, ident: str, **modif: Any) -> Any:
    return depot.write(espace, ident, document(ident, **modif), expected_revision=None, actor=ACTOR)


def refus(appel: Callable[[], Any], raison: str, code: str = "content_unavailable") -> None:
    with pytest.raises(ContentError) as erreur:
        appel()
    assert (erreur.value.code, erreur.value.reason) == (code, raison)
    assert erreur.value.violations == ()


def tete(racine: Path) -> str:
    return git(racine, "rev-parse", "HEAD").strip()


def ecriture(depot: ContentRepository) -> Callable[[], Any]:
    ident = new_id()
    return lambda: ecrire(depot, new_id(), ident)


# -- dépôt absent ou inattendu -------------------------------------------------------------


def test_chemin_relatif(tmp_path: Path) -> None:
    depot = ContentRepository(ContentConfig(Path("contenus")))
    refus(ecriture(depot), "relative_path")
    refus(lambda: depot.read(new_id(), new_id()), "relative_path")


def test_depot_absent_ou_fichier(tmp_path: Path) -> None:
    refus(ecriture(repository(tmp_path / "absent")), "repository_missing")
    (tmp_path / "fichier").write_text("x")
    refus(ecriture(repository(tmp_path / "fichier")), "repository_missing")


def test_un_dossier_qui_n_est_pas_un_depot_ne_remonte_pas_au_depot_parent(tmp_path: Path) -> None:
    parent = init(tmp_path / "parent")
    enfant = parent / "sous-dossier"
    enfant.mkdir()
    refus(ecriture(repository(enfant)), "git_failed")
    assert not (parent / "analyses").exists()
    assert not (enfant / "analyses").exists()


def test_git_absent(tmp_path: Path) -> None:
    racine = init(tmp_path / "contenus")
    refus(ecriture(repository(racine, git="git-inexistant-xyz")), "git_missing")


def test_depot_sur_une_branche_exotique_ou_detachee(tmp_path: Path) -> None:
    racine = init(tmp_path / "contenus", commit=True)
    depot = repository(racine)
    espace, ident = new_id(), new_id()
    ecrire(depot, espace, ident)
    avant = tete(racine)
    git(racine, "update-ref", "--no-deref", "HEAD", avant)
    refus(ecriture(depot), "detached_head")
    assert depot.read(espace, ident).revision.number == 1
    git(racine, "symbolic-ref", "HEAD", "refs/heads/master")
    git(racine, "symbolic-ref", "HEAD", "refs/heads/café")
    refus(ecriture(depot), "unexpected_branch")
    git(racine, "symbolic-ref", "HEAD", "refs/heads/master")
    assert tete(racine) == avant


@pytest.mark.parametrize("marque", ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "BISECT_LOG"])
def test_fusion_ou_operation_en_cours(tmp_path: Path, marque: str) -> None:
    racine = init(tmp_path / "contenus", commit=True)
    depot = repository(racine)
    espace, ident = new_id(), new_id()
    ecrire(depot, espace, ident)
    avant = tete(racine)
    (racine / marque).write_text("x\n")
    refus(ecriture(depot), "operation_in_progress")
    refus(
        lambda: depot.write(
            espace, ident, document(ident, name="b"), expected_revision=1, actor=ACTOR
        ),
        "operation_in_progress",
    )
    refus(
        lambda: depot.delete(espace, ident, expected_revision=1, actor=ACTOR),
        "operation_in_progress",
    )
    assert depot.read(espace, ident).revision.number == 1
    assert tete(racine) == avant


@pytest.mark.parametrize("dossier", ["rebase-merge", "rebase-apply", "sequencer"])
def test_rebase_en_cours(tmp_path: Path, dossier: str) -> None:
    racine = init(tmp_path / "contenus", commit=True)
    (racine / dossier).mkdir()
    refus(ecriture(repository(racine)), "operation_in_progress")


# -- verrou --------------------------------------------------------------------------------


def test_verrou_occupe_au_dela_du_delai(tmp_path: Path) -> None:
    racine = init(tmp_path / "contenus")
    depot = repository(racine, config={"lock_timeout": 0.05})
    espace, ident = new_id(), new_id()
    ecrire(depot, espace, ident)
    avant = tete(racine)
    descripteur = os.open(racine / LOCK_NAME, os.O_RDWR)
    try:
        fcntl.flock(descripteur, fcntl.LOCK_EX)
        refus(ecriture(depot), "lock_unavailable")
        refus(
            lambda: depot.delete(espace, ident, expected_revision=1, actor=ACTOR),
            "lock_unavailable",
        )
        assert depot.read(espace, ident).revision.number == 1
    finally:
        os.close(descripteur)
    assert tete(racine) == avant
    assert depot.delete(espace, ident, expected_revision=1, actor=ACTOR).number == 1


def test_erreur_du_verrou_autre_qu_une_attente(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    racine = init(tmp_path / "contenus")

    def impossible(*_: Any) -> None:
        raise OSError(errno.ENOLCK, "pas de verrou")

    monkeypatch.setattr(fcntl, "flock", impossible)
    refus(ecriture(repository(racine)), "lock_unavailable")


def test_fichier_verrou_refuse_en_cas_de_lien(tmp_path: Path) -> None:
    racine = init(tmp_path / "contenus")
    (racine / LOCK_NAME).symlink_to(tmp_path / "ailleurs")
    refus(ecriture(repository(racine)), "io_error")
    assert not (tmp_path / "ailleurs").exists()


# -- histoire altérée ----------------------------------------------------------------------


def commit_etranger(racine: Path, espace: str, ident: str, contenu: bytes, message: str) -> str:
    return commit(racine, {relative(espace, ident): contenu}, message)


def trailers(numero: int, action: str, acteur: str) -> str:
    return f"\n\nBoard-Revision: {numero}\nBoard-Action: {action}\nBoard-Actor: {acteur}\n"


WHO = '{"issuer":"https://idp.example.test","subject":"user-0001"}'


def message_board(espace: str, ident: str, numero: int, action: str = "save") -> str:
    return repository_module._message(espace, ident, numero, action, ACTOR)


@pytest.mark.parametrize(
    "fabrique",
    [
        lambda e, i: "modification à la main",
        lambda e, i: f"analysis {e}/{i}: save r1",
        lambda e, i: f"analysis {e}/{i}: save r1" + trailers(1, "save", "pas du json"),
        lambda e, i: f"analysis {e}/{i}: save r1" + trailers(1, "save", "[]"),
        lambda e, i: f"analysis {e}/{i}: save r1" + trailers(1, "save", '{"issuer":"a"}'),
        lambda e, i: (
            f"analysis {e}/{i}: save r1" + trailers(1, "save", '{"issuer":1,"subject":"b"}')
        ),
        lambda e, i: (
            f"analysis {e}/{i}: save r1"
            + trailers(1, "save", '{"issuer":"a","subject":"b\\u0001"}')
        ),
        lambda e, i: f"analysis {e}/{i}: save r2" + trailers(2, "save", WHO),
        lambda e, i: f"analysis {e}/{i}: save r1" + trailers(1, "delete", WHO),
        lambda e, i: f"analysis {new_id()}/{i}: save r1" + trailers(1, "save", WHO),
        lambda e, i: f"analysis {e}/{i}: save r1" + trailers(1, "save", WHO) + "ligne en trop\n",
        lambda e, i: f"analysis {e}/{i}: save r1" + trailers(1, "save", WHO).replace("1", "01", 1),
        lambda e, i: "a\x1eb",
    ],
)
def test_une_histoire_qui_n_est_pas_celle_de_board_rend_le_contenu_indisponible(
    tmp_path: Path, fabrique: Callable[[str, str], str]
) -> None:
    racine = init(tmp_path / "contenus", commit=True)
    espace, ident = new_id(), new_id()
    from skifer_board.content import dumps

    avant = commit_etranger(racine, espace, ident, dumps(document(ident)), fabrique(espace, ident))
    depot = repository(racine)
    for appel in (
        lambda: depot.read(espace, ident),
        lambda: depot.history(espace, ident),
        lambda: depot.write(espace, ident, document(ident), expected_revision=1, actor=ACTOR),
        lambda: depot.delete(espace, ident, expected_revision=1, actor=ACTOR),
    ):
        refus(appel, "history_inconsistent")
    assert tete(racine) == avant


def test_numerotation_rompue_ou_commit_apres_suppression(tmp_path: Path) -> None:
    from skifer_board.content import dumps

    def contenu(i: str) -> bytes:
        return dumps(document(i))

    racine = init(tmp_path / "a", commit=True)
    espace, ident = new_id(), new_id()
    commit_etranger(racine, espace, ident, contenu(ident), message_board(espace, ident, 1))
    commit_etranger(racine, espace, ident, contenu(ident) + b"\n", message_board(espace, ident, 3))
    refus(lambda: repository(racine).read(espace, ident), "history_inconsistent")

    racine = init(tmp_path / "b", commit=True)
    commit_etranger(racine, espace, ident, contenu(ident), message_board(espace, ident, 1))
    commit(racine, {relative(espace, ident): None}, message_board(espace, ident, 2, "delete"))
    refus(lambda: repository(racine).read(espace, ident, 1), "history_inconsistent")

    racine = init(tmp_path / "c", commit=True)
    commit_etranger(racine, espace, ident, contenu(ident), message_board(espace, ident, 1))
    commit(racine, {relative(espace, ident): None}, message_board(espace, ident, 1, "delete"))
    commit_etranger(racine, espace, ident, contenu(ident), message_board(espace, ident, 2))
    refus(lambda: repository(racine).history(espace, ident), "history_inconsistent")

    racine = init(tmp_path / "d", commit=True)
    commit_etranger(racine, espace, ident, contenu(ident), message_board(espace, ident, 1))
    commit(racine, {relative(espace, ident): None}, message_board(espace, ident, 1, "delete"))
    assert [r.action for r in repository(racine).history(espace, ident)] == ["save", "delete"]


def test_suppression_sans_creation_et_contenu_stocke_invalide(tmp_path: Path) -> None:
    from skifer_board.content import dumps

    racine = init(tmp_path / "a", commit=True)
    espace, ident = new_id(), new_id()
    commit_etranger(
        racine, espace, ident, dumps(document(ident)), message_board(espace, ident, 1, "delete")
    )
    refus(lambda: repository(racine).history(espace, ident), "history_inconsistent")

    racine = init(tmp_path / "b", commit=True)
    commit_etranger(racine, espace, ident, b"sql: SELECT 1\n", message_board(espace, ident, 1))
    refus(lambda: repository(racine).read(espace, ident), "stored_invalid")

    racine = init(tmp_path / "c", commit=True)
    commit_etranger(
        racine, espace, ident, dumps(document(new_id())), message_board(espace, ident, 1)
    )
    refus(lambda: repository(racine).read(espace, ident), "stored_mismatch")


def test_document_stocke_trop_gros(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    racine = init(tmp_path / "contenus")
    depot = repository(racine)
    espace, ident = new_id(), new_id()
    ecrire(depot, espace, ident)
    monkeypatch.setattr(repository_module, "MAX_DOCUMENT_BYTES", 10)
    refus(lambda: depot.read(espace, ident), "document_too_large")


# -- échecs en cours d'écriture ------------------------------------------------------------


def deplacer_la_tete_apres(monkeypatch: pytest.MonkeyPatch, racine: Path, commande: str) -> None:
    reel = repository_module._Git.run
    fait: list[bool] = []

    def run(self: Any, args: Any, **kwargs: Any) -> Any:
        resultat = reel(self, args, **kwargs)
        if args[0] == commande and not fait:
            fait.append(True)
            commit(racine, {}, "autre processus")
        return resultat

    monkeypatch.setattr(repository_module._Git, "run", run)


def test_branche_deplacee_pendant_une_creation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    racine = init(tmp_path / "contenus", commit=True)
    depot = repository(racine)
    deplacer_la_tete_apres(monkeypatch, racine, "commit-tree")
    espace, ident = new_id(), new_id()
    refus(lambda: ecrire(depot, espace, ident), "head_moved")
    assert git(racine, "log", "-1", "--format=%s").strip() == "autre processus"
    assert git(racine, "rev-list", "--count", "HEAD").strip() == "2"
    assert fichier(racine, espace, ident) is None
    propre(racine)


def test_branche_deplacee_pendant_la_premiere_ecriture_d_un_depot_vide(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    racine = init(tmp_path / "contenus")
    deplacer_la_tete_apres(monkeypatch, racine, "commit-tree")
    espace, ident = new_id(), new_id()
    refus(lambda: ecrire(repository(racine), espace, ident), "head_moved")
    assert git(racine, "rev-list", "--count", "HEAD").strip() == "1"
    assert fichier(racine, espace, ident) is None


def test_branche_deplacee_pendant_une_revision_ou_une_suppression(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    racine = init(tmp_path / "contenus")
    depot = repository(racine)
    espace, ident = new_id(), new_id()
    ecrire(depot, espace, ident)
    with monkeypatch.context() as contexte:
        deplacer_la_tete_apres(contexte, racine, "commit-tree")
        refus(
            lambda: depot.write(
                espace, ident, document(ident, name="b"), expected_revision=1, actor=ACTOR
            ),
            "head_moved",
        )
    with monkeypatch.context() as contexte:
        deplacer_la_tete_apres(contexte, racine, "commit-tree")
        refus(lambda: depot.delete(espace, ident, expected_revision=1, actor=ACTOR), "head_moved")
    assert fichier(racine, espace, ident) == dumps(document(ident))
    propre(racine)
    assert [r.number for r in depot.history(espace, ident)] == [1]


def test_la_publication_est_le_dernier_acte_et_l_issue_est_exacte(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Après `update-ref` Board ne lance plus rien : aucune étape ne peut échouer ensuite."""
    racine = init(tmp_path / "contenus")
    depot = repository(racine, clock=lambda: INSTANT)
    vues: list[str] = []
    reel = repository_module._Git.run

    def run(self: Any, args: Any, **kwargs: Any) -> Any:
        vues.append(args[0])
        return reel(self, args, **kwargs)

    monkeypatch.setattr(repository_module._Git, "run", run)
    espace, ident = new_id(), new_id()
    creee = ecrire(depot, espace, ident)
    assert vues[-1] == "update-ref"
    assert vues.count("update-ref") == 1
    vues.clear()
    supprimee = depot.delete(espace, ident, expected_revision=1, actor=ACTOR)
    assert vues[-1] == "update-ref"
    assert vues.count("update-ref") == 1
    monkeypatch.undo()
    assert supprimee.commit == tete(racine)
    assert supprimee.committed_at == INSTANT.replace(microsecond=0)
    assert depot.history(espace, ident) == (creee.revision, supprimee)
    propre(racine)


def test_une_erreur_du_systeme_de_fichiers_avant_la_publication_ne_laisse_rien(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    racine = init(tmp_path / "contenus", commit=True)
    avant = tete(racine)

    def impossible(*_: Any, **__: Any) -> None:
        raise PermissionError(errno.EACCES, "refusé")

    with monkeypatch.context() as contexte:
        contexte.setattr(tempfile, "mkdtemp", impossible)
        refus(ecriture(repository(racine)), "io_error")
    assert tete(racine) == avant
    propre(racine)


def test_une_erreur_de_update_ref_sans_effet_ne_publie_rien_et_se_rejoue(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    racine = init(tmp_path / "contenus", commit=True)
    depot = repository(racine)
    avant = tete(racine)
    reel = repository_module._Git.run

    def run(self: Any, args: Any, **kwargs: Any) -> Any:
        if args[0] == "update-ref":
            raise ContentError("content_unavailable", "git_failed")
        return reel(self, args, **kwargs)

    espace, ident = new_id(), new_id()
    with monkeypatch.context() as contexte:
        contexte.setattr(repository_module._Git, "run", run)
        refus(lambda: ecrire(depot, espace, ident), "git_failed")
    assert tete(racine) == avant
    propre(racine)
    assert ecrire(depot, espace, ident).revision.number == 1


def apres_update_ref(
    monkeypatch: pytest.MonkeyPatch,
    *,
    apres: Callable[[], object] | None = None,
    effet: bool = True,
    illisible: bool = False,
    merge_base_en_echec: bool = False,
    code: int | None = None,
) -> None:
    """`update-ref` « échoue » au retour sans réponse de git (délai, erreur de lancement).

    `effet` : le vrai `update-ref` a d'abord réussi ; `apres` : un autre acteur agit ensuite sur
    la référence ; `illisible` : git ne répond plus à la relecture de la référence ; `code` :
    `update-ref` rend ce code de retour au lieu de lever (`-9` : tué par un signal).
    """
    reel = repository_module._Git.run
    publie: list[bool] = []

    def run(self: Any, args: Any, **kwargs: Any) -> Any:
        if publie and illisible and args[0] in {"show-ref", "rev-parse"}:
            raise ContentError("content_unavailable", "git_failed")
        if publie and merge_base_en_echec and args[0] == "merge-base":
            raise ContentError("content_unavailable", "git_failed")
        if args[0] == "update-ref" and not publie:
            if effet:
                reel(self, args, **kwargs)
            publie.append(True)
            if apres is not None:
                apres()
            if code is not None:
                return subprocess.CompletedProcess(args, code, b"", b"")
            raise ContentError("content_unavailable", "git_failed")
        return reel(self, args, **kwargs)

    monkeypatch.setattr(repository_module._Git, "run", run)


def remplacer_la_branche(racine: Path) -> None:
    """Un autre outil remplace la branche par un commit racine qui n'a rien de commun."""
    arbre = git(racine, "hash-object", "-t", "tree", "-w", "--stdin", input="").strip()
    autre = git(racine, "commit-tree", arbre, "-m", "remplacement").strip()
    git(racine, "update-ref", git(racine, "symbolic-ref", "HEAD").strip(), autre)


def test_update_ref_publie_puis_echoue_au_retour_et_la_reference_est_la_notre(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    racine = init(tmp_path / "contenus", commit=True)
    depot = repository(racine)
    espace, ident = new_id(), new_id()
    with monkeypatch.context() as contexte:
        apres_update_ref(contexte)
        creee = ecrire(depot, espace, ident)
    assert creee.revision.number == 1
    assert creee.revision.commit == tete(racine)
    assert depot.read(espace, ident).revision == creee.revision
    assert [r.number for r in depot.history(espace, ident)] == [1]
    propre(racine)
    # Une nouvelle tentative avec la même attente est sûre : rien n'est écrit deux fois.
    refus(lambda: ecrire(depot, espace, ident), "exists", "revision_conflict")
    with monkeypatch.context() as contexte:
        apres_update_ref(contexte)
        suivante = depot.write(
            espace, ident, document(ident, name="b"), expected_revision=1, actor=ACTOR
        )
    assert suivante.revision.number == 2 and suivante.revision.commit == tete(racine)
    refus(
        lambda: depot.write(
            espace, ident, document(ident, name="b"), expected_revision=1, actor=ACTOR
        ),
        "stale",
        "revision_conflict",
    )
    with monkeypatch.context() as contexte:
        apres_update_ref(contexte)
        supprimee = depot.delete(espace, ident, expected_revision=2, actor=ACTOR)
    assert (
        supprimee.number == 2 and supprimee.action == "delete" and supprimee.commit == tete(racine)
    )
    assert [r.action for r in depot.history(espace, ident)] == ["save", "save", "delete"]
    # Rejouer la suppression : l'analyse est supprimée, comme pour toute opération sur elle.
    refus(
        lambda: depot.delete(espace, ident, expected_revision=2, actor=ACTOR),
        "missing",
        "analysis_not_found",
    )


def test_update_ref_publie_puis_un_autre_outil_ajoute_un_descendant(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    racine = init(tmp_path / "contenus", commit=True)
    depot = repository(racine)
    espace, ident = new_id(), new_id()
    with monkeypatch.context() as contexte:
        apres_update_ref(contexte, apres=lambda: commit(racine, {}, "autre processus"))
        creee = ecrire(depot, espace, ident)
    assert creee.revision.number == 1
    assert git(racine, "log", "-1", "--format=%s").strip() == "autre processus"
    assert creee.revision.commit == git(racine, "rev-parse", "HEAD~1").strip()
    assert depot.read(espace, ident).revision == creee.revision
    propre(racine)


def test_update_ref_publie_puis_la_branche_est_remplacee(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    racine = init(tmp_path / "contenus", commit=True)
    espace, ident = new_id(), new_id()
    with monkeypatch.context() as contexte:
        apres_update_ref(contexte, apres=lambda: remplacer_la_branche(racine))
        refus(lambda: ecrire(repository(racine), espace, ident), "outcome_unknown")
    assert fichier(racine, espace, ident) is None
    propre(racine)


def test_update_ref_publie_puis_la_branche_disparait(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    racine = init(tmp_path / "contenus", commit=True)
    branche = racine / git(racine, "symbolic-ref", "HEAD").strip()
    with monkeypatch.context() as contexte:
        apres_update_ref(contexte, apres=branche.unlink)
        refus(lambda: ecrire(repository(racine), new_id(), new_id()), "outcome_unknown")


def test_update_ref_publie_puis_l_ancetre_ne_peut_pas_etre_verifie(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    racine = init(tmp_path / "contenus", commit=True)
    with monkeypatch.context() as contexte:
        apres_update_ref(
            contexte,
            apres=lambda: commit(racine, {}, "autre processus"),
            merge_base_en_echec=True,
        )
        refus(lambda: ecrire(repository(racine), new_id(), new_id()), "outcome_unknown")


@pytest.mark.parametrize("code", [-9, -15])
def test_update_ref_tue_par_un_signal_vaut_une_absence_de_reponse(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, code: int
) -> None:
    """Un code négatif n'est pas un refus : git a pu publier avant d'être interrompu."""
    racine = init(tmp_path / "contenus", commit=True)
    depot = repository(racine)
    avant = tete(racine)
    # Tête = notre commit : succès.
    espace, ident = new_id(), new_id()
    with monkeypatch.context() as contexte:
        apres_update_ref(contexte, code=code)
        creee = ecrire(depot, espace, ident)
    assert creee.revision.commit == tete(racine) != avant
    # Tête = un descendant de notre commit : succès.
    espace, ident = new_id(), new_id()
    with monkeypatch.context() as contexte:
        apres_update_ref(contexte, code=code, apres=lambda: commit(racine, {}, "autre processus"))
        descendue = ecrire(depot, espace, ident)
    assert descendue.revision.commit == git(racine, "rev-parse", "HEAD~1").strip()
    assert depot.read(espace, ident).revision == descendue.revision
    # Tête = valeur initiale : rien n'est publié.
    base = tete(racine)
    with monkeypatch.context() as contexte:
        apres_update_ref(contexte, code=code, effet=False)
        refus(lambda: ecrire(depot, new_id(), new_id()), "git_failed")
    assert tete(racine) == base
    # Branche remplacée : la publication ne peut pas être établie.
    with monkeypatch.context() as contexte:
        apres_update_ref(contexte, code=code, apres=lambda: remplacer_la_branche(racine))
        refus(lambda: ecrire(depot, new_id(), new_id()), "outcome_unknown")
    propre(racine)


def test_update_ref_publie_puis_la_reference_est_illisible(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    racine = init(tmp_path / "contenus", commit=True)
    depot = repository(racine)
    espace, ident = new_id(), new_id()
    with monkeypatch.context() as contexte:
        apres_update_ref(contexte, illisible=True)
        refus(lambda: ecrire(depot, espace, ident), "outcome_unknown")
    # L'issue est inconnue de l'appel, pas du dépôt : la révision est publiée et lisible,
    # et rejouer la même demande ne l'écrit pas une seconde fois.
    assert [r.number for r in depot.history(espace, ident)] == [1]
    refus(lambda: ecrire(depot, espace, ident), "exists", "revision_conflict")
    propre(racine)


def test_une_reference_absente_n_est_pas_une_reference_non_resoluble(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Branche vide, `update-ref` sans effet : référence absente, puis référence cassée."""
    racine = init(tmp_path / "contenus")
    branche = racine / git(racine, "symbolic-ref", "HEAD").strip()
    espace, ident = new_id(), new_id()
    with monkeypatch.context() as contexte:
        apres_update_ref(contexte, effet=False)
        refus(lambda: ecrire(repository(racine), espace, ident), "git_failed")
    assert not branche.exists()

    def casser() -> None:
        branche.write_text("0123456789012345678901234567890123456789\n")

    with monkeypatch.context() as contexte:
        apres_update_ref(contexte, effet=False, apres=casser)
        refus(lambda: ecrire(repository(racine), espace, ident), "outcome_unknown")
    branche.unlink()
    assert ecrire(repository(racine), espace, ident).revision.number == 1


def test_un_echec_a_la_liberation_du_verrou_apres_publication_reste_un_succes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    racine = init(tmp_path / "contenus", commit=True)
    depot = repository(racine)
    espace, ident = new_id(), new_id()

    class Os:
        def __getattr__(self, nom: str) -> Any:
            return getattr(os, nom)

        @staticmethod
        def close(descripteur: int) -> None:
            os.close(descripteur)
            raise OSError(errno.EIO, "close")

    with monkeypatch.context() as contexte:
        contexte.setattr(repository_module, "os", Os())
        creee = ecrire(depot, espace, ident)
        suivante = depot.write(
            espace, ident, document(ident, name="b"), expected_revision=1, actor=ACTOR
        )
    assert (creee.revision.number, suivante.revision.number) == (1, 2)
    assert suivante.revision.commit == tete(racine)
    # Le verrou est bien libre : un autre descripteur le prend sans attendre.
    descripteur = os.open(racine / LOCK_NAME, os.O_RDWR)
    try:
        fcntl.flock(descripteur, fcntl.LOCK_EX | fcntl.LOCK_NB)
    finally:
        os.close(descripteur)
    propre(racine)


# -- répertoire temporaire ------------------------------------------------------------------


@pytest.mark.parametrize("variable", ["TMPDIR", "TEMP", "TMP"])
@pytest.mark.parametrize("forme", ["racine", "dedans", "lien", "relatif"])
def test_un_repertoire_temporaire_dans_le_depot_est_refuse(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, variable: str, forme: str
) -> None:
    racine = init(tmp_path / "contenus", commit=True)
    (racine / "refs" / "temp").mkdir()
    (tmp_path / "lien").symlink_to(racine / "refs")
    choix = {
        "racine": str(racine),
        "dedans": str(racine / "refs" / "temp"),
        "lien": str(tmp_path / "lien" / "temp"),
        "relatif": "refs/temp",
    }
    for autre in ("TMPDIR", "TEMP", "TMP"):
        monkeypatch.delenv(autre, raising=False)
    monkeypatch.setenv(variable, choix[forme])
    monkeypatch.chdir(racine)
    avant = tete(racine)
    refus(ecriture(repository(racine)), "unsafe_tmpdir")
    refus(
        lambda: repository(racine).delete(new_id(), new_id(), expected_revision=1, actor=ACTOR),
        "unsafe_tmpdir",
    )
    assert not (racine / LOCK_NAME).exists()
    assert tete(racine) == avant
    assert not list(racine.rglob("board-index-*"))
    propre(racine)
    # Les lectures n'ont pas besoin de répertoire temporaire.
    ident = new_id()
    refus(lambda: repository(racine).read(new_id(), ident), "missing", "analysis_not_found")


def test_un_repertoire_temporaire_hors_du_depot_est_admis_meme_s_il_le_contient(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    racine = init(tmp_path / "contenus", commit=True)
    monkeypatch.setenv("TMPDIR", str(tmp_path))
    creee = ecrire(repository(racine), new_id(), new_id())
    assert creee.revision.number == 1
    assert not list(tmp_path.glob("board-index-*"))
    for variable in ("TMPDIR", "TEMP", "TMP"):
        monkeypatch.delenv(variable, raising=False)
    assert ecrire(repository(racine), new_id(), new_id()).revision.number == 1
    propre(racine)


# -- adaptateur git ------------------------------------------------------------------------


def script(chemin: Path, corps: str) -> str:
    chemin.write_text(f"#!/bin/sh\n{corps}\n")
    chemin.chmod(chemin.stat().st_mode | stat.S_IXUSR)
    return str(chemin)


def test_delai_depasse(tmp_path: Path) -> None:
    racine = init(tmp_path / "contenus")
    lent = script(tmp_path / "git-lent", "sleep 5")
    depot = ContentRepository(ContentConfig(racine, timeout=0.2), git=lent)
    refus(ecriture(depot), "git_failed")


def test_sortie_illisible_ou_empreinte_invalide(tmp_path: Path) -> None:
    racine = init(tmp_path / "contenus")
    binaire = script(tmp_path / "git-binaire", "printf '\\377'")
    refus(ecriture(ContentRepository(ContentConfig(racine), git=binaire)), "git_output")
    menteur = script(
        tmp_path / "git-menteur",
        f'case "$*" in *write-tree*) echo zzz;; *) exec {GIT} "$@";; esac',
    )
    refus(ecriture(ContentRepository(ContentConfig(racine), git=menteur)), "git_output")
    assert not (racine / "analyses").exists()


def test_echec_de_git_sans_trace(tmp_path: Path) -> None:
    racine = init(tmp_path / "contenus")
    casse = script(tmp_path / "git-casse", f"echo 'fatal: {racine}' >&2; exit 128")
    with pytest.raises(ContentError) as erreur:
        ecrire(ContentRepository(ContentConfig(racine), git=casse), new_id(), new_id())
    assert str(racine) not in repr(erreur.value) + str(erreur.value) + erreur.value.reason
    assert erreur.value.__cause__ is None


def test_les_commandes_sont_fixes_sans_shell_et_l_environnement_est_reduit(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    racine = init(tmp_path / "contenus", commit=True)
    monkeypatch.setenv("SKIFER_SECRET_POUR_TEST", "valeur")
    monkeypatch.setenv("GIT_DIR", str(tmp_path / "piege"))
    monkeypatch.setenv("GIT_AUTHOR_NAME", "Intrus")
    monkeypatch.setenv("GIT_ASKPASS", "/bin/false")
    appels: list[tuple[list[str], dict[str, Any]]] = []
    reel = subprocess.run

    def espion(argv: Any, **kwargs: Any) -> Any:
        appels.append((list(argv), kwargs))
        return reel(argv, **kwargs)

    monkeypatch.setattr(subprocess, "run", espion)
    depot = repository(racine, config={"timeout": 12.5})
    espace, ident = new_id(), new_id()
    ecrire(depot, espace, ident)
    depot.write(espace, ident, document(ident, name="b"), expected_revision=1, actor=ACTOR)
    depot.read(espace, ident)
    depot.diff(espace, ident, 1, 2)
    depot.delete(espace, ident, expected_revision=2, actor=ACTOR)
    assert appels
    sous_commandes = set()
    for argv, kwargs in appels:
        assert all(type(a) is str for a in argv)
        assert os.path.isabs(argv[0])
        assert kwargs["shell"] is False
        assert kwargs["timeout"] == 12.5
        assert kwargs["cwd"] == racine.resolve()
        assert kwargs["capture_output"] is True
        environnement = kwargs["env"]
        assert not any(cle.startswith("SKIFER") for cle in environnement)
        assert environnement["GIT_TERMINAL_PROMPT"] == "0"
        assert environnement["GIT_CONFIG_GLOBAL"] == os.devnull
        assert environnement["GIT_CONFIG_SYSTEM"] == os.devnull
        assert environnement["GIT_CONFIG_NOSYSTEM"] == "1"
        assert environnement["GIT_AUTHOR_NAME"] == "Skifer Board"
        assert "GIT_DIR" not in environnement
        # L'index privé est hors du dépôt : le dépôt nu n'a pas d'index.
        privé = environnement.get("GIT_INDEX_FILE")
        assert privé is None or racine.resolve() not in Path(privé).resolve().parents
        assert "GIT_ASKPASS" not in environnement
        assert "core.hooksPath=/dev/null" in argv
        assert "core.attributesFile=/dev/null" in argv
        assert environnement["GIT_ATTR_NOSYSTEM"] == "1"
        options = argv[1 : argv.index("core.hooksPath=/dev/null") + 1]
        assert options[0::2] == ["-c"] * (len(options) // 2)
        sous_commandes.add(argv[len(repository_module._OPTIONS) + 1])
    assert sous_commandes <= {
        "rev-parse",
        "show-ref",
        "symbolic-ref",
        "log",
        "cat-file",
        "config",
        "hash-object",
        "read-tree",
        "update-index",
        "write-tree",
        "commit-tree",
        "update-ref",
    }
    # Aucune commande qui lit l'arbre de travail à travers les attributs et les filtres.
    assert not sous_commandes & {"status", "add", "reset", "checkout", "diff", "stash", "commit"}
    # Aucune commande de transport : une URL de dépôt distant n'est jamais lue.
    assert not sous_commandes & {"fetch", "push", "pull", "clone", "ls-remote", "remote"}
    assert "update-index" in sous_commandes
    assert git(racine, "log", "-1", "--format=%an", "--all").strip() == "Skifer Board"


def test_ni_hook_ni_configuration_de_l_utilisateur(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    racine = init(tmp_path / "contenus", commit=True)
    marque = tmp_path / "marque"
    hooks = racine / "hooks"
    for nom in (
        "reference-transaction",
        "pre-commit",
        "post-commit",
        "commit-msg",
        "post-index-change",
    ):
        script(hooks / nom, f"touch {marque}")
    accueil = tmp_path / "accueil"
    accueil.mkdir()
    piege = tmp_path / "piege"
    piege.mkdir()
    script(piege / "reference-transaction", f"touch {marque}.global")
    (accueil / ".gitconfig").write_text(
        f"[core]\n\thooksPath = {piege}\n[user]\n\tname = Intrus\n\temail = intrus@exemple.test\n"
        "[commit]\n\tgpgsign = true\n"
    )
    monkeypatch.setenv("HOME", str(accueil))
    monkeypatch.setenv("XDG_CONFIG_HOME", str(accueil))
    espace, ident = new_id(), new_id()
    ecrire(repository(racine), espace, ident)
    assert not marque.exists()
    assert not Path(f"{marque}.global").exists()
    assert (
        git(racine, "log", "-1", "--format=%an|%ae").strip() == "Skifer Board|board@skifer.invalid"
    )


def test_aucune_commande_reseau_ni_remote(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    racine = init(tmp_path / "contenus", commit=True)
    git(racine, "remote", "add", "origin", "https://exemple.invalid/contenus.git")
    vus: list[str] = []
    reel = repository_module._Git.run

    def run(self: Any, args: Any, **kwargs: Any) -> Any:
        vus.append(args[0])
        return reel(self, args, **kwargs)

    monkeypatch.setattr(repository_module._Git, "run", run)
    ecrire(repository(racine), new_id(), new_id())
    assert not {"push", "fetch", "pull", "clone", "remote", "ls-remote"} & set(vus)
