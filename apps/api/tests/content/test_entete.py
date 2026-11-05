"""Le coup d'oeil n'analyse que l'en-tête canonique d'une analyse (plan 18.3, relecture 4)."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import pytest
import yaml
from skifer_board.content import ContentError, dumps, validate
from skifer_board.content import analysis as analysis_module
from skifer_board.content.analysis import HEADER_MAX, brief

from .monde import ACTOR, document, init, new_id, repository

ESPACE = "finance"
PROPRIETAIRE = (ACTOR.issuer, ACTOR.subject)


def canonique(**changes: Any) -> bytes:
    return dumps(validate(document(new_id(), **changes)))


def debut_de_la_requete(raw: bytes) -> int:
    trouve = re.search(rb"^query:", raw, re.MULTILINE)
    assert trouve is not None
    return trouve.start()


def espionner_yaml(monkeypatch: pytest.MonkeyPatch) -> list[int]:
    """Taille de chaque texte que `yaml.load` analyse."""
    tailles: list[int] = []
    original = yaml.load

    def espion(stream: Any, *args: Any, **kw: Any) -> Any:
        tailles.append(len(stream))
        return original(stream, *args, **kw)

    monkeypatch.setattr(yaml, "load", espion)
    return tailles


def refuse(raw: bytes) -> None:
    with pytest.raises(ContentError) as erreur:
        brief(raw)
    assert (erreur.value.code, erreur.value.reason) == ("invalid_analysis", "unreadable_document")


# -- ce que l'en-tête rend -----------------------------------------------------------------------


def test_l_en_tete_rend_emetteur_sujet_visibilite_et_identifiant() -> None:
    ident = new_id()
    raw = dumps(validate(document(ident, visibility="shared")))
    assert brief(raw) == (*PROPRIETAIRE, "shared", ident)


@pytest.mark.parametrize(
    "description",
    [
        "ligne\nquery: piégée\nsuite",
        "ligne\nquery:\n",
        "query:",
        "\nquery: x",
        "a\n\nquery:\n  owner: {issuer: x, subject: y}\nvisibility: shared",
        "fin avec espace \nquery: ",
        "tab\t\nquery:\t",
        "é\nquery: é\n",
    ],
)
def test_une_description_multiligne_ne_peut_pas_porter_une_ligne_query_en_colonne_0(
    description: str,
) -> None:
    """Le texte canonique écrit une chaîne multiligne en bloc indenté ou entre guillemets, avec
    ses retours à la ligne échappés : l'en-tête s'arrête bien à la vraie requête."""
    ident = new_id()
    raw = dumps(validate(document(ident, description=description, visibility="personal")))
    texte = raw.decode("utf-8")
    assert description in yaml.safe_load(texte)["description"]
    # La première ligne qui commence par `query:` en colonne 0 est la vraie requête.
    debut = debut_de_la_requete(raw)
    assert raw[debut:].startswith(b"query:\n  connection: finance")
    assert [m.start() for m in re.finditer(rb"^query:", raw, re.MULTILINE)] == [debut]
    assert brief(raw) == (*PROPRIETAIRE, "personal", ident)


def test_le_plus_gros_en_tete_du_schema_tient_dans_la_borne() -> None:
    """Nom, description et deux textes de personne à leur longueur maximale, écrits avec les
    caractères les plus longs : en UTF-8 brut (4 octets) ou en échappement (`\\uFFFE`, 6 octets)."""
    plus_gros = 0
    for caractere in ("\U00020000", "\ufffe", "\u20ac", "a"):
        ident = new_id()
        raw = dumps(
            validate(
                document(
                    ident,
                    name=caractere * 120,
                    description=caractere * 2000,
                    owner={"issuer": caractere * 512, "subject": caractere * 512},
                )
            )
        )
        plus_gros = max(plus_gros, debut_de_la_requete(raw))
        assert debut_de_la_requete(raw) <= HEADER_MAX, caractere
        assert brief(raw) == (caractere * 512, caractere * 512, "personal", ident)
    assert plus_gros < 20_000


# -- le travail ne dépend ni de la requête ni de la taille ----------------------------------------


def filtres_en_liste(total: int) -> list[dict[str, Any]]:
    return [
        {"column": f"c{j}", "operator": "in", "value": [f"v{j:02d}{k:03d}" for k in range(100)]}
        for j in range(total)
    ]


def filtres_scalaires(total: int, longueur: int) -> list[dict[str, Any]]:
    return [{"column": f"c{j}", "operator": "eq", "value": "s" * longueur} for j in range(total)]


def test_deux_documents_de_meme_taille_et_de_structures_differentes_coutent_la_meme_analyse(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Même en-tête, même nombre d'octets, requêtes de formes opposées : 12 filtres de 100 valeurs
    contre 32 filtres à valeur unique. Le nombre d'analyses YAML et leur taille sont les mêmes,
    et ne dépendent que de l'en-tête."""
    ident_a, ident_b = new_id(), new_id()
    requete = document(ident_a)["query"]
    en_liste = {**requete, "filters": filtres_en_liste(12)}
    taille_a = len(dumps(validate(document(ident_a, query=en_liste))))
    scalaires = {**requete, "filters": filtres_scalaires(32, 1)}
    manque = taille_a - len(dumps(validate(document(ident_b, query=scalaires))))
    assert manque > 0
    # Le manque se répartit sur les valeurs, sans dépasser 1 024 caractères chacune.
    base, reste = divmod(manque, 32)
    longueurs = [1 + base + (1 if rang < reste else 0) for rang in range(32)]
    assert max(longueurs) <= 1024
    scalaires["filters"] = [
        {"column": f"c{j}", "operator": "eq", "value": "s" * longueur}
        for j, longueur in enumerate(longueurs)
    ]
    raw_a = dumps(validate(document(ident_a, query=en_liste)))
    raw_b = dumps(validate(document(ident_b, query=scalaires)))
    assert len(raw_a) == len(raw_b)
    assert raw_a != raw_b and raw_a.count(b"\n") != raw_b.count(b"\n")
    tailles = espionner_yaml(monkeypatch)
    brief(raw_a)
    avant = list(tailles)
    brief(raw_b)
    apres = tailles[len(avant) :]
    assert len(avant) == len(apres) == 1
    assert avant == apres
    assert avant[0] == debut_de_la_requete(raw_a) == debut_de_la_requete(raw_b) < 1024


