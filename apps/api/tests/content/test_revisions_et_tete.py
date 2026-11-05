"""Une ancienne révision se juge sur son en-tête avant d'être validée, et le contrôle de visibilité
et la lecture qui le suit portent sur le même commit (plan 18.3, relecture 5)."""

from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import Any

import pytest
from skifer_board.content import ContentError, ContentRepository, dumps, validate
from skifer_board.content import repository as depot_module
from skifer_board.content.analysis import loads
from spaces.monde import ADMIN_GROUPE, CREATEUR_GROUPE, LECTEUR_GROUPE, A

from .monde import ACTOR, commit, document, init, new_id, relative, repository
from .serveur import CHEMIN, Banc
from .test_etat import message_board
from .test_refus_bornes import INDISPONIBLE, compter, lister
from .test_usage import INCONNUE

SECRET = "Secret-prive-ancien"
PUBLIC = "Version-publique"
NOUVEAU = "Nouveau-contenu-prive"


def espionner_contenus(monkeypatch: pytest.MonkeyPatch) -> list[bytes]:
    """Octets de chaque document que le dépôt charge et valide en entier."""
    lus: list[bytes] = []
    original = loads

    def espion(raw: bytes) -> Any:
        lus.append(raw)
        return original(raw)

    monkeypatch.setattr(depot_module, "loads", espion)
    return lus


def ancienne_personnelle_puis_partagee(banc: Banc) -> str:
    ident = banc.creer_ok(CREATEUR_GROUPE, name=SECRET, visibility="personal")
    assert (
        banc.reviser(CREATEUR_GROUPE, ident, 1, name=PUBLIC, visibility="shared").status_code == 201
    )
    return ident


def ancienne_abimee_puis_partagee(banc: Banc) -> str:
    """Révision 1 personnelle saine, 2 abîmée (hors de Board), 3 partagée."""
    ident = banc.creer_ok(CREATEUR_GROUPE, name=SECRET, visibility="personal")
    courant = banc.depot.read(A, ident).document
    chemin = relative(A, ident)
    commit(banc.racine, {chemin: b":: pas un document ["}, message_board(A, ident, 2))
    partagee = dumps(validate({**courant, "visibility": "shared", "name": PUBLIC}))
    commit(banc.racine, {chemin: partagee}, message_board(A, ident, 3))
    return ident


# -- l'en-tête d'abord, le corps seulement s'il est lisible ----------------------------------------


def test_une_revision_masquee_n_est_ni_chargee_ni_validee(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    ident = ancienne_personnelle_puis_partagee(banc)
    lus = espionner_contenus(monkeypatch)
    appels = compter(monkeypatch)
    for profil in (LECTEUR_GROUPE, ADMIN_GROUPE):
        reponse = banc.appel(profil, "GET", f"{CHEMIN}/{ident}/revisions")
        assert reponse.status_code == 200
        assert [r["available"] for r in reponse.json()["revisions"]] == [False, True]
        assert reponse.json()["revisions"][0] == {"revision": 1, "available": False}
        reponse = banc.appel(profil, "GET", f"{CHEMIN}/{ident}/revisions/1")
        assert (reponse.status_code, reponse.json()) == (404, INCONNUE)
        reponse = banc.appel(profil, "GET", f"{CHEMIN}/{ident}/diff?base=1&other=2")
        assert (reponse.status_code, reponse.json()) == (404, INCONNUE)
    # Seule la révision 2 est chargée, une fois par requête, jamais le brouillon privé.
    assert appels["_load"] == 6, dict(appels)
    assert not any(SECRET.encode() in brut for brut in lus)
    # Témoin : le propriétaire, lui, reçoit le brouillon.
    reponse = banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN}/{ident}/revisions/1")
    assert reponse.status_code == 200
    assert any(SECRET.encode() in brut for brut in lus)


