"""Un refus ne coûte pas l'histoire de l'analyse refusée (plan 18.3, relecture de A8).

Le temps d'un refus ne doit pas dire qu'une analyse personnelle existe, ni combien de révisions
elle a. Le test est structurel plutôt que chronométré : pour ce que la session ne peut pas voir,
aucune lecture d'historique ni de révision n'a lieu. Une analyse abîmée répond comme une analyse
inconnue à qui ne peut pas établir sa visibilité ; seule une panne générale du dépôt répond 503.
"""

from __future__ import annotations

import functools
import os
import subprocess
from collections import Counter
from collections.abc import Callable
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
from skifer_board.content import ContentError, ContentRepository
from skifer_board.content import repository as depot_module
from skifer_board.content import web as web_module
from skifer_board.content.repository import Glance
from spaces.monde import ADMIN_GROUPE, CREATEUR_GROUPE, LECTEUR_GROUPE, A, Profil

from .monde import commit, fichier, git, init, new_id, relative, repository
from .serveur import CHEMIN, Banc, corps
from .test_usage import INCONNUE, reference, soumettre

INDISPONIBLE = {"error": {"code": "content_unavailable"}}


def compter(monkeypatch: pytest.MonkeyPatch) -> Counter[str]:
    """Compte les lectures d'historique, de révision et de blob du dépôt."""
    appels: Counter[str] = Counter()
    for nom in ("_history", "_load", "_blob"):
        original = getattr(ContentRepository, nom)

        def espion(*args: Any, __nom: str = nom, __original: Any = original, **kw: Any) -> Any:
            appels[__nom] += 1
            return __original(*args, **kw)

        remplacement: Any = functools.wraps(original)(espion)
        if nom == "_blob":
            remplacement = staticmethod(remplacement)
        monkeypatch.setattr(ContentRepository, nom, remplacement)
    return appels


def creer_revisions(banc: Banc, visibilite: str, total: int = 4) -> str:
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility=visibilite, name="Révision 1")
    for numero in range(1, total):
        reponse = banc.reviser(
            CREATEUR_GROUPE, ident, numero, visibility=visibilite, name=f"Révision {numero + 1}"
        )
        assert reponse.status_code == 201, reponse.text
    return ident


def routes(banc: Banc, profil: Profil, ident: str) -> dict[str, Any]:
    """Chaque route d'analyse (18.2) et d'usage (18.3), appelée par `profil`."""
    base = f"{CHEMIN}/{ident}"

    def appel(methode: str, suite: str, **options: Any) -> Callable[[], Any]:
        return lambda: banc.appel(profil, methode, base + suite, **options)

    return {
        "lecture": appel("GET", ""),
        "historique": appel("GET", "/revisions"),
        "revision": appel("GET", "/revisions/1"),
        "ecart": appel("GET", "/diff?base=1&other=2"),
        "usage": appel("GET", "/usage"),
        "ouverture": appel("POST", "/opened", json={"event_id": str(uuid4()), "revision": 1}),
        "revision_nouvelle": appel(
            "POST", "/revisions", json={**corps(visibility="personal"), "expected_revision": 1}
        ),
        "copie": appel("POST", "/duplicate"),
        "suppression": appel("DELETE", "?expected_revision=1"),
        "reference": lambda: soumettre(banc, profil, reference(ident)),
    }


def supprimer(banc: Banc, ident: str, revision: int) -> None:
    reponse = banc.appel(
        CREATEUR_GROUPE, "DELETE", f"{CHEMIN}/{ident}?expected_revision={revision}"
    )
    assert reponse.status_code == 204


# -- aucune lecture d'histoire pour ce qui est refusé -------------------------------------------


