"""Écritures concurrentes, threads et processus : jamais d'écrasement (plan 18, A3)."""

from __future__ import annotations

import json
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any

from skifer_board.content import ContentError
from skifer_board.content.repository import LOCK_NAME

from .monde import ACTOR, document, fichier, git, init, new_id, propre, repository

THREADS = 12


def lancer(taches: list[Any]) -> list[Any]:
    """Exécute les tâches en même temps (barrière) et rend, dans l'ordre, valeur ou erreur."""
    barriere = threading.Barrier(len(taches))
    resultats: list[Any] = [None] * len(taches)

    def travail(position: int) -> None:
        barriere.wait()
        try:
            resultats[position] = taches[position]()
        except ContentError as erreur:
            resultats[position] = erreur

    fils = [threading.Thread(target=travail, args=(i,)) for i in range(len(taches))]
    for fil in fils:
        fil.start()
    for fil in fils:
        fil.join(60)
    assert not any(fil.is_alive() for fil in fils)
    return resultats


def test_une_seule_revision_suivante_l_emporte_entre_threads(tmp_path: Path) -> None:
    racine = init(tmp_path / "contenus")
    depot = repository(racine)
    espace, ident = new_id(), new_id()
    depot.write(espace, ident, document(ident), expected_revision=None, actor=ACTOR)
    resultats = lancer(
        [
            lambda i=i: depot.write(
                espace, ident, document(ident, name=f"fil {i}"), expected_revision=1, actor=ACTOR
            )
            for i in range(THREADS)
        ]
    )
    gagnants = [r for r in resultats if not isinstance(r, ContentError)]
    assert len(gagnants) == 1
    perdants = [r for r in resultats if isinstance(r, ContentError)]
    assert {(r.code, r.reason) for r in perdants} == {("revision_conflict", "stale")}
    assert depot.read(espace, ident).document["name"] == gagnants[0].document["name"]
    assert [r.number for r in depot.history(espace, ident)] == [1, 2]
    assert git(racine, "rev-list", "--count", "HEAD").strip() == "2"
    propre(racine)


def test_une_seule_creation_l_emporte_entre_threads(tmp_path: Path) -> None:
    racine = init(tmp_path / "contenus")
    depot = repository(racine)
    espace, ident = new_id(), new_id()
    resultats = lancer(
        [
            lambda i=i: depot.write(
                espace, ident, document(ident, name=f"fil {i}"), expected_revision=None, actor=ACTOR
            )
            for i in range(THREADS)
        ]
    )
    assert sum(not isinstance(r, ContentError) for r in resultats) == 1
    assert {r.code for r in resultats if isinstance(r, ContentError)} == {"revision_conflict"}
    assert git(racine, "rev-list", "--count", "HEAD").strip() == "1"
    propre(racine)


def test_des_analyses_distinctes_s_ecrivent_toutes_en_ligne_droite(tmp_path: Path) -> None:
    racine = init(tmp_path / "contenus")
    depot = repository(racine)
    espace = new_id()
    identifiants = [new_id() for _ in range(THREADS)]
    resultats = lancer(
        [
            lambda i=i: depot.write(
                espace, i, document(i, name=f"nom {i}"), expected_revision=None, actor=ACTOR
            )
            for i in identifiants
        ]
    )
    assert not [r for r in resultats if isinstance(r, ContentError)]
    assert git(racine, "rev-list", "--count", "HEAD").strip() == str(THREADS)
    assert git(racine, "rev-list", "--merges", "--count", "HEAD").strip() == "0"
    for i in identifiants:
        assert depot.read(espace, i).document["name"] == f"nom {i}"
    propre(racine)


def test_avec_reprise_aucune_mise_a_jour_n_est_perdue(tmp_path: Path) -> None:
    racine = init(tmp_path / "contenus")
    depot = repository(racine)
    espace, ident = new_id(), new_id()
    depot.write(
        espace, ident, document(ident, description="départ"), expected_revision=None, actor=ACTOR
    )

    def ajouter(i: int) -> Any:
        while True:
            courante = depot.read(espace, ident)
            contenu = document(ident, description=courante.document["description"] + f"|{i}")
            try:
                return depot.write(
                    espace, ident, contenu, expected_revision=courante.revision.number, actor=ACTOR
                )
            except ContentError as erreur:
                assert erreur.code == "revision_conflict"

    resultats = lancer([lambda i=i: ajouter(i) for i in range(THREADS)])
    assert sorted(r.revision.number for r in resultats) == list(range(2, THREADS + 2))
    final = depot.read(espace, ident).document["description"]
    assert sorted(final.split("|")[1:], key=int) == [str(i) for i in range(THREADS)]
    assert [r.number for r in depot.history(espace, ident)] == list(range(1, THREADS + 2))
    propre(racine)