@pytest.mark.parametrize("profil", [LECTEUR_GROUPE, ADMIN_GROUPE])
def test_une_ancienne_revision_abimee_se_masque_sans_jamais_donner_503(
    banc: Banc, monkeypatch: pytest.MonkeyPatch, profil: Any
) -> None:
    ident = ancienne_abimee_puis_partagee(banc)
    lus = espionner_contenus(monkeypatch)
    appels = compter(monkeypatch)
    reponse = banc.appel(profil, "GET", f"{CHEMIN}/{ident}/revisions")
    assert reponse.status_code == 200
    assert [r["available"] for r in reponse.json()["revisions"]] == [False, False, True]
    for numero in (1, 2):
        reponse = banc.appel(profil, "GET", f"{CHEMIN}/{ident}/revisions/{numero}")
        assert (reponse.status_code, reponse.json()) == (404, INCONNUE)
        reponse = banc.appel(profil, "GET", f"{CHEMIN}/{ident}/diff?base={numero}&other=3")
        assert (reponse.status_code, reponse.json()) == (404, INCONNUE)
    assert banc.appel(profil, "GET", f"{CHEMIN}/{ident}/revisions/3").status_code == 200
    assert banc.appel(profil, "GET", f"{CHEMIN}/{ident}").status_code == 200
    # Sept requêtes (historique, deux révisions et deux écarts masqués, la révision 3, la
    # courante) : une seule révision chargée à chaque fois, la troisième, la seule dont l'en-tête
    # permet la lecture.
    assert appels["_load"] == 7, dict(appels)
    assert len(lus) == 7 and all(PUBLIC.encode() in brut for brut in lus)


def test_une_ancienne_revision_abimee_reste_une_panne_pour_le_proprietaire(banc: Banc) -> None:
    ident = ancienne_abimee_puis_partagee(banc)
    for suite in ("/revisions", "/revisions/1", "/revisions/3"):
        reponse = banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN}/{ident}{suite}")
        assert (reponse.status_code, reponse.json()) == (503, INDISPONIBLE), suite
    assert banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN}/{ident}").status_code == 200


def test_un_en_tete_non_canonique_masque_la_revision_a_qui_n_est_pas_le_proprietaire(
    banc: Banc,
) -> None:
    """Effet accepté : une révision valide mais non canonique (hors de Board) ne se juge pas sur
    son en-tête ; elle est masquée pour un lecteur, et lisible par le propriétaire."""
    import yaml

    ident = banc.creer_ok(CREATEUR_GROUPE, name=PUBLIC, visibility="shared")
    courant = banc.depot.read(A, ident).document
    octets = yaml.safe_dump(
        {"query": courant["query"], **{k: v for k, v in courant.items() if k != "query"}},
        sort_keys=False,
        allow_unicode=True,
    ).encode()
    chemin = relative(A, ident)
    commit(banc.racine, {chemin: octets}, message_board(A, ident, 2))
    commit(
        banc.racine,
        {chemin: dumps(validate({**courant, "name": "Trois"}))},
        message_board(A, ident, 3),
    )
    reponse = banc.appel(LECTEUR_GROUPE, "GET", f"{CHEMIN}/{ident}/revisions")
    assert [r["available"] for r in reponse.json()["revisions"]] == [True, False, True]
    reponse = banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN}/{ident}/revisions")
    assert [r["available"] for r in reponse.json()["revisions"]] == [True, True, True]


# -- une seule tête par requête --------------------------------------------------------------------


def publier_une_revision_privee_apres_le_controle(
    banc: Banc, ident: str, monkeypatch: pytest.MonkeyPatch, expected: int
) -> Counter[str]:
    """Quand le contrôle de visibilité a rendu son verdict, le propriétaire publie une révision
    personnelle : la tête du dépôt change entre le contrôle et la lecture."""
    faits: Counter[str] = Counter()
    original = ContentRepository.glance

    def piege(self: ContentRepository, *args: Any, **options: Any) -> Any:
        vu = original(self, *args, **options)
        if not faits["publie"]:
            faits["publie"] += 1
            courant = banc.depot.read(A, ident).document
            banc.depot.write(
                A,
                ident,
                {**courant, "name": NOUVEAU, "visibility": "personal"},
                expected_revision=expected,
                actor=CREATEUR_GROUPE.ref,
            )
        return vu

    monkeypatch.setattr(ContentRepository, "glance", piege)
    return faits


def partagee_deux_fois_derriere_l_index(banc: Banc) -> str:
    """Révisions 1 et 2 partagées, la 2 écrite sans passer par l'index : la ligne est périmée."""
    ident = banc.creer_ok(CREATEUR_GROUPE, name="Un", visibility="shared")
    courant = banc.depot.read(A, ident).document
    banc.depot.write(
        A, ident, {**courant, "name": "Deux"}, expected_revision=1, actor=CREATEUR_GROUPE.ref
    )
    return ident