def test_le_coup_d_oeil_du_depot_n_analyse_que_l_en_tete(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    depot = repository(init(tmp_path / "contenus"))
    petit, gros = new_id(), new_id()
    requete = document(petit)["query"]
    for ident, filtres in ((petit, filtres_scalaires(1, 1)), (gros, filtres_en_liste(32))):
        depot.write(
            ESPACE,
            ident,
            validate(document(ident, query={**requete, "filters": filtres})),
            expected_revision=None,
            actor=ACTOR,
        )
    tailles = espionner_yaml(monkeypatch)
    for ident in (petit, gros):
        assert depot.glance(ESPACE, ident).owner == ACTOR
    assert len(tailles) == 2
    assert tailles[0] == tailles[1] < 1024


# -- un en-tête qui n'est pas celui que Board écrit est un document abîmé ----------------------


def entete() -> bytes:
    raw = canonique()
    return raw[: debut_de_la_requete(raw)]


def test_une_requete_au_dela_de_la_borne_d_en_tete_est_un_document_abime() -> None:
    debut = entete()
    reste = HEADER_MAX - len(debut)
    assert reste > 2
    # Rembourré par un commentaire : `query:` commence exactement à la borne, puis un octet de plus.
    au_plus = debut + b"#" + b"c" * (reste - 2) + b"\n"
    assert len(au_plus) == HEADER_MAX
    assert brief(au_plus + b"query: {}\n")[0] == ACTOR.issuer
    refuse(au_plus + b"\nquery: {}\n")


def test_un_texte_sans_ligne_query_est_un_document_abime() -> None:
    refuse(entete())
    refuse(b"")
    # `query:` doit commencer la ligne : indentée ou en milieu de ligne, ce n'est pas la requête.
    refuse(entete() + b" query: {}\n")
    refuse(entete() + b"x: query:\n")


def test_une_cle_en_trop_ou_en_moins_dans_l_en_tete_est_un_document_abime() -> None:
    debut = entete()
    suite = b"query: {}\n"
    assert brief(debut + suite)[0] == ACTOR.issuer
    refuse(debut + b"extra: 1\n" + suite)
    refuse(debut.replace(b"description: Suivi.\n", b"") + suite)
    refuse(b"query: {}\n" + debut)
    refuse(debut.replace(b"  subject: ", b"  extra: 1\n  subject: ") + suite)
    refuse(debut.replace(b"  subject: ", b"  autre: ") + suite)


@pytest.mark.parametrize(
    ("ancien", "nouveau"),
    [
        (b"visibility: personal", b"visibility: secret"),
        (b"visibility: personal", b"visibility: 1"),
        (b"id: ", b"id: [x] #"),
        (b"api_version: board.analysis/v1\n", b"api_version: [\n"),
        (b"api_version: board.analysis/v1\n", b"api_version: a\napi_version: b\n"),
        (b"owner:\n", b"owner: texte\n"),
        (b"owner:\n", b"owner: [a]\n"),
    ],
)
def test_un_en_tete_aux_valeurs_inattendues_est_un_document_abime(
    ancien: bytes, nouveau: bytes
) -> None:
    debut = entete()
    assert ancien in debut
    refuse(debut.replace(ancien, nouveau, 1) + b"query: {}\n")


def test_un_en_tete_qui_n_est_pas_un_dictionnaire_ou_pas_de_l_utf_8_est_un_document_abime() -> None:
    refuse(b"- a\n- b\nquery: {}\n")
    refuse(b"seul\nquery: {}\n")
    refuse(b"\xff\xfe\x00\nquery: {}\n")
    refuse(b"owner: {issuer: 1, subject: b}\nquery: {}\n")
    refuse(
        b"api_version: a\nid: b\nname: n\ndescription: d\nvisibility: shared\nowner: t\nquery: {}\n"
    )


def test_un_document_valide_mais_non_canonique_n_est_pas_lisible_par_le_coup_d_oeil() -> None:
    """Effet accepté : la requête écrite avant le propriétaire (valide pour le schéma, hors Board)
    n'est pas lisible par le coup d'oeil."""
    ident = new_id()
    valide = validate(document(ident))
    ordre_du_schema = yaml.safe_dump(valide, sort_keys=False, allow_unicode=True).encode()
    requete_d_abord = yaml.safe_dump(
        {"query": valide["query"], **{k: v for k, v in valide.items() if k != "query"}},
        sort_keys=False,
        allow_unicode=True,
    ).encode()
    assert analysis_module.loads(ordre_du_schema) == valide
    assert analysis_module.loads(requete_d_abord) == valide
    assert brief(ordre_du_schema)[3] == ident
    refuse(requete_d_abord)
