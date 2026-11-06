"""Borne de taille d'une analyse : 1 Mio, à l'écriture comme à la lecture (plan 18.3)."""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

import pytest
from skifer_board.content import ContentError
from skifer_board.content import repository as depot_module
from skifer_board.content.analysis import brief, dumps, validate
from spaces.monde import CREATEUR_GROUPE, LECTEUR_GROUPE

from .monde import ACTOR, commit, document, init, new_id, relative, repository
from .serveur import CHEMIN, Banc, corps
from .test_etat import message_board

ESPACE = "finance"
LIMITE = 1024 * 1024


def plus_gros(lettre: str) -> dict[str, Any]:
    """Le plus gros document que le schéma et les règles admettent : 32 filtres `in` de 100
    valeurs distinctes de 1024 caractères, et tous les autres champs à leur longueur maximale."""

    def valeur(rang: int) -> str:
        return f"{rang:06d}" + lettre * 1018

    metriques = [f"m{i}" + "x" * 70 for i in range(32)]
    dimensions = [f"d{i}" + "y" * 70 for i in range(32)]
    return validate(
        {
            "api_version": "board.analysis/v1",
            "id": new_id(),
            "name": "n" * 120,
            "description": "d" * 2000,
            "visibility": "shared",
            "owner": {"issuer": "i" * 512, "subject": "s" * 512},
            "query": {
                "connection": "finance",
                "model": "sales",
                "metrics": metriques,
                "dimensions": dimensions,
                "filters": [
                    {"column": f"c{j}", "operator": "in", "value": [valeur(k) for k in range(100)]}
                    for j in range(32)
                ],
            },
            "contextual": [
                {
                    "operation": "aggregate",
                    "metric": metriques[0],
                    "group_by": dimensions,
                    "scope": None,
                }
                for _ in range(32)
            ],
            "presentation": {"chart": "bars"},
        }
    )


def refuse_ecriture(depot: Any, ident: str, valide: dict[str, Any]) -> ContentError:
    with pytest.raises(ContentError) as erreur:
        depot.write(ESPACE, ident, valide, expected_revision=None, actor=ACTOR)
    return erreur.value


def test_le_plus_gros_document_du_schema_depasse_la_borne_et_n_est_pas_ecrit(
    tmp_path: Path,
) -> None:
    """Le schéma seul admet bien plus que la borne (3,4 Mo en ASCII, 13,2 Mo avec des caractères
    de quatre octets) : la borne d'écriture est ce qui l'arrête, sans rien écrire."""
    racine = init(tmp_path / "contenus")
    depot = repository(racine)
    ascii_ = plus_gros("a")
    assert LIMITE < len(dumps(ascii_)) < 3.5 * LIMITE
    assert len(dumps(plus_gros("\U00020000"))) > 12 * LIMITE
    erreur = refuse_ecriture(depot, ascii_["id"], ascii_)
    assert (erreur.code, erreur.reason) == ("invalid_analysis", "out_of_bounds")
    assert [(v.path, v.rule) for v in erreur.violations] == [("", "out_of_bounds")]
    assert depot.head() is None