@pytest.mark.parametrize("route", ["lecture", "historique", "revision", "liste"])
def test_le_controle_et_la_lecture_portent_sur_le_meme_commit(
    banc: Banc, monkeypatch: pytest.MonkeyPatch, route: str
) -> None:
    ident = partagee_deux_fois_derriere_l_index(banc)
    avant = banc.depot.head()
    lus = espionner_contenus(monkeypatch)
    faits = publier_une_revision_privee_apres_le_controle(banc, ident, monkeypatch, 2)
    base = f"{CHEMIN}/{ident}"
    if route == "liste":
        reponse = banc.appel(LECTEUR_GROUPE, "GET", CHEMIN)
        assert reponse.status_code == 200
        (ligne,) = reponse.json()["analyses"]
        assert (ligne["id"], ligne["name"], ligne["revision"]) == (ident, "Deux", 2)
        assert reponse.json()["unreadable"] == 0
    else:
        suite = {"lecture": "", "historique": "/revisions", "revision": "/revisions/2"}[route]
        reponse = banc.appel(LECTEUR_GROUPE, "GET", base + suite)
        assert reponse.status_code == 200, reponse.text
        corps = reponse.json()
        if route == "historique":
            assert [r["available"] for r in corps["revisions"]] == [True, True]
        else:
            assert (corps["analysis"]["name"], corps["revision"]) == ("Deux", 2)
    # La requête a vu la tête d'avant : la révision privée publiée entre-temps n'est ni chargée,
    # ni validée, ni servie.
    assert faits["publie"] == 1
    assert banc.depot.head() != avant
    assert not any(NOUVEAU.encode() in brut for brut in lus)


def test_une_liste_sur_un_depot_sans_commit_est_vide(banc: Banc) -> None:
    assert banc.depot.head() is None
    assert lister(banc, LECTEUR_GROUPE) == {"analyses": [], "unreadable": 0}


# -- lectures d'un commit donné ----------------------------------------


def test_les_lectures_du_depot_portent_sur_le_commit_donne(tmp_path: Path) -> None:
    depot = repository(init(tmp_path / "contenus"))
    ident = new_id()
    premiere = validate(document(ident, name="Premier", visibility="shared"))
    depot.write("finance", ident, premiere, expected_revision=None, actor=ACTOR)
    tete_1 = depot.head()
    assert tete_1 is not None
    depot.write("finance", ident, {**premiere, "name": "Second"}, expected_revision=1, actor=ACTOR)
    tete_2 = depot.head()
    assert tete_2 is not None and tete_2 != tete_1
    assert depot.read("finance", ident, at=tete_1).document["name"] == "Premier"
    assert depot.read("finance", ident).document["name"] == "Second"
    assert [r.number for r in depot.history("finance", ident, at=tete_1)] == [1]
    assert [e.revision.number for e in depot.entries("finance", ident, at=tete_1)] == [1]
    assert (
        depot.latest("finance", at=tete_1)[ident] == depot.read("finance", ident, 1).revision.commit
    )
    assert depot.glance("finance", ident, at=tete_1).visibility == "shared"
    assert [c.path for c in depot.diff("finance", ident, 1, 2, at=tete_2)] == ["/name"]
    with pytest.raises(ContentError) as erreur:
        depot.diff("finance", ident, 1, 2, at=tete_1)
    assert erreur.value.reason == "missing_revision"
    for faux in ("HEAD", "refs/heads/main", "../x", tete_1.upper(), tete_1[:-1]):
        with pytest.raises(ContentError) as erreur:
            depot.read("finance", ident, at=faux)
        assert erreur.value.reason == "bad_identifier", faux


def test_une_panne_de_git_sur_l_en_tete_d_une_revision_n_est_pas_un_masquage(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Seules les erreurs propres à la révision la masquent ; une panne de git se lève."""
    depot = repository(init(tmp_path / "contenus"))
    ident = new_id()
    premiere = validate(document(ident, visibility="shared"))
    depot.write("finance", ident, premiere, expected_revision=None, actor=ACTOR)
    ancienne = depot.read("finance", ident).revision.commit
    depot.write("finance", ident, {**premiere, "name": "Deux"}, expected_revision=1, actor=ACTOR)
    original = depot_module._Git.run

    def panne(self: Any, args: Any, **options: Any) -> Any:
        if args[0] == "cat-file" and args[-1].startswith(ancienne):
            raise ContentError("content_unavailable", "git_failed")
        return original(self, args, **options)

    monkeypatch.setattr(depot_module._Git, "run", panne)
    with pytest.raises(ContentError) as erreur:
        depot.entries("finance", ident, allow=lambda *_: True)
    assert (erreur.value.code, erreur.value.reason) == ("content_unavailable", "git_failed")