@pytest.mark.parametrize("etat", ["personnelle", "supprimee", "retiree_du_partage", "inconnue"])
def test_un_refus_ne_lit_ni_historique_ni_revision(
    banc: Banc, monkeypatch: pytest.MonkeyPatch, etat: str
) -> None:
    if etat == "inconnue":
        ident = new_id()
    elif etat == "retiree_du_partage":
        ident = creer_revisions(banc, "shared", 2)
        banc.reviser(CREATEUR_GROUPE, ident, 2, visibility="personal", name="Retirée")
    else:
        ident = creer_revisions(banc, "personal")
        if etat == "supprimee":
            supprimer(banc, ident, 4)
    appels = compter(monkeypatch)
    for profil in (LECTEUR_GROUPE, ADMIN_GROUPE):
        for nom, appel in routes(banc, profil, ident).items():
            reponse = appel()
            if nom in {"revision_nouvelle", "copie", "suppression"} and profil is LECTEUR_GROUPE:
                assert reponse.status_code == 403, nom
                continue
            assert (reponse.status_code, reponse.json()) == (404, INCONNUE), (etat, nom)
    assert appels["_history"] == 0 and appels["_load"] == 0, (etat, dict(appels))
    # Une seule lecture de blob au plus par requête : le contenu de la tête.
    assert appels["_blob"] <= 2 * len(routes(banc, ADMIN_GROUPE, ident)), dict(appels)


def test_ce_que_la_session_voit_lit_toujours_l_historique(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Témoin : le compteur voit bien les lectures quand l'analyse est visible."""
    ident = creer_revisions(banc, "personal")
    appels = compter(monkeypatch)
    assert routes(banc, CREATEUR_GROUPE, ident)["historique"]().status_code == 200
    assert appels["_history"] >= 1 and appels["_load"] >= 4


def test_une_revision_masquee_d_une_analyse_visible_se_refuse_comme_avant(banc: Banc) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="personal", name="Privée")
    banc.reviser(CREATEUR_GROUPE, ident, 1, visibility="shared", name="Publique")
    reponse = banc.appel(LECTEUR_GROUPE, "GET", f"{CHEMIN}/{ident}/revisions/1")
    assert (reponse.status_code, reponse.json()) == (404, INCONNUE)
    assert banc.appel(LECTEUR_GROUPE, "GET", f"{CHEMIN}/{ident}/revisions/2").status_code == 200


def test_le_jugement_sur_la_derniere_revision_lue_reste_en_place(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Défense en profondeur : si la visibilité établie d'abord était périmée (écriture entre les
    deux lectures), le contenu effectivement lu est jugé une seconde fois."""
    ident = creer_revisions(banc, "personal", 2)
    # Un verdict périmé : « partagée », alors que la tête est personnelle.
    menteur = Glance(CREATEUR_GROUPE.ref, "shared", False)
    monkeypatch.setattr(web_module, "establish", lambda *_, **__: (banc.depot.head(), menteur))
    for nom in ("lecture", "usage", "historique", "revision", "ouverture"):
        reponse = routes(banc, LECTEUR_GROUPE, ident)[nom]()
        assert (reponse.status_code, reponse.json()) == (404, INCONNUE), nom


def test_un_document_trop_gros_est_refuse_sur_sa_taille_avant_d_etre_lu(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    """La taille vient de git (`cat-file -s`) : le blob d'un document au-delà de la borne n'est
    ni lu ni analysé. La borne est `MAX_DOCUMENT_BYTES`, 1 Mio."""
    assert depot_module.MAX_DOCUMENT_BYTES == 1024 * 1024
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="personal")
    commandes: list[list[str]] = []
    original = depot_module._Git.run

    def espion(self: Any, args: Any, **options: Any) -> Any:
        commandes.append(list(args))
        return original(self, args, **options)

    monkeypatch.setattr(depot_module._Git, "run", espion)
    monkeypatch.setattr(depot_module, "MAX_DOCUMENT_BYTES", 10)
    appels = espionner_validation(monkeypatch)
    seen = banc.depot.glance(A, ident)
    assert seen.visibility is None
    lectures = [c for c in commandes if c[0] == "cat-file"]
    assert [c[1] for c in lectures] == ["-s"]
    assert sum(appels.values()) == 0


# -- le refus ne valide pas le document privé ---------------------------------------------------


def espionner_validation(monkeypatch: pytest.MonkeyPatch) -> Counter[str]:
    """Compte l'analyse complète du document : YAML validé, schéma, règles, références."""
    from skifer_board.content import analysis as analysis_module
    from skifer_board.content import references as references_module

    appels: Counter[str] = Counter()

    def suivre(module: Any, nom: str) -> None:
        original = getattr(module, nom)

        def espion(*args: Any, **kw: Any) -> Any:
            appels[nom] += 1
            return original(*args, **kw)

        monkeypatch.setattr(module, nom, espion)

    for nom in ("validate", "loads", "_schema_violations"):
        suivre(analysis_module, nom)
    suivre(depot_module, "loads")
    suivre(references_module, "reference_violations")
    suivre(web_module, "reference_violations")
    return appels