def test_la_borne_d_ecriture_est_inclusive(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    depot = repository(init(tmp_path / "contenus"))
    ident = new_id()
    valide = validate(document(ident))
    taille = len(dumps(valide))
    monkeypatch.setattr(depot_module, "MAX_DOCUMENT_BYTES", taille - 1)
    assert refuse_ecriture(depot, ident, valide).reason == "out_of_bounds"
    assert depot.head() is None
    monkeypatch.setattr(depot_module, "MAX_DOCUMENT_BYTES", taille)
    assert (
        depot.write(ESPACE, ident, valide, expected_revision=None, actor=ACTOR).revision.number == 1
    )


def test_la_borne_de_lecture_est_inclusive_et_vaut_pour_le_coup_d_oeil(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    depot = repository(init(tmp_path / "contenus"))
    ident = new_id()
    valide = validate(document(ident))
    depot.write(ESPACE, ident, valide, expected_revision=None, actor=ACTOR)
    taille = len(dumps(valide))
    monkeypatch.setattr(depot_module, "MAX_DOCUMENT_BYTES", taille)
    assert depot.read(ESPACE, ident).document == valide
    assert depot.glance(ESPACE, ident).visibility == valide["visibility"]
    monkeypatch.setattr(depot_module, "MAX_DOCUMENT_BYTES", taille - 1)
    with pytest.raises(ContentError) as erreur:
        depot.read(ESPACE, ident)
    assert (erreur.value.code, erreur.value.reason) == ("content_unavailable", "document_too_large")
    vu = depot.glance(ESPACE, ident)
    assert vu.visibility is None and vu.owner == ACTOR


def test_un_fichier_pose_au_dela_de_1_mio_n_est_pas_analyse(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Un commit hors de Board d'un Mio et un octet : refusé sur la taille de git, avant le
    moindre parse (le coup d'oeil n'appelle pas l'analyse du YAML)."""
    assert depot_module.MAX_DOCUMENT_BYTES == LIMITE
    racine = init(tmp_path / "contenus")
    depot = repository(racine)
    ident = new_id()
    commit(racine, {relative(ESPACE, ident): b"#" + b"x" * LIMITE}, "posé à la main")
    analyses: list[int] = []

    def espion(raw: bytes) -> Any:
        analyses.append(len(raw))
        return brief(raw)

    monkeypatch.setattr(depot_module, "brief", espion)
    vu = depot.glance(ESPACE, ident)
    assert (vu.owner, vu.visibility) == (None, None)
    assert analyses == []
    with pytest.raises(ContentError) as erreur:
        depot.read(ESPACE, ident)
    assert erreur.value.reason in {"history_inconsistent", "document_too_large"}


def test_le_corps_http_est_borne_a_64_kio_pour_la_creation_et_la_revision(banc: Banc) -> None:
    """La limite du corps (64 Kio, relue après réception) arrête bien avant 1 Mio."""
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="personal")
    trop = {**corps(), "description": "d" * 2000, "padding": "p" * (64 * 1024)}
    reponse = banc.appel(CREATEUR_GROUPE, "POST", CHEMIN, json=trop)
    assert reponse.status_code == 400
    assert reponse.json()["error"]["code"] == "invalid_request"
    reponse = banc.appel(
        CREATEUR_GROUPE,
        "POST",
        f"{CHEMIN}/{ident}/revisions",
        json={**trop, "expected_revision": 1},
    )
    assert reponse.status_code == 400
    assert reponse.json()["error"]["code"] == "invalid_request"


# -- la taille est mesurée avant de récupérer un seul octet, sur tous les chemins -----------------


def espionner_git(monkeypatch: pytest.MonkeyPatch) -> list[list[str]]:
    """Chaque commande `cat-file` lancée sur un objet (`-s` ou `blob`)."""
    commandes: list[list[str]] = []
    original = depot_module._Git.run

    def espion(self: Any, args: Any, **options: Any) -> Any:
        if args[0] == "cat-file":
            commandes.append(list(args))
        return original(self, args, **options)

    monkeypatch.setattr(depot_module._Git, "run", espion)
    return commandes


def poser_une_premiere_revision_trop_grosse(racine: Path, ident: str) -> tuple[str, str]:
    """Révision 1 de plus de 1 Mio (un commentaire YAML en fin de texte), révision 2 saine, toutes
    deux avec l'historique que Board écrit. Rend les empreintes des deux commits."""
    sain = dumps(validate(document(ident)))
    chemin = relative(ESPACE, ident)
    premiere = commit(
        racine, {chemin: sain + b"#" + b"x" * LIMITE + b"\n"}, message_board(ESPACE, ident, 1)
    )
    seconde = commit(racine, {chemin: sain}, message_board(ESPACE, ident, 2))
    return premiere, seconde


def lectures_de_blob(commandes: list[list[str]], commit_: str, ident: str) -> list[list[str]]:
    return [
        c for c in commandes if c[1] == "blob" and c[2] == f"{commit_}:{relative(ESPACE, ident)}"
    ]


CHEMINS: dict[str, Any] = {
    "read": lambda depot, ident: depot.read(ESPACE, ident, 1),
    "entries": lambda depot, ident: depot.entries(ESPACE, ident),
    "diff": lambda depot, ident: depot.diff(ESPACE, ident, 1, 2),
}


@pytest.mark.parametrize("chemin", CHEMINS)
def test_une_ancienne_revision_trop_grosse_n_est_jamais_recuperee(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, chemin: str
) -> None:
    racine = init(tmp_path / "contenus", commit=True)
    depot = repository(racine)
    ident = new_id()
    premiere, seconde = poser_une_premiere_revision_trop_grosse(racine, ident)
    commandes = espionner_git(monkeypatch)
    with pytest.raises(ContentError) as erreur:
        CHEMINS[chemin](depot, ident)
    assert (erreur.value.code, erreur.value.reason) == ("content_unavailable", "document_too_large")
    assert [c[:2] for c in commandes if c[2].startswith(premiere)] == [["cat-file", "-s"]]
    assert lectures_de_blob(commandes, premiere, ident) == []
    # La révision saine, elle, se lit toujours.
    assert depot.read(ESPACE, ident, 2).document["id"] == ident
    assert lectures_de_blob(commandes, seconde, ident) != []


def test_une_ancienne_revision_trop_grosse_ne_charge_pas_l_historique_par_la_route(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Par `GET /revisions` et `GET /revisions/{n}` : la révision au-delà de la borne est une
    indisponibilité du contenu pour son propriétaire et une révision masquée pour un lecteur, sans
    que son blob soit récupéré."""
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    sain = dumps(validate(banc.depot.read(ESPACE, ident).document))
    chemin = relative(ESPACE, ident)
    trop_gros = commit(
        banc.racine,
        {chemin: sain + b"#" + b"x" * LIMITE + b"\n"},
        message_board(ESPACE, ident, 2),
    )
    commit(banc.racine, {chemin: sain}, message_board(ESPACE, ident, 3))
    commandes = espionner_git(monkeypatch)
    for suite in ("/revisions", "/revisions/2"):
        reponse = banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN}/{ident}{suite}")
        assert (reponse.status_code, reponse.json()) == (
            503,
            {"error": {"code": "content_unavailable"}},
        ), suite
    assert lectures_de_blob(commandes, trop_gros, ident) == []
    assert [c for c in commandes if c[2].startswith(trop_gros)] != []
    # Un lecteur d'une analyse partagée n'en apprend rien : la révision est masquée.
    reponse = banc.appel(LECTEUR_GROUPE, "GET", f"{CHEMIN}/{ident}/revisions/2")
    assert (reponse.status_code, reponse.json()) == (404, {"error": {"code": "analysis_not_found"}})
    reponse = banc.appel(LECTEUR_GROUPE, "GET", f"{CHEMIN}/{ident}/revisions")
    assert [r["available"] for r in reponse.json()["revisions"]] == [True, False, True]
    assert lectures_de_blob(commandes, trop_gros, ident) == []


def test_le_controle_apres_lecture_reste_en_garde_si_le_blob_grossit_entre_deux_commandes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Garde supplémentaire : la mesure (`cat-file -s`) dit la borne respectée, mais les octets lus
    la dépassent (le blob a changé entre les deux commandes) : refusé sans être analysé."""
    racine = init(tmp_path / "contenus", commit=True)
    depot = repository(racine)
    ident = new_id()
    depot.write(ESPACE, ident, validate(document(ident)), expected_revision=None, actor=ACTOR)
    commandes = espionner_git(monkeypatch)
    original = depot_module._Git.run

    def menteur(self: Any, args: Any, **options: Any) -> Any:
        done = original(self, args, **options)
        if args[0] == "cat-file" and args[1] == "-s":
            return subprocess.CompletedProcess(args, 0, b"1048576\n", b"")
        if args[0] == "cat-file" and args[1] == "blob":
            return subprocess.CompletedProcess(args, 0, done.stdout + b"#" * LIMITE, b"")
        return done

    monkeypatch.setattr(depot_module._Git, "run", menteur)
    with pytest.raises(ContentError) as erreur:
        depot.read(ESPACE, ident)
    assert erreur.value.reason == "document_too_large"
    assert any(c[1] == "blob" for c in commandes)
