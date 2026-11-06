"""Format `board.dashboard/v1` : schéma, corpus, sentinelles, règles et bornes (plan 19.1)."""

from __future__ import annotations

import copy
import json
import re
from pathlib import Path
from typing import Any

import pytest
import yaml
from jsonschema import Draft202012Validator
from skifer_board.content import ContentError
from skifer_board.content import dashboard as module
from skifer_board.content.dashboard import RULES, brief, dumps, loads, schema, validate

from .monde_dashboard import (
    column,
    common_filter,
    container,
    dashboard,
    flat,
    kpi,
    new_id,
    paragraph,
    row,
    section,
    segment,
    separator,
    text,
    visual,
    with_components,
    with_sections,
)

RACINE = Path(__file__).resolve().parents[4] / "contracts" / "dashboards"
FIXTURES = RACINE / "fixtures"
VALIDES = sorted((FIXTURES / "valid").glob("*.yaml"))
INVALIDES = sorted((FIXTURES / "invalid").glob("*.yaml"))
SEMANTIQUES = {
    "invalid_filter",
    "duplicate_id",
    "row_overflow",
    "too_deep",
    "container_not_alone",
    "filter_without_target",
    "unknown_target",
    "target_not_executable",
    "default_not_allowed",
    "wrong_type",
    "out_of_bounds",
}


def brut() -> Draft202012Validator:
    return Draft202012Validator(json.loads((RACINE / "dashboard.v1.json").read_text()))


def refus(valeur: Any) -> list[tuple[str, str]]:
    with pytest.raises(ContentError) as erreur:
        validate(valeur)
    assert erreur.value.code == "invalid_dashboard"
    assert erreur.value.reason == erreur.value.violations[0].rule
    return [(v.path, v.rule) for v in erreur.value.violations]


def lu(chemin: str) -> dict[str, Any]:
    donnees = yaml.safe_load((FIXTURES / "valid" / chemin).read_text(encoding="utf-8"))
    assert isinstance(donnees, dict)
    return donnees


# -- schéma ------------------------------------------------------------------------------------