@pytest.mark.parametrize("etat", ["personnelle", "supprimee", "retiree_du_partage"])
def test_un_refus_ne_valide_ni_schema_ni_references(
    banc: Banc, monkeypatch: pytest.MonkeyPatch, etat: str
) -> None:
    if etat == "retiree_du_partage":
        ident = creer_revisions(banc, "shared", 2)
        banc.reviser(CREATEUR_GROUPE, ident, 2, visibility="personal", name="Retirée")
    else:
        ident = creer_revisions(banc, "personal")
        if etat == "supprimee":
            supprimer(banc, ident, 4)
    appels = espionner_validation(monkeypatch)
    for profil in (LECTEUR_GROUPE, ADMIN_GROUPE):
        for nom, appel in routes(banc, profil, ident).items():
            reponse = appel()
            if nom in {"revision_nouvelle", "copie", "suppression"} and profil is LECTEUR_GROUPE:
                continue
            assert (reponse.status_code, reponse.json()) == (404, INCONNUE), (etat, nom)
    assert sum(appels.values()) == 0, dict(appels)


def test_la_validation_complete_vient_apres_pour_une_session_autorisee(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Témoin : les espions voient bien la validation quand la session peut voir l'analyse."""
    ident = creer_revisions(banc, "shared", 2)
    appels = espionner_validation(monkeypatch)
    assert routes(banc, LECTEUR_GROUPE, ident)["lecture"]().status_code == 200
    assert appels["validate"] >= 1 and appels["_schema_violations"] >= 1


def test_un_document_valide_mais_non_canonique_se_refuse_comme_un_document_abime(
    banc: Banc,
) -> None:
    """Effet accepté du coup d'oeil sur l'en-tête canonique : un document valide écrit hors de
    Board avec la requête avant le propriétaire est inconnu de qui ne peut pas établir la
    visibilité, et une panne de contenu (503) pour son créateur, qui garde la lecture complète."""
    import yaml

    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    courant = banc.depot.read(A, ident).document
    octets = yaml.safe_dump(
        {"query": courant["query"], **{k: v for k, v in courant.items() if k != "query"}},
        sort_keys=False,
        allow_unicode=True,
    ).encode()
    commit(banc.racine, {relative(A, ident): octets}, "hors de Board")
    reponse = routes(banc, LECTEUR_GROUPE, ident)["lecture"]()
    assert (reponse.status_code, reponse.json()) == (404, INCONNUE)
    reponse = routes(banc, CREATEUR_GROUPE, ident)["lecture"]()
    assert (reponse.status_code, reponse.json()) == (503, INDISPONIBLE)


def test_un_document_lisible_mais_invalide_suit_la_visibilite_de_sa_tete(banc: Banc) -> None:
    """Propriétaire et visibilité lisibles, reste du document invalide : la visibilité s'établit
    sur ces deux champs seulement ; la lecture complète dit ensuite ce qui ne va pas."""
    personnelle = banc.creer_ok(CREATEUR_GROUPE, visibility="personal")
    partagee = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    for ident in (personnelle, partagee):
        octets = fichier(banc.racine, A, ident)
        assert octets is not None
        commit(banc.racine, {relative(A, ident): octets + b"champ_inconnu: 1\n"}, "intrus")
    # Personnelle d'autrui : inconnue, sans lire l'histoire. Propriétaire et lecteur d'une
    # analyse partagée : le comportement d'avant.
    reponse = routes(banc, LECTEUR_GROUPE, personnelle)["lecture"]()
    assert (reponse.status_code, reponse.json()) == (404, INCONNUE)
    for ident, profil in ((personnelle, CREATEUR_GROUPE), (partagee, LECTEUR_GROUPE)):
        reponse = routes(banc, profil, ident)["lecture"]()
        assert (reponse.status_code, reponse.json()) == (503, INDISPONIBLE)


# Les trois clés de l'en-tête canonique que ces cas ne regardent pas, et la ligne de la requête.
AVEC_REQUETE = b"query: {}\n"
EN_TETE = b"api_version: x\nname: n\ndescription: d\n"


@pytest.mark.parametrize(
    "octets",
    [
        b"- liste\nquery: {}\n",
        b"visibility: personal\nid: x\n" + AVEC_REQUETE,
        EN_TETE + b"owner: {issuer: a, subject: b}\nvisibility: secret\nid: x\n" + AVEC_REQUETE,
        EN_TETE + b"owner: {issuer: a}\nvisibility: shared\nid: x\n" + AVEC_REQUETE,
        EN_TETE + b"owner: {issuer: 1, subject: b}\nvisibility: shared\nid: x\n" + AVEC_REQUETE,
        EN_TETE + b"owner: {issuer: ' ', subject: ' '}\nvisibility: shared\nid: x\n" + AVEC_REQUETE,
        EN_TETE
        + b'owner: {issuer: "a\\u0001", subject: b}\nvisibility: shared\nid: x\n'
        + AVEC_REQUETE,
        b"owner: [\nquery: {}\n",
        b"\xff\xfe\x00",
    ],
)
def test_une_forme_inattendue_du_proprietaire_ou_de_la_visibilite_est_un_document_abime(
    banc: Banc, octets: bytes
) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    commit(banc.racine, {relative(A, ident): octets}, "intrus")
    reponse = routes(banc, LECTEUR_GROUPE, ident)["lecture"]()
    assert (reponse.status_code, reponse.json()) == (404, INCONNUE)
    reponse = routes(banc, CREATEUR_GROUPE, ident)["lecture"]()
    assert (reponse.status_code, reponse.json()) == (503, INDISPONIBLE)


# -- analyse abîmée : 404 pour qui ne peut pas établir la visibilité, 503 pour le propriétaire ---


def invalide(banc: Banc, ident: str, monkeypatch: pytest.MonkeyPatch) -> None:
    commit(banc.racine, {relative(A, ident): b":: pas un document ["}, "abîmé")


def autre_identifiant(banc: Banc, ident: str, monkeypatch: pytest.MonkeyPatch) -> None:
    octets = fichier(banc.racine, A, ident)
    assert octets is not None
    abime = octets.replace(ident.encode(), new_id().encode())
    commit(banc.racine, {relative(A, ident): abime}, "abîmé")


def trop_gros(banc: Banc, ident: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(depot_module, "MAX_DOCUMENT_BYTES", 10)


def objet_manquant(banc: Banc, ident: str, monkeypatch: pytest.MonkeyPatch) -> None:
    """L'objet du fichier a disparu du dépôt alors que la tête et l'arbre se lisent."""
    objet = git(banc.racine, "rev-parse", f"HEAD:{relative(A, ident)}").strip()
    chemin = banc.racine / "objects" / objet[:2] / objet[2:]
    chemin.chmod(0o600)
    os.unlink(chemin)


DOMMAGES = [invalide, autre_identifiant, trop_gros, objet_manquant]


@pytest.mark.parametrize("visibilite", ["personal", "shared"])
@pytest.mark.parametrize("dommage", DOMMAGES, ids=lambda d: d.__name__)
def test_un_document_abime_repond_inconnu_sauf_au_proprietaire(
    banc: Banc, monkeypatch: pytest.MonkeyPatch, dommage: Any, visibilite: str
) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility=visibilite)
    dommage(banc, ident, monkeypatch)
    appels = compter(monkeypatch)
    for profil in (LECTEUR_GROUPE, ADMIN_GROUPE):
        for nom in ("lecture", "historique", "revision", "usage", "ouverture", "reference"):
            reponse = routes(banc, profil, ident)[nom]()
            assert (reponse.status_code, reponse.json()) == (404, INCONNUE), nom
    assert appels["_history"] == 0 and appels["_load"] == 0
    for nom in ("lecture", "historique", "revision", "usage", "ouverture", "reference"):
        reponse = routes(banc, CREATEUR_GROUPE, ident)[nom]()
        assert (reponse.status_code, reponse.json()) == (503, INDISPONIBLE), nom


def commit_etranger(banc: Banc, ident: str) -> None:
    """Commit hors de Board, au contenu valide et au message libre : histoire incohérente."""
    octets = fichier(banc.racine, A, ident)
    assert octets is not None
    commit(banc.racine, {relative(A, ident): octets.replace(b"Chiffre", b"Chiffres")}, "libre")


def test_une_histoire_incoherente_ne_se_lit_que_pour_une_analyse_visible(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    personnelle = banc.creer_ok(CREATEUR_GROUPE, visibility="personal")
    partagee = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    commit_etranger(banc, personnelle)
    commit_etranger(banc, partagee)
    appels = compter(monkeypatch)
    # Personnelle d'autrui : comme une analyse inconnue, sans lire l'histoire.
    for nom in ("historique", "revision", "ouverture", "reference"):
        reponse = routes(banc, LECTEUR_GROUPE, personnelle)[nom]()
        assert (reponse.status_code, reponse.json()) == (404, INCONNUE), nom
    assert appels["_history"] == 0
    # Le propriétaire, ou tout lecteur d'une analyse partagée : le comportement d'avant.
    for ident, profil in ((personnelle, CREATEUR_GROUPE), (partagee, LECTEUR_GROUPE)):
        for nom in ("historique", "revision", "ouverture", "reference"):
            reponse = routes(banc, profil, ident)[nom]()
            assert (reponse.status_code, reponse.json()) == (503, INDISPONIBLE), nom
    assert appels["_history"] >= 1


def test_un_dommage_dont_le_createur_est_inconnu_ne_se_montre_a_personne(banc: Banc) -> None:
    """Fichier posé hors de Board : ni contenu lisible, ni auteur de création relisible."""
    ident = new_id()
    commit(banc.racine, {relative(A, ident): b":: pas un document ["}, "posé à la main")
    for profil in (LECTEUR_GROUPE, ADMIN_GROUPE, CREATEUR_GROUPE):
        reponse = routes(banc, profil, ident)["lecture"]()
        assert (reponse.status_code, reponse.json()) == (404, INCONNUE)


def test_une_analyse_supprimee_dont_le_contenu_est_abime_repond_inconnu(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Retirée hors de Board après avoir été abîmée : le contenu d'avant la suppression est
    illisible, donc la visibilité ne s'établit pas ; seul son créateur voit ce qui ne va pas."""
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="personal")
    commit(banc.racine, {relative(A, ident): b":: pas un document ["}, "abîmé")
    commit(banc.racine, {relative(A, ident): None}, "retiré")
    appels = compter(monkeypatch)
    for profil in (LECTEUR_GROUPE, ADMIN_GROUPE):
        reponse = routes(banc, profil, ident)["lecture"]()
        assert (reponse.status_code, reponse.json()) == (404, INCONNUE)
    assert appels["_history"] == 0 and appels["_load"] == 0
    reponse = routes(banc, CREATEUR_GROUPE, ident)["historique"]()
    assert (reponse.status_code, reponse.json()) == (503, INDISPONIBLE)


# -- panne générale : 503 pour tous, même pour qui ne verrait rien ---------------------------------


def test_une_tete_illisible_est_une_panne_generale(banc: Banc) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="personal")
    tete = git(banc.racine, "rev-parse", "HEAD").strip()
    chemin = banc.racine / "objects" / tete[:2] / tete[2:]
    chemin.chmod(0o600)
    os.unlink(chemin)
    for profil in (LECTEUR_GROUPE, ADMIN_GROUPE, CREATEUR_GROUPE):
        reponse = routes(banc, profil, ident)["lecture"]()
        assert (reponse.status_code, reponse.json()) == (503, INDISPONIBLE)


def test_un_git_qui_ne_repond_pas_est_une_panne_generale(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Délai dépassé ou git impossible à lancer pendant la lecture du blob : ce n'est pas
    l'objet de l'analyse qui manque, donc 503 pour tous, y compris qui ne verrait rien."""
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="personal")
    original = depot_module._Git.run

    def delai(self: Any, args: Any, **options: Any) -> Any:
        if args[0] == "cat-file":
            raise ContentError("content_unavailable", "git_failed")
        return original(self, args, **options)

    monkeypatch.setattr(depot_module._Git, "run", delai)
    for profil in (LECTEUR_GROUPE, ADMIN_GROUPE, CREATEUR_GROUPE):
        reponse = routes(banc, profil, ident)["lecture"]()
        assert (reponse.status_code, reponse.json()) == (503, INDISPONIBLE)


@pytest.mark.parametrize("commande", ["-s", "blob"])
@pytest.mark.parametrize("code", [-9, -15, 1, 2, 127])
def test_un_signal_ou_un_code_inattendu_de_cat_file_est_une_defaillance_de_git(
    banc: Banc, monkeypatch: pytest.MonkeyPatch, commande: str, code: int
) -> None:
    """Seul le code 128 de git (objet absent ou illisible) est propre à l'analyse : un processus
    tué (-9), un autre code ou une sortie incompréhensible donnent 503 à tout le monde."""
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="personal")
    original = depot_module._Git.run

    def tue(self: Any, args: Any, **options: Any) -> Any:
        if args[0] == "cat-file" and commande in args:
            return subprocess.CompletedProcess(args, code, b"", b"fatal: secret detail")
        return original(self, args, **options)

    monkeypatch.setattr(depot_module._Git, "run", tue)
    for profil in (LECTEUR_GROUPE, ADMIN_GROUPE, CREATEUR_GROUPE):
        reponse = routes(banc, profil, ident)["lecture"]()
        assert (reponse.status_code, reponse.json()) == (503, INDISPONIBLE)
        assert "secret" not in reponse.text


def test_une_taille_incomprehensible_est_une_defaillance_de_git(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="personal")
    original = depot_module._Git.run

    def taille(self: Any, args: Any, **options: Any) -> Any:
        if args[0] == "cat-file" and "-s" in args:
            return subprocess.CompletedProcess(args, 0, b"beaucoup\n", b"")
        return original(self, args, **options)

    monkeypatch.setattr(depot_module._Git, "run", taille)
    for profil in (LECTEUR_GROUPE, CREATEUR_GROUPE):
        reponse = routes(banc, profil, ident)["lecture"]()
        assert (reponse.status_code, reponse.json()) == (503, INDISPONIBLE)


def test_un_depot_absent_est_une_panne_generale(banc: Banc) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="personal")
    ailleurs = banc.racine.parent / "deplace"
    banc.racine.rename(ailleurs)
    try:
        for profil in (LECTEUR_GROUPE, CREATEUR_GROUPE):
            reponse = routes(banc, profil, ident)["lecture"]()
            assert (reponse.status_code, reponse.json()) == (503, INDISPONIBLE)
    finally:
        ailleurs.rename(banc.racine)


def test_l_etat_de_l_analyse_ne_change_pas_les_commandes_git_lancees_d_abord(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Analyse absente, saine ou supprimée : le dernier commit du chemin et l'arbre de la tête
    sont lus dans tous les cas, une fois chacun."""
    saine = banc.creer_ok(CREATEUR_GROUPE, visibility="personal")
    supprimee = banc.creer_ok(CREATEUR_GROUPE, visibility="personal")
    supprimer(banc, supprimee, 1)
    commandes: list[str] = []
    original = depot_module._Git.run

    def espion(self: Any, args: Any, **options: Any) -> Any:
        commandes.append(args[0])
        return original(self, args, **options)

    monkeypatch.setattr(depot_module._Git, "run", espion)
    vues = {}
    for etat, ident in (("absente", new_id()), ("saine", saine), ("supprimee", supprimee)):
        commandes.clear()
        banc.depot.glance(A, ident)
        vues[etat] = Counter(commandes)
        assert vues[etat]["log"] == 1 and vues[etat]["ls-tree"] == 1, (etat, vues[etat])
        # Jamais l'histoire de l'analyse ni son contenu hors du seul blob.
        assert vues[etat]["cat-file"] <= 2, (etat, vues[etat])
    # La taille (`-s`) puis le blob : jamais plus, et rien pour une analyse absente.
    assert vues["absente"]["cat-file"] == 0
    assert vues["saine"]["cat-file"] == vues["supprimee"]["cat-file"] == 2


# -- liste : le compteur d'illisibles ne révèle rien d'autrui ----------------------------------


def lister(banc: Banc, profil: Profil) -> Any:
    reponse = banc.appel(profil, "GET", CHEMIN)
    assert reponse.status_code == 200
    return reponse.json()


def test_une_ligne_d_index_perimee_ne_fait_pas_compter_une_analyse_d_autrui(banc: Banc) -> None:
    """Partagée, puis personnelle pendant une panne d'index, puis document invalide : l'index
    dit encore « partagée », mais seul son propriétaire compte l'analyse illisible."""
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    courante = banc.depot.read(A, ident)
    banc.depot.write(
        A,
        ident,
        {**courante.document, "visibility": "personal"},
        expected_revision=1,
        actor=CREATEUR_GROUPE.ref,
    )
    commit(banc.racine, {relative(A, ident): b"api_version: x\n"}, "intrus")
    assert lister(banc, LECTEUR_GROUPE) == {"analyses": [], "unreadable": 0}
    assert lister(banc, ADMIN_GROUPE) == {"analyses": [], "unreadable": 0}
    assert lister(banc, CREATEUR_GROUPE) == {"analyses": [], "unreadable": 1}


def rendre_personnelle_derriere_l_index(banc: Banc, ident: str) -> None:
    """Partagée dans l'index, personnelle dans git : écriture faite pendant une panne d'index."""
    courante = banc.depot.read(A, ident)
    banc.depot.write(
        A,
        ident,
        {**courante.document, "visibility": "personal"},
        expected_revision=1,
        actor=CREATEUR_GROUPE.ref,
    )


def test_la_liste_n_analyse_pas_le_contenu_d_une_ligne_perimee_dont_on_n_est_pas_autorise(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Le travail de la liste ne dépend pas du contenu privé : pour une ligne périmée, la
    visibilité s'établit d'abord (coup d'oeil), le document n'est lu et validé qu'ensuite."""
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    rendre_personnelle_derriere_l_index(banc, ident)
    appels = espionner_validation(monkeypatch)
    lectures = compter(monkeypatch)
    for profil in (LECTEUR_GROUPE, ADMIN_GROUPE):
        assert lister(banc, profil) == {"analyses": [], "unreadable": 0}
    assert sum(appels.values()) == 0, dict(appels)
    assert lectures["_history"] == 0 and lectures["_load"] == 0, dict(lectures)
    # Témoin : pour son propriétaire, le contenu est bien lu, validé, et la ligne corrigée.
    vues = lister(banc, CREATEUR_GROUPE)["analyses"]
    assert [(v["id"], v["visibility"], v["state"]) for v in vues] == [
        (ident, "personal", "index_stale")
    ]
    assert appels["validate"] >= 1 and lectures["_load"] >= 1


# -- le coup d'oeil du dépôt -----------------------------------------------------------------------


def test_le_coup_d_oeil_d_un_depot_vide_ou_d_une_analyse_inconnue(tmp_path: Path) -> None:
    vide = repository(init(tmp_path / "vide"))
    assert vide.glance(A, new_id()) == Glance(None, None, False)
    plein = repository(init(tmp_path / "plein", commit=True))
    assert plein.glance(A, new_id()) == Glance(None, None, False)
    with pytest.raises(ContentError) as erreur:
        plein.glance("Mauvais Espace", new_id())
    assert erreur.value.reason == "bad_identifier"