def test_une_ecriture_attend_le_verrou_et_ne_s_intercale_pas(tmp_path: Path) -> None:
    import fcntl
    import os

    racine = init(tmp_path / "contenus")
    depot = repository(racine, config={"lock_timeout": 30.0})
    espace, ident = new_id(), new_id()
    descripteur = os.open(racine / LOCK_NAME, os.O_RDWR | os.O_CREAT, 0o600)
    fcntl.flock(descripteur, fcntl.LOCK_EX)
    terminee = threading.Event()
    sortie: list[Any] = []

    def ecrire() -> None:
        sortie.append(
            depot.write(espace, ident, document(ident), expected_revision=None, actor=ACTOR)
        )
        terminee.set()

    fil = threading.Thread(target=ecrire)
    fil.start()
    time.sleep(0.4)
    assert not terminee.is_set()
    assert git(racine, "rev-list", "--all", "--count").strip() == "0"
    os.close(descripteur)
    fil.join(30)
    assert terminee.is_set()
    assert sortie[0].revision.number == 1
    propre(racine)


TRAVAIL = r"""
import json, sys, time
from pathlib import Path
from skifer_board.content import ContentConfig, ContentError, ContentRepository
from skifer_board.spaces.model import PersonRef

racine, signal, espace, ident, numero, attendue = sys.argv[1:7]
depot = ContentRepository(ContentConfig(Path(racine)))
document = json.loads(Path(sys.argv[7]).read_text())
document["name"] = "processus " + numero
Path(signal, "pret-" + numero).write_text("")
while not Path(signal, "go").exists():
    time.sleep(0.002)
revision = None if attendue == "-" else int(attendue)
acteur = PersonRef("https://idp.example.test", "proc-" + numero)
try:
    depot.write(espace, ident, document, expected_revision=revision, actor=acteur)
    print(json.dumps({"ok": True}))
except ContentError as erreur:
    print(json.dumps({"ok": False, "code": erreur.code, "reason": erreur.reason}))
"""


def processus(
    tmp_path: Path, racine: Path, cibles: list[tuple[str, str]], attendue: str
) -> list[dict[str, Any]]:
    signal = tmp_path / "signal"
    signal.mkdir()
    enfants = []
    for numero, (espace, ident) in enumerate(cibles):
        modele = tmp_path / f"document-{numero}.json"
        modele.write_text(json.dumps(document(ident)))
        enfants.append(
            subprocess.Popen(
                [
                    sys.executable,
                    "-I",
                    "-c",
                    TRAVAIL,
                    str(racine),
                    str(signal),
                    espace,
                    ident,
                    str(numero),
                    attendue,
                    str(modele),
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
        )
    debut = time.monotonic()
    while len(list(signal.glob("pret-*"))) < len(enfants):
        assert time.monotonic() - debut < 120, "processus non démarrés"
        assert all(e.poll() is None for e in enfants), [e.communicate() for e in enfants]
        time.sleep(0.02)
    (signal / "go").write_text("")
    sorties = []
    for enfant in enfants:
        sortie, erreur = enfant.communicate(timeout=120)
        assert enfant.returncode == 0, erreur
        sorties.append(json.loads(sortie))
    return sorties


PROCESSUS = 5


def test_une_seule_revision_suivante_l_emporte_entre_processus(tmp_path: Path) -> None:
    racine = init(tmp_path / "contenus")
    depot = repository(racine)
    espace, ident = new_id(), new_id()
    depot.write(espace, ident, document(ident), expected_revision=None, actor=ACTOR)
    sorties = processus(tmp_path, racine, [(espace, ident)] * PROCESSUS, "1")
    assert sum(s["ok"] for s in sorties) == 1
    assert {(s["code"], s["reason"]) for s in sorties if not s["ok"]} == {
        ("revision_conflict", "stale")
    }
    assert [r.number for r in depot.history(espace, ident)] == [1, 2]
    assert git(racine, "rev-list", "--count", "HEAD").strip() == "2"
    propre(racine)


def test_une_seule_creation_l_emporte_entre_processus(tmp_path: Path) -> None:
    racine = init(tmp_path / "contenus")
    espace, ident = new_id(), new_id()
    sorties = processus(tmp_path, racine, [(espace, ident)] * PROCESSUS, "-")
    assert sum(s["ok"] for s in sorties) == 1
    assert {s["code"] for s in sorties if not s["ok"]} == {"revision_conflict"}
    assert git(racine, "rev-list", "--count", "HEAD").strip() == "1"
    propre(racine)


def test_des_analyses_distinctes_s_ecrivent_toutes_entre_processus(tmp_path: Path) -> None:
    racine = init(tmp_path / "contenus")
    espace = new_id()
    cibles = [(espace, new_id()) for _ in range(PROCESSUS)]
    sorties = processus(tmp_path, racine, cibles, "-")
    assert all(s["ok"] for s in sorties)
    assert git(racine, "rev-list", "--count", "HEAD").strip() == str(PROCESSUS)
    depot = repository(racine)
    for _, ident in cibles:
        assert fichier(racine, espace, ident) is not None
        assert depot.read(espace, ident).revision.number == 1
    propre(racine)
