"""Lister les analyses du dépôt et repérer le dernier commit de chacune (plan 18.2, A4)."""

from __future__ import annotations

from pathlib import Path

import pytest
from skifer_board.content import ContentError, ContentRepository

from .monde import ACTOR, commit, document, git, init, new_id, relative, repository


@pytest.fixture
def racine(tmp_path: Path) -> Path:
    return init(tmp_path / "contenus")


@pytest.fixture
def depot(racine: Path) -> ContentRepository:
    return repository(racine)


def ecrire(depot: ContentRepository, espace: str = "finance", **changes: object) -> str:
    ident = new_id()
    depot.write(espace, ident, document(ident, **changes), expected_revision=None, actor=ACTOR)
    return ident


def test_un_depot_vide_ne_contient_rien(depot: ContentRepository) -> None:
    assert depot.analyses() == ()
    assert depot.latest("finance") == {}


def test_les_analyses_sont_listees_par_espace_triees(depot: ContentRepository) -> None:
    trouvees = {("finance", ecrire(depot)), ("rh", ecrire(depot, "rh")), ("finance", ecrire(depot))}
    assert depot.analyses() == tuple(sorted(trouvees))


def test_une_analyse_supprimee_n_est_plus_listee(depot: ContentRepository) -> None:
    gardee, supprimee = ecrire(depot), ecrire(depot)
    depot.delete("finance", supprimee, expected_revision=1, actor=ACTOR)
    assert depot.analyses() == (("finance", gardee),)


def test_un_chemin_qui_n_est_pas_celui_de_board_est_ignore(
    depot: ContentRepository, racine: Path
) -> None:
    ident = ecrire(depot)
    commit(
        racine,
        {
            "analyses/finance/notes.txt": b"x",
            "analyses/finance/sous/dossier/x.yaml": b"x",
            "analyses/Finance/" + new_id() + ".yaml": b"x",
            "analyses/" + new_id() + ".yaml": b"x",
            "autre/finance/" + new_id() + ".yaml": b"x",
        },
        "étranger",
    )
    assert depot.analyses() == (("finance", ident),)


def test_le_dernier_commit_de_chaque_analyse(depot: ContentRepository, racine: Path) -> None:
    premiere, seconde = ecrire(depot), ecrire(depot)
    avant = depot.latest("finance")
    assert set(avant) == {premiere, seconde}
    courante = depot.read("finance", premiere).document
    revisee = depot.write(
        "finance", premiere, {**courante, "name": "Autre"}, expected_revision=1, actor=ACTOR
    )
    apres = depot.latest("finance")
    assert apres[premiere] == revisee.revision.commit
    assert apres[seconde] == avant[seconde]
    assert avant[premiere] != apres[premiere]


def test_un_commit_etranger_change_l_empreinte(depot: ContentRepository, racine: Path) -> None:
    ident = ecrire(depot)
    avant = depot.latest("finance")[ident]
    intrus = commit(racine, {relative("finance", ident): b"api_version: x\n"}, "intrus")
    assert depot.latest("finance")[ident] == intrus != avant


def test_une_suppression_porte_le_commit_de_sa_suppression(depot: ContentRepository) -> None:
    ident = ecrire(depot)
    retire = depot.delete("finance", ident, expected_revision=1, actor=ACTOR)
    assert depot.latest("finance")[ident] == retire.commit


def test_les_autres_espaces_n_y_figurent_pas(depot: ContentRepository) -> None:
    finance, rh = ecrire(depot), ecrire(depot, "rh")
    assert set(depot.latest("finance")) == {finance}
    assert set(depot.latest("rh")) == {rh}
    assert depot.latest("autre") == {}


def test_un_prefixe_d_espace_ne_deborde_pas_sur_un_espace_voisin(depot: ContentRepository) -> None:
    ecrire(depot, "rh")
    voisin = ecrire(depot, "rh-bis")
    assert set(depot.latest("rh-bis")) == {voisin}
    assert len(depot.latest("rh")) == 1


@pytest.mark.parametrize("espace", ["", "../x", "Finance", "a/b", "-a", "a" * 41, "é"])
def test_un_espace_mal_forme_est_refuse(depot: ContentRepository, espace: str) -> None:
    with pytest.raises(ContentError) as erreur:
        depot.latest(espace)
    assert (erreur.value.code, erreur.value.reason) == ("invalid_analysis", "bad_identifier")


def test_un_depot_absent_est_indisponible(tmp_path: Path) -> None:
    absent = repository(tmp_path / "absent")
    for appel in (absent.analyses, lambda: absent.latest("finance")):
        with pytest.raises(ContentError) as erreur:
            appel()
        assert erreur.value.code == "content_unavailable"


def test_lister_n_ecrit_rien_dans_le_depot(depot: ContentRepository, racine: Path) -> None:
    ecrire(depot)
    avant = git(racine, "count-objects", "-v")
    depot.analyses()
    depot.latest("finance")
    assert git(racine, "count-objects", "-v") == avant


def test_un_fichier_etranger_dans_l_espace_n_est_pas_une_analyse(
    depot: ContentRepository, racine: Path
) -> None:
    ident = ecrire(depot)
    commit(racine, {"analyses/finance/notes.txt": b"x", "analyses/finance/a/b.yaml": b"x"}, "autre")
    assert set(depot.latest("finance")) == {ident}