def test_le_schema_est_un_draft_2020_12_valide_et_ferme() -> None:
    contenu = json.loads((RACINE / "dashboard.v1.json").read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(contenu)
    assert schema() == contenu
    assert contenu["$schema"] == "https://json-schema.org/draft/2020-12/schema"

    def objets(noeud: Any) -> list[dict[str, Any]]:
        if isinstance(noeud, dict):
            trouves = [noeud] if noeud.get("type") == "object" else []
            return trouves + [x for valeur in noeud.values() for x in objets(valeur)]
        if isinstance(noeud, list):
            return [x for valeur in noeud for x in objets(valeur)]
        return []

    fermes: list[dict[str, Any]] = []
    aiguillages: list[dict[str, Any]] = []
    for objet in objets(contenu):
        # Un aiguillage choisit sa branche fermée par `type` : il n'a ni champ propre ni exception.
        (fermes if objet.get("additionalProperties") is False else aiguillages).append(objet)
    assert len(fermes) == 21
    assert len(aiguillages) == 2
    assert all(set(a["properties"]) == {"type"} and "allOf" in a for a in aiguillages)


def test_aucun_champ_du_schema_ne_porte_du_sql_une_requete_une_donnee_ou_un_style() -> None:
    def noms(noeud: Any) -> set[str]:
        if isinstance(noeud, dict):
            propres = set(noeud.get("properties", {}))
            return propres | {n for valeur in noeud.values() for n in noms(valeur)}
        if isinstance(noeud, list):
            return {n for valeur in noeud for n in noms(valeur)}
        return set()

    interdits = re.compile(
        r"sql|statement|table|from|data|secret|token|password|select|limit|query"
        r"|environment|theme|color|colour|style|html|href|url|src|image|option"
    )
    assert not [nom for nom in noms(schema()) if interdits.search(nom)]


def test_les_motifs_du_schema_suivent_ceux_des_analyses() -> None:
    from skifer_board.content import schema as analyse

    mien, leur = schema()["$defs"], analyse()["$defs"]
    for nom in ("uuid", "identifier", "name", "person", "person_part"):
        assert mien[nom] == leur[nom], nom
    # même contrainte structurelle ; seule la description (annotation) diffère
    assert {k: v for k, v in mien["scalar"].items() if k != "description"} == leur["scalar"]


def test_la_description_du_document_et_celle_des_analyses_ont_le_meme_motif() -> None:
    from skifer_board.content import schema as analyse

    assert schema()["properties"]["description"] == analyse()["properties"]["description"]


def test_le_schema_est_introuvable() -> None:
    schema.cache_clear()
    module._validator.cache_clear()
    original = module.SCHEMA_PATH
    try:
        module.SCHEMA_PATH = original.with_name("absent.json")
        with pytest.raises(ContentError) as erreur:
            schema()
        assert (erreur.value.code, erreur.value.reason) == (
            "content_unavailable",
            "schema_unavailable",
        )
    finally:
        module.SCHEMA_PATH = original
        schema.cache_clear()
        module._validator.cache_clear()


# -- corpus ------------------------------------------------------------------------------------


def test_le_corpus_est_complet() -> None:
    assert len(VALIDES) == 3
    assert len(INVALIDES) >= 60
    assert all(p.with_suffix(".expected.json").exists() for p in INVALIDES)
    assert len(list((FIXTURES / "invalid").glob("*.expected.json"))) == len(INVALIDES)


@pytest.mark.parametrize("chemin", VALIDES, ids=lambda p: p.stem)
def test_une_fixture_valide_passe_le_schema_et_est_canonique(chemin: Path) -> None:
    donnees = yaml.safe_load(chemin.read_text(encoding="utf-8"))
    assert list(brut().iter_errors(donnees)) == []
    assert validate(donnees) == donnees
    assert dumps(loads(chemin.read_bytes())) == chemin.read_bytes()


def test_un_contenu_equivalent_donne_les_memes_octets() -> None:
    autre = (FIXTURES / "equivalent" / "minimal-reordered.yaml").read_bytes()
    assert dumps(loads(autre)) == (FIXTURES / "valid" / "minimal.yaml").read_bytes()


@pytest.mark.parametrize("chemin", INVALIDES, ids=lambda p: p.stem)
def test_une_fixture_invalide_est_refusee_avec_son_code(chemin: Path) -> None:
    attendu = json.loads(chemin.with_suffix(".expected.json").read_text(encoding="utf-8"))
    with pytest.raises(ContentError) as erreur:
        loads(chemin.read_bytes())
    assert erreur.value.code == attendu["code"] == "invalid_dashboard"
    violations = [{"path": v.path, "rule": v.rule} for v in erreur.value.violations]
    assert violations == attendu["violations"]
    assert {v["rule"] for v in violations} <= RULES
    assert all(v["path"] == "" or v["path"].startswith("/") for v in violations)
    donnees = yaml.safe_load(chemin.read_text(encoding="utf-8"))
    erreurs_du_schema = list(brut().iter_errors(donnees)) if isinstance(donnees, dict) else [1]
    if attendu["layer"] == "semantic":
        assert {v["rule"] for v in violations} <= SEMANTIQUES
        assert erreurs_du_schema == []
    else:
        assert attendu["layer"] == "structural"
        assert erreurs_du_schema != []


def test_chaque_regle_du_serveur_a_sa_fixture() -> None:
    vues: set[str] = set()
    for chemin in INVALIDES:
        attendu = json.loads(chemin.with_suffix(".expected.json").read_text(encoding="utf-8"))
        vues |= {v["rule"] for v in attendu["violations"]}
    nouvelles = RULES - {
        "unsupported_value",
        "unreadable_document",
        "not_representable",
        "id_mismatch",
        "bad_identifier",
        "bad_revision",
        "bad_actor",
        "metric_not_in_query",
        "group_by_not_in_query",
        "reserved_name",
        "schema_violation",
        "field_not_allowed",
    }
    assert nouvelles <= vues, nouvelles - vues


def test_le_corpus_couvre_chaque_type_de_composant() -> None:
    complet = lu("complete-shared.yaml")
    types: set[str] = set()

    def parcourir(noeud: Any) -> None:
        if isinstance(noeud, dict):
            if "type" in noeud and "id" in noeud:
                types.add(noeud["type"])
            for valeur in noeud.values():
                parcourir(valeur)
        elif isinstance(noeud, list):
            for valeur in noeud:
                parcourir(valeur)

    parcourir(complet)
    assert types == {"analysis", "kpi", "text", "separator", "container"}


# -- sentinelles : rien d'autre que le format fermé ----------------------------------------------

CHAMPS_INTERDITS = [
    "sql",
    "query",
    "statement",
    "table",
    "tables",
    "from",
    "rows_data",
    "data",
    "secret",
    "token",
    "password",
    "environment",
    "theme",
    "color",
    "style",
    "html",
    "href",
    "src",
    "option",
    "echarts",
]


def objets(noeud: Any, chemin: str = "") -> list[tuple[str, dict[str, Any]]]:
    """Chaque objet d'un document, avec son pointeur JSON."""
    trouves: list[tuple[str, dict[str, Any]]] = []
    if isinstance(noeud, dict):
        trouves.append((chemin, noeud))
        for cle, valeur in noeud.items():
            trouves += objets(valeur, f"{chemin}/{cle}")
    elif isinstance(noeud, list):
        for rang, valeur in enumerate(noeud):
            trouves += objets(valeur, f"{chemin}/{rang}")
    return trouves


def test_la_sentinelle_voit_chaque_objet_du_format() -> None:
    chemins = [chemin for chemin, _ in objets(lu("complete-shared.yaml"))]
    for attendu in (
        "",
        "/owner",
        "/defaults",
        "/filters/0",
        "/layout",
        "/layout/sections/0",
        "/layout/sections/0/rows/0",
        "/layout/sections/0/rows/0/columns/0",
        "/layout/sections/0/rows/0/columns/0/children/0",
        "/layout/sections/0/rows/0/columns/0/children/0/blocks/0",
        "/layout/sections/0/rows/0/columns/0/children/0/blocks/1/content/1",
        "/layout/sections/1/rows/0/columns/0/children/0/reference",
        "/layout/sections/1/rows/0/columns/0/children/0/presentation",
        "/layout/sections/1/rows/0/columns/0/children/0/presentation/threshold",
        "/layout/sections/1/rows/1/columns/0/children/0",
    ):
        assert attendu in chemins, attendu


@pytest.mark.parametrize("champ", CHAMPS_INTERDITS)
def test_sentinelle_aucun_champ_sql_ni_donnee_n_est_accepte_nulle_part(champ: str) -> None:
    modele = lu("complete-shared.yaml")
    for chemin, _ in objets(modele):
        contenu = copy.deepcopy(modele)
        cible: Any = contenu
        for part in [p for p in chemin.split("/") if p]:
            cible = cible[int(part)] if isinstance(cible, list) else cible[part]
        cible[champ] = "SELECT * FROM ventes"
        assert refus(contenu) == [(f"{chemin}/{champ}", "unknown_field")], chemin


@pytest.mark.parametrize(
    "valeur",
    [
        "x'; DROP TABLE ventes; --",
        "1 OR 1=1=",
        "a\\b",
        "SELECT\n1",
        "Île-de-France",
        "é",
    ],
)
def test_sentinelle_une_valeur_de_filtre_n_est_jamais_du_sql(valeur: str) -> None:
    ident = new_id()
    contenu = with_components(visual(ident), filters=[common_filter([ident], default=valeur)])
    assert refus(contenu) == [("/filters/0/default", "invalid_filter")]
    contenu = with_components(visual(ident), filters=[common_filter([ident], allowed=[valeur])])
    assert refus(contenu) == [("/filters/0/allowed", "invalid_filter")]


@pytest.mark.parametrize(
    ("operateur", "valeur"),
    [
        ("eq", "<script>"),
        ("eq", 2**63),
        ("eq", -(2**63) - 1),
        ("in", ["a", 1]),
        ("in", ["a", "a"]),
        ("between", [2, 1]),
        ("between", [1, "a"]),
    ],
)
def test_le_schema_est_structurel_les_valeurs_de_filtres_sont_celles_de_la_soumission(
    operateur: str, valeur: Any
) -> None:
    """Choix du plan 18, repris tel quel : le schéma borne le type et la longueur, le module
    applique les règles de la soumission d'exécution aux valeurs (`invalid_filter`)."""
    ident = new_id()
    contenu = with_components(
        visual(ident), filters=[common_filter([ident], operator=operateur, default=valeur)]
    )
    assert brut().is_valid(contenu)
    assert refus(contenu) == [("/filters/0/default", "invalid_filter")]
    if operateur == "in":
        contenu = with_components(
            visual(ident), filters=[common_filter([ident], operator="in", allowed=valeur)]
        )
        assert brut().is_valid(contenu)
        assert refus(contenu) == [("/filters/0/allowed", "invalid_filter")]


def test_la_description_du_schema_dit_ou_sont_verifiees_les_valeurs_de_filtres() -> None:
    description = schema()["$defs"]["scalar"]["description"]
    assert "invalid_filter" in description
    assert "soumission d'exécution" in description
    assert "seulement quand elles sont numériques" in description


def test_deux_bornes_de_texte_ne_sont_pas_ordonnees_par_le_module() -> None:
    ident = new_id()
    contenu = with_components(
        visual(ident), filters=[common_filter([ident], operator="between", default=["z", "a"])]
    )
    assert brut().is_valid(contenu)
    assert validate(contenu)["filters"][0]["default"] == ["z", "a"]


@pytest.mark.parametrize("ident", ["x\n", "5f1d7c52-3b0e-4d36-9a54-0c7a3e1b9d20\n"])
def test_une_fin_de_ligne_n_est_pas_une_fin_de_motif(ident: str) -> None:
    contenu = dashboard("5f1d7c52-3b0e-4d36-9a54-0c7a3e1b9d20")
    contenu["id"] = ident
    contenu["name"] = "nom\n"
    contenu["owner"]["issuer"] = "x\n"
    contenu["layout"]["sections"][0]["id"] = ident
    contenu["layout"]["sections"][0]["title"] = "titre\n"
    assert set(refus(contenu)) == {
        ("/id", "bad_format"),
        ("/name", "bad_format"),
        ("/owner/issuer", "bad_format"),
        ("/layout/sections/0/id", "bad_format"),
        ("/layout/sections/0/title", "bad_format"),
    }


def test_un_nom_de_champ_inconnu_n_est_cite_que_s_il_est_inoffensif() -> None:
    contenu = dashboard()
    contenu["bon_nom"] = 1
    contenu["x\ny"] = 1
    assert sorted(refus(contenu)) == [("/*", "unknown_field"), ("/bon_nom", "unknown_field")]


@pytest.mark.parametrize(
    "bloc",
    [
        paragraph("<script>alert(1)</script>"),
        paragraph("javascript:alert(1)"),
        paragraph("[lien](https://exemple.test) ![image](x.png) **gras**"),
        paragraph("<img src=x onerror=alert(1)>"),
        paragraph("&lt;b&gt; &amp; <!-- -->"),
    ],
)
def test_du_html_ou_du_markdown_saisi_reste_du_texte_inerte(bloc: dict[str, Any]) -> None:
    contenu = with_components(text(bloc))
    relu = loads(dumps(contenu))
    assert relu["layout"]["sections"][0]["rows"][0]["columns"][0]["children"][0]["blocks"] == [bloc]


# -- types de composants, présentation, texte ---------------------------------------------------


def test_une_presentation_vide_et_une_presentation_complete_sont_valides() -> None:
    ident = new_id()
    complet = visual(
        ident,
        chart="grouped_bars",
        title="Titre",
        legend="shown",
        number_format="percent",
        threshold={"value": -1.5, "label": "Seuil bas"},
        tooltip="value_and_definition",
    )
    assert validate(with_components(complet, kpi(), visual()))


@pytest.mark.parametrize("chart", ["value", "bars", "line", "grouped_bars"])
@pytest.mark.parametrize("legend", ["auto", "shown", "hidden"])
def test_les_graphiques_et_les_legendes_fermes(chart: str, legend: str) -> None:
    assert validate(with_components(visual(chart=chart, legend=legend)))


@pytest.mark.parametrize(
    "format_", ["auto", "integer", "decimal_1", "decimal_2", "percent", "compact"]
)
@pytest.mark.parametrize("infobulle", ["value", "value_and_definition"])
def test_les_formats_de_nombre_et_les_infobulles_fermes(format_: str, infobulle: str) -> None:
    assert validate(with_components(kpi(number_format=format_, tooltip=infobulle)))
    assert validate(dashboard(defaults={"number_format": format_, "tooltip": infobulle}))


def test_un_kpi_n_a_ni_graphique_ni_legende() -> None:
    chemin = "/layout/sections/0/rows/0/columns/0/children/0/presentation"
    assert refus(with_components(kpi(chart="value"))) == [(f"{chemin}/chart", "unknown_field")]
    assert refus(with_components(kpi(legend="auto"))) == [(f"{chemin}/legend", "unknown_field")]


def test_les_defauts_ne_portent_que_la_legende_le_format_et_l_infobulle() -> None:
    assert refus(dashboard(defaults={"chart": "bars"})) == [("/defaults/chart", "unknown_field")]
    assert refus(dashboard(defaults={"title": "x"})) == [("/defaults/title", "unknown_field")]
    assert refus(dashboard(defaults={"threshold": {"value": 1, "label": "x"}})) == [
        ("/defaults/threshold", "unknown_field")
    ]


def test_les_trois_blocs_de_texte_avec_emphase_et_gras() -> None:
    contenu = with_components(
        text(
            {"type": "heading", "level": 1, "content": [segment("Titre", strong=True)]},
            {"type": "heading", "level": 2, "content": [segment("Sous-titre", emphasis=True)]},
            {
                "type": "paragraph",
                "content": [segment("a "), segment("b", emphasis=True, strong=True)],
            },
            {"type": "list", "ordered": True, "items": [[segment("un")], [segment("deux")]]},
            {"type": "list", "ordered": False, "items": [[segment("un")]]},
        )
    )
    assert loads(dumps(contenu)) == contenu


def test_un_texte_vide_de_blocs_est_valide_mais_pas_un_bloc_vide() -> None:
    assert validate(with_components({"id": new_id(), "type": "text", "blocks": []}))
    assert refus(with_components(text({"type": "paragraph", "content": []}))) == [
        ("/layout/sections/0/rows/0/columns/0/children/0/blocks/0/content", "out_of_bounds")
    ]


def test_un_drapeau_de_texte_est_vrai_ou_absent() -> None:
    chemin = "/layout/sections/0/rows/0/columns/0/children/0/blocks/0/content/0/strong"
    contenu = with_components(text({"type": "paragraph", "content": [segment("x", strong=False)]}))
    assert refus(contenu) == [(chemin, "value_not_allowed")]


def test_un_niveau_d_intertitre_est_un_entier_un_ou_deux() -> None:
    chemin = "/layout/sections/0/rows/0/columns/0/children/0/blocks/0/level"
    bloc = {"type": "heading", "level": 1.0, "content": [segment("x")]}
    assert refus(with_components(text(bloc))) == [(chemin, "wrong_type")]
    bloc["level"] = True
    assert refus(with_components(text(bloc))) == [(chemin, "value_not_allowed")]


def test_un_seuil_est_un_nombre_fini_et_un_libelle() -> None:
    chemin = "/layout/sections/0/rows/0/columns/0/children/0/presentation/threshold"
    seuil = {"value": float("inf"), "label": "x"}
    assert refus(with_components(visual(threshold=seuil))) == [
        (f"{chemin}/value", "unsupported_value")
    ]
    seuil = {"value": 1e15, "label": "x"}
    assert validate(with_components(visual(threshold=seuil)))
    assert validate(with_components(visual(threshold={"value": -1e15, "label": "x" * 80})))
    assert refus(with_components(visual(threshold={"value": 0, "label": "x" * 81}))) == [
        (f"{chemin}/label", "out_of_bounds")
    ]


# -- règles inter-champs -----------------------------------------------------------------------


def test_identifiants_uniques_dans_tout_le_document() -> None:
    commun = new_id()
    contenu = with_sections(
        section(row(column(visual(commun), separator(), ident=new_id()), ident=new_id())),
        section(row(column(kpi(commun), ident=new_id()))),
    )
    assert refus(contenu) == [("/layout/sections/1/rows/0/columns/0/children/0/id", "duplicate_id")]
    # Une section, une rangée, une colonne, un conteneur, un composant ou un filtre : même espace.
    ident = new_id()
    contenu = with_sections(
        section(row(column(container(row(column(ident=ident), ident=new_id())))), ident=ident)
    )
    assert refus(contenu) == [
        ("/layout/sections/0/rows/0/columns/0/children/0/rows/0/columns/0/id", "duplicate_id")
    ]
    cible = new_id()
    contenu = with_components(visual(cible), filters=[common_filter([cible])])
    contenu["filters"][0]["id"] = cible
    assert refus(contenu) == [("/filters/0/id", "duplicate_id")]


def test_l_identifiant_du_dashboard_n_est_pas_dans_l_espace_des_noeuds() -> None:
    ident = new_id()
    assert validate(dashboard(ident, layout={"sections": [section(ident=ident)]}))


@pytest.mark.parametrize(
    ("largeurs", "valide"),
    [
        ([12], True),
        ([6, 6], True),
        ([1] * 12, True),
        ([5, 7], True),
        ([7, 6], False),
        ([12, 1], False),
    ],
)
def test_la_somme_des_largeurs_d_une_rangee_est_au_plus_12(
    largeurs: list[int], valide: bool
) -> None:
    contenu = with_sections(section(row(*(column(span=largeur) for largeur in largeurs))))
    if valide:
        assert validate(contenu)
    else:
        assert refus(contenu) == [("/layout/sections/0/rows/0", "row_overflow")]


def test_une_rangee_trop_large_est_nommee_dans_un_conteneur() -> None:
    interieur = row(column(span=7), column(span=6))
    contenu = with_sections(section(row(column(container(interieur)))))
    assert refus(contenu) == [
        ("/layout/sections/0/rows/0/columns/0/children/0/rows/0", "row_overflow")
    ]


@pytest.mark.parametrize("largeur", [0, 13, -1, True, "6", None])
def test_une_largeur_hors_de_1_a_12_est_refusee(largeur: Any) -> None:
    contenu = with_sections(section(row(column(span=largeur))))
    chemin = "/layout/sections/0/rows/0/columns/0/span"
    assert refus(contenu)[0][0] == chemin


def test_une_largeur_ou_une_revision_decimale_est_refusee_meme_si_elle_est_entiere() -> None:
    assert refus(with_sections(section(row(column(span=6.0))))) == [
        ("/layout/sections/0/rows/0/columns/0/span", "wrong_type")
    ]
    assert refus(with_components(visual(revision=2.0))) == [
        ("/layout/sections/0/rows/0/columns/0/children/0/reference/revision", "wrong_type")
    ]


def conteneurs(niveaux: int) -> dict[str, Any]:
    """Une section dont la première colonne porte `niveaux` conteneurs imbriqués."""
    interieur = row(column(separator()))
    for _ in range(niveaux):
        interieur = row(column(container(interieur)))
    return with_sections(section(interieur))


@pytest.mark.parametrize("niveaux", [0, 1, 2])
def test_trois_niveaux_de_rangees_au_plus(niveaux: int) -> None:
    assert validate(conteneurs(niveaux))


def test_un_quatrieme_niveau_est_refuse_au_conteneur_en_cause() -> None:
    pas = "/columns/0/children/0"
    # le troisième conteneur imbriqué est le seul refusé, et on ne descend pas dedans
    assert refus(conteneurs(3)) == [
        (f"/layout/sections/0/rows/0{pas}/rows/0{pas}/rows/0{pas}", "too_deep")
    ]
    assert (
        refus(conteneurs(4))
        == [(f"/layout/sections/0/rows/0{pas}/rows/0{pas}/rows/0{pas}/rows/0{pas}", "too_deep")]
        or len(refus(conteneurs(4))) == 1
    )


def test_un_conteneur_est_seul_dans_sa_colonne() -> None:
    contenu = with_components(container(row(column())), separator())
    assert refus(contenu) == [
        ("/layout/sections/0/rows/0/columns/0/children", "container_not_alone")
    ]
    assert validate(with_components(container(row(column()))))
    assert validate(with_components(separator(), separator()))


def test_toutes_les_violations_sont_rendues_triees() -> None:
    commun = new_id()
    contenu = with_sections(
        section(row(column(visual(commun), span=7), column(kpi(commun), span=7)))
    )
    assert refus(contenu) == [
        ("/layout/sections/0/rows/0", "row_overflow"),
        ("/layout/sections/0/rows/0/columns/1/children/0/id", "duplicate_id"),
    ]


# -- filtres communs ---------------------------------------------------------------------------


def avec_filtre(**champs: Any) -> dict[str, Any]:
    cible = new_id()
    return with_components(visual(cible), filters=[common_filter([cible], **champs)])


def test_les_valeurs_d_un_filtre_sont_normalisees_comme_celles_d_une_analyse() -> None:
    document = validate(
        avec_filtre(operator="in", default=["Sud", "Nord"], allowed=["Sud", "Nord", "Est"])
    )
    assert document["filters"][0]["default"] == ["Nord", "Sud"]
    assert document["filters"][0]["allowed"] == ["Est", "Nord", "Sud"]
    # un intervalle garde l'ordre de ses bornes
    entre = validate(avec_filtre(dimension="revenue", operator="between", default=[1, 2.5]))
    assert entre["filters"][0]["default"] == [1, 2.5]


def test_la_validation_ne_modifie_pas_son_entree() -> None:
    entree = avec_filtre(operator="in", default=["b", "a"])
    copie = copy.deepcopy(entree)
    sortie = validate(entree)
    assert entree == copie
    sortie["filters"][0]["default"].append("z")
    assert entree == copie


@pytest.mark.parametrize(
    "champs",
    [
        {"operator": "eq", "default": "Nord"},
        {"operator": "eq", "default": 3},
        {"operator": "eq", "default": 3.5},
        {"operator": "eq", "default": True},
        {"operator": "in", "default": ["a", "b"]},
        {"operator": "between", "default": [1, 2]},
        {"operator": "between", "default": [2, 2]},
        {"operator": "eq"},
        {"operator": "in", "allowed": ["a", "b"]},
        {"operator": "eq", "default": "a", "allowed": ["a"]},
        {"operator": "in", "default": ["a"], "allowed": ["a", "b"]},
        {"operator": "between", "default": [1, 3], "allowed": [1, 2, 3]},
    ],
)
def test_filtres_valides(champs: dict[str, Any]) -> None:
    assert validate(avec_filtre(**champs))


@pytest.mark.parametrize(
    ("champs", "attendu"),
    [
        ({"operator": "in", "default": "a"}, [("/filters/0/default", "wrong_type")]),
        ({"operator": "eq", "default": ["a"]}, [("/filters/0/default", "wrong_type")]),
        ({"operator": "between", "default": [1]}, [("/filters/0/default", "out_of_bounds")]),
        ({"operator": "in", "default": []}, [("/filters/0/default", "out_of_bounds")]),
        ({"operator": "in", "default": ["a", "a"]}, [("/filters/0/default", "invalid_filter")]),
        ({"operator": "in", "default": ["a", 1]}, [("/filters/0/default", "invalid_filter")]),
        ({"operator": "between", "default": [2, 1]}, [("/filters/0/default", "invalid_filter")]),
        ({"operator": "between", "default": [1, "a"]}, [("/filters/0/default", "invalid_filter")]),
        ({"operator": "between", "default": [1, True]}, [("/filters/0/default", "invalid_filter")]),
        ({"operator": "eq", "default": "x" * 1025}, [("/filters/0/default", "out_of_bounds")]),
        ({"operator": "ne"}, [("/filters/0/operator", "value_not_allowed")]),
        ({"operator": "eq", "allowed": ["a", "a"]}, [("/filters/0/allowed", "invalid_filter")]),
        ({"operator": "eq", "allowed": ["a", 1]}, [("/filters/0/allowed", "invalid_filter")]),
        ({"operator": "eq", "allowed": []}, [("/filters/0/allowed", "out_of_bounds")]),
        (
            {"operator": "eq", "default": "c", "allowed": ["a", "b"]},
            [("/filters/0/default", "default_not_allowed")],
        ),
        (
            {"operator": "in", "default": ["a", "c"], "allowed": ["a", "b"]},
            [("/filters/0/default", "default_not_allowed")],
        ),
        (
            {"operator": "between", "default": [1, 9], "allowed": [1, 2, 3]},
            [("/filters/0/default", "default_not_allowed")],
        ),
        # `True`, `1` et `1.0` sont trois valeurs distinctes
        (
            {"operator": "eq", "default": 1, "allowed": [True, 2]},
            [("/filters/0/allowed", "invalid_filter")],
        ),
        (
            {"operator": "in", "default": [1], "allowed": [1.0, 2.0]},
            [("/filters/0/default", "default_not_allowed")],
        ),
        (
            {"operator": "eq", "default": "a", "allowed": ["a", "a"]},
            [("/filters/0/allowed", "invalid_filter")],
        ),
    ],
)
def test_filtres_refuses(champs: dict[str, Any], attendu: list[tuple[str, str]]) -> None:
    assert refus(avec_filtre(**champs)) == attendu


def test_un_filtre_cible_des_composants_executables_qui_existent() -> None:
    visuel, indicateur, note, rangee = new_id(), new_id(), new_id(), new_id()
    contenu = with_sections(
        section(row(column(visual(visuel), kpi(indicateur), text(ident=note)), ident=rangee))
    )
    contenu["filters"] = [common_filter([visuel, indicateur])]
    assert validate(contenu)
    for cible, regle in (
        (note, "target_not_executable"),
        (rangee, "target_not_executable"),
        (new_id(), "unknown_target"),
    ):
        contenu["filters"] = [common_filter([visuel, cible])]
        assert refus(contenu) == [("/filters/0/targets/1", regle)]


def test_un_filtre_sans_cible_est_refuse() -> None:
    contenu = with_components(visual(), filters=[common_filter([])])
    assert refus(contenu) == [("/filters/0/targets", "filter_without_target")]


def test_un_filtre_ne_cible_pas_un_autre_filtre_ni_lui_meme() -> None:
    contenu = with_components(visual())
    premier = common_filter(
        [contenu["layout"]["sections"][0]["rows"][0]["columns"][0]["children"][0]["id"]]
    )
    second = common_filter([premier["id"]])
    soi = common_filter([])
    soi["targets"] = [soi["id"]]
    contenu["filters"] = [premier, second, soi]
    assert refus(contenu) == [
        ("/filters/1/targets/0", "target_not_executable"),
        ("/filters/2/targets/0", "target_not_executable"),
    ]


def test_les_filtres_sont_juges_apres_la_mise_en_page_quel_que_soit_l_ordre() -> None:
    cible = new_id()
    contenu = with_sections(section(row(column(visual(cible)))), filters=[common_filter([cible])])
    assert validate(contenu)["filters"][0]["targets"] == [cible]
    ordre = {cle: contenu[cle] for cle in ("filters", "layout", "id")}
    assert validate({**contenu, **ordre})["filters"][0]["targets"] == [cible]


# -- bornes ------------------------------------------------------------------------------------


def composants(nombre: int, *, executables: int | None = None) -> list[dict[str, Any]]:
    executables = nombre if executables is None else executables
    return [visual() if rang < executables else separator() for rang in range(nombre)]


def chemin_du_composant(rang: int) -> str:
    """Pointeur du `rang`-ième composant de `flat` (12 colonnes, 24 rangées par section)."""
    ligne, colonne = divmod(rang, 12)
    section_, ligne = divmod(ligne, 24)
    return f"/layout/sections/{section_}/rows/{ligne}/columns/{colonne}/children/0"


@pytest.mark.parametrize("executables", [1, 39, 40])
def test_jusqu_a_40_composants_executables(executables: int) -> None:
    assert validate(flat(composants(executables)))


def test_le_quarante_et_unieme_composant_executable_est_refuse() -> None:
    assert refus(flat(composants(41))) == [(chemin_du_composant(40), "out_of_bounds")]
    # on ne signale que le premier dépassement
    assert refus(flat(composants(50))) == [(chemin_du_composant(40), "out_of_bounds")]


def test_jusqu_a_64_composants_au_total() -> None:
    assert validate(flat(composants(64, executables=40)))


def test_le_soixante_cinquieme_composant_est_refuse_meme_s_il_n_est_pas_executable() -> None:
    assert refus(flat(composants(65, executables=40))) == [
        (chemin_du_composant(64), "out_of_bounds")
    ]


def test_les_deux_bornes_de_composants_se_cumulent() -> None:
    attendu = [
        (chemin_du_composant(40), "out_of_bounds"),
        (chemin_du_composant(64), "out_of_bounds"),
    ]
    assert refus(flat(composants(65))) == attendu


def test_un_kpi_est_un_composant_executable() -> None:
    assert refus(flat([kpi() for _ in range(41)])) == [(chemin_du_composant(40), "out_of_bounds")]


def test_vingt_sections_au_plus() -> None:
    assert validate(with_sections(*(section() for _ in range(20))))
    assert refus(with_sections(*(section() for _ in range(21)))) == [
        ("/layout/sections", "out_of_bounds")
    ]


def test_trente_deux_filtres_au_plus() -> None:
    cible = new_id()
    filtres = [common_filter([cible]) for _ in range(33)]
    assert validate(with_components(visual(cible), filters=filtres[:32]))
    assert refus(with_components(visual(cible), filters=filtres)) == [("/filters", "out_of_bounds")]


def test_quarante_cibles_au_plus_par_filtre() -> None:
    composants_ = [visual() for _ in range(41)]
    ids = [item["id"] for item in composants_]
    filtre_ok = common_filter(ids[:40])
    assert validate(flat(composants_[:40], filters=[filtre_ok]))
    assert refus(flat(composants_[:40], filters=[common_filter(ids)])) == [
        ("/filters/0/targets", "out_of_bounds")
    ]


def test_vingt_quatre_rangees_par_section_et_par_conteneur() -> None:
    assert validate(with_sections(section(*(row() for _ in range(24)))))
    assert refus(with_sections(section(*(row() for _ in range(25))))) == [
        ("/layout/sections/0/rows", "out_of_bounds")
    ]
    interieur = [row() for _ in range(25)]
    assert refus(with_components(container(*interieur))) == [
        ("/layout/sections/0/rows/0/columns/0/children/0/rows", "out_of_bounds")
    ]


def test_douze_colonnes_et_seize_enfants_au_plus() -> None:
    assert validate(with_sections(section(row(*(column(span=1) for _ in range(12))))))
    assert refus(with_sections(section(row(*(column(span=1) for _ in range(13)))))) == [
        ("/layout/sections/0/rows/0/columns", "out_of_bounds"),
    ]
    assert validate(with_components(*(separator() for _ in range(16))))
    assert refus(with_components(*(separator() for _ in range(17)))) == [
        ("/layout/sections/0/rows/0/columns/0/children", "out_of_bounds")
    ]


def rangee_pleine(colonnes: int = 12) -> dict[str, Any]:
    return row(*(column(span=1) for _ in range(colonnes)))


def test_600_noeuds_au_plus() -> None:
    # une section de 24 rangées de 12 colonnes : 1 + 24 + 288 = 313 noeuds
    pleine = section(*(rangee_pleine() for _ in range(24)))
    # une section de 22 rangées de 12 colonnes : 1 + 22 + 264 = 287 noeuds
    reste = [rangee_pleine() for _ in range(22)]
    assert validate(with_sections(pleine, section(*reste)))
    # un noeud de plus : la section, ses rangées et ses colonnes comptent tous
    assert refus(with_sections(pleine, section(*reste, row()))) == [
        ("/layout/sections/1/rows/22", "out_of_bounds")
    ]


def test_5000_caracteres_de_texte_au_plus_par_composant() -> None:
    def long(nombre: int) -> dict[str, Any]:
        reste, pleins = nombre % 1000, nombre // 1000
        segments = [segment("x" * 1000) for _ in range(pleins)]
        if reste:
            segments.append(segment("y" * reste))
        return with_components(text({"type": "paragraph", "content": segments}))

    assert validate(long(5000))
    assert refus(long(5001)) == [
        ("/layout/sections/0/rows/0/columns/0/children/0/blocks", "out_of_bounds")
    ]
    # les éléments de liste comptent aussi
    items = [[segment("z" * 1000)] for _ in range(6)]
    assert refus(with_components(text({"type": "list", "ordered": False, "items": items}))) == [
        ("/layout/sections/0/rows/0/columns/0/children/0/blocks", "out_of_bounds")
    ]


def test_bornes_de_longueur_des_textes() -> None:
    assert validate(dashboard(name="n" * 120, description="d" * 2000))
    assert refus(dashboard(name="n" * 121)) == [("/name", "out_of_bounds")]
    assert refus(dashboard(description="d" * 2001)) == [("/description", "out_of_bounds")]
    section_titre = with_sections(section(title="t" * 120))
    assert validate(section_titre)
    assert refus(with_sections(section(title="t" * 121))) == [
        ("/layout/sections/0/title", "out_of_bounds")
    ]
    bloc = {"type": "paragraph", "content": [segment("s" * 1001)]}
    assert refus(with_components(text(bloc))) == [
        ("/layout/sections/0/rows/0/columns/0/children/0/blocks/0/content/0/text", "out_of_bounds")
    ]
    trop = {"type": "paragraph", "content": [segment("s") for _ in range(21)]}
    assert refus(with_components(text(trop))) == [
        ("/layout/sections/0/rows/0/columns/0/children/0/blocks/0/content", "out_of_bounds")
    ]
    liste = {"type": "list", "ordered": True, "items": [[segment("s")] for _ in range(31)]}
    assert refus(with_components(text(liste))) == [
        ("/layout/sections/0/rows/0/columns/0/children/0/blocks/0/items", "out_of_bounds")
    ]
    blocs = [paragraph("s") for _ in range(31)]
    assert refus(with_components(text(*blocs))) == [
        ("/layout/sections/0/rows/0/columns/0/children/0/blocks", "out_of_bounds")
    ]


def test_cent_valeurs_au_plus_par_defaut_et_par_liste_autorisee() -> None:
    valeurs = [f"v{rang:03}" for rang in range(101)]
    assert validate(avec_filtre(operator="in", default=valeurs[:100], allowed=valeurs[:100]))
    assert refus(avec_filtre(operator="in", allowed=valeurs)) == [
        ("/filters/0/allowed", "out_of_bounds")
    ]
    assert refus(avec_filtre(operator="in", default=valeurs)) == [
        ("/filters/0/default", "out_of_bounds")
    ]


def test_l_imbrication_json_est_bornee_avant_le_schema() -> None:
    profond: Any = {"id": new_id(), "rows": []}
    for _ in range(60):
        profond = {"deeper": [profond]}
    contenu = dashboard()
    contenu["layout"]["sections"] = [profond]
    resultat = refus(contenu)
    assert len(resultat) == 1
    assert resultat[0][1] == "out_of_bounds"
    assert refus({"a": float("nan")}) == [("/a", "unsupported_value")]
    assert refus({1: 2}) == [("", "unsupported_value")]
    assert refus({"a": (1, 2)}) == [("/a", "unsupported_value")]


# -- sérialisation canonique ---------------------------------------------------------------------


def test_les_cles_suivent_l_ordre_de_lecture() -> None:
    complet = lu("complete-shared.yaml")
    octets = dumps(complet).decode()
    lignes = [ligne for ligne in octets.splitlines() if re.match(r"^[a-z_]+:", ligne)]
    assert [ligne.split(":")[0] for ligne in lignes] == [
        "api_version",
        "id",
        "name",
        "description",
        "visibility",
        "owner",
        "defaults",
        "filters",
        "layout",
    ]
    # chaque objet commence par `id` puis `type`, jamais l'inverse
    assert "type: kpi\n  id:" not in octets
    assert re.search(
        r"- id: \S+\n\s+type: kpi\n\s+reference:\n\s+analysis_id: \S+\n\s+revision:", octets
    )


def test_les_octets_sont_stables_d_une_ecriture_a_l_autre() -> None:
    document = lu("complete-shared.yaml")
    premiers = dumps(document)
    assert dumps(loads(premiers)) == premiers
    inverse = json.loads(
        json.dumps(document), object_pairs_hook=lambda paires: dict(reversed(paires))
    )
    assert dumps(inverse) == premiers


def test_true_1_et_1_0_donnent_trois_documents_distincts() -> None:
    cible = new_id()

    def avec(valeur: Any) -> bytes:
        document = with_components(visual(cible, threshold={"value": valeur, "label": "s"}))
        return dumps(document)

    # `true` n'est pas un nombre pour le schéma : seuls 1 et 1.0 sont comparables
    assert avec(1) != avec(1.0)
    with pytest.raises(ContentError):
        avec(True)


def test_un_texte_multiligne_est_ecrit_en_bloc_litteral() -> None:
    document = dashboard(description="a\nb")
    assert b"description: |-\n  a\n  b\n" in dumps(document)
    assert loads(dumps(document))["description"] == "a\nb"


def test_dumps_refuse_ce_qu_il_ne_sait_pas_relire(monkeypatch: pytest.MonkeyPatch) -> None:
    reel = module.loads

    def altere(raw: bytes) -> dict[str, Any]:
        autre = reel(raw)
        autre["name"] = "autre"
        return autre

    monkeypatch.setattr(module, "loads", altere)
    with pytest.raises(ContentError) as erreur:
        dumps(dashboard())
    assert (erreur.value.code, erreur.value.reason) == ("invalid_dashboard", "not_representable")


@pytest.mark.parametrize(
    ("brut_", "raison"),
    [
        (b"\xff\xfe", "unreadable_document"),
        (b"a: [", "unreadable_document"),
        (b"a: &x 1\nb: *x\n", "unreadable_document"),
        (b"a: 1\na: 2\n", "unreadable_document"),
        (b"{" * 10_000, "unreadable_document"),
        (b"- 1\n- 2\n", "wrong_type"),
        (b"", "wrong_type"),
    ],
)
def test_un_texte_illisible_est_refuse(brut_: bytes, raison: str) -> None:
    with pytest.raises(ContentError) as erreur:
        loads(brut_)
    assert (erreur.value.code, erreur.value.reason) == ("invalid_dashboard", raison)


def test_une_date_yaml_est_refusee() -> None:
    texte = dumps(dashboard()).decode().replace("description: Suivi.", "description: 2026-11-06")
    with pytest.raises(ContentError) as erreur:
        loads(texte.encode())
    assert [(v.path, v.rule) for v in erreur.value.violations] == [
        ("/description", "unsupported_value")
    ]


# -- en-tête de coup d'oeil ----------------------------------------------------------------------


def test_l_en_tete_donne_l_emetteur_le_sujet_la_visibilite_et_l_identifiant() -> None:
    document = dashboard(visibility="shared")
    assert brief(dumps(document)) == (
        document["owner"]["issuer"],
        document["owner"]["subject"],
        "shared",
        document["id"],
    )


def test_l_en_tete_se_termine_avant_les_defauts_les_filtres_et_la_mise_en_page() -> None:
    octets = dumps(lu("complete-shared.yaml"))
    avant = octets[: octets.index(b"\ndefaults:")]
    assert avant.count(b"\n") <= 12
    # la suite peut être n'importe quoi : seul l'en-tête est lu
    assert (
        brief(avant + b"\ndefaults: [[[ pas du yaml\n" + b"\x00" * 10)[3]
        == lu("complete-shared.yaml")["id"]
    )


def test_une_description_ne_peut_pas_forger_la_fin_de_l_en_tete() -> None:
    piege = "a\ndefaults:\nvisibility: shared"
    document = dashboard(description=piege)
    assert brief(dumps(document))[2] == "personal"


def test_un_en_tete_abime_est_un_document_illisible() -> None:
    valide = dumps(dashboard())
    for abime in (
        valide.replace(b"\ndefaults:", b"\nautre:"),
        valide.replace(b"owner:\n", b"owner: x\n").replace(b"  issuer:", b"issuer:"),
        valide.replace(b"visibility: personal", b"visibility: public"),
        valide.replace(b"name: Pilotage\n", b""),
        valide.replace(b"issuer: ", b"autre: "),
        valide.replace(b"api_version: board.dashboard/v1\n", b"- ["),
        b"\xff" + valide,
        b"x" * (32 * 1024 + 20) + b"\ndefaults:\n",
        b"- 1\ndefaults:\n",
        valide.replace(b"subject: user-0001", b"subject: 12"),
    ):
        with pytest.raises(ContentError) as erreur:
            brief(abime)
        assert (erreur.value.code, erreur.value.reason) == (
            "invalid_dashboard",
            "unreadable_document",
        )


def test_le_travail_du_coup_d_oeil_ne_depend_pas_de_la_taille_du_document() -> None:
    petit = dumps(dashboard())
    gros = dumps(flat(composants(40)))
    assert len(gros) > 10 * len(petit)
    assert brief(petit)[:3] == brief(gros)[:3]
