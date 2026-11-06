"""Diff structurel des dashboards : par identifiant de noeud, avec déplacements (plan 19.1, B2)."""

from __future__ import annotations

import copy
from collections.abc import Callable
from typing import Any

import pytest
from skifer_board.content import dashboard as module
from skifer_board.content.analysis import Change
from skifer_board.content.dashboard import diff, validate

from .monde_dashboard import (
    column,
    common_filter,
    container,
    dashboard,
    kpi,
    new_id,
    row,
    section,
    segment,
    separator,
    text,
    visual,
)

# Identifiants fixes : le diff se lit par identifiant, les tests aussi.
S1, S2, R1, R2, R3 = (new_id() for _ in range(5))
C1, C2, C3, C4, X = (new_id() for _ in range(5))
V1, K1, T1, P1, F1, F2 = (new_id() for _ in range(6))
A_V1, A_K1 = new_id(), new_id()


def avant() -> dict[str, Any]:
    return dashboard(
        "6c1f3a0e-3a7b-4b57-9c0e-1d8e3a9d0b11",
        filters=[
            {**common_filter([V1]), "id": F1},
            {**common_filter([K1]), "id": F2},
        ],
        layout={
            "sections": [
                section(
                    row(
                        column(visual(V1, A_V1, revision=2, chart="bars"), span=4, ident=C1),
                        column(kpi(K1, A_K1), text(ident=T1), span=4, ident=C2),
                        ident=R1,
                    ),
                    title="Ventes",
                    ident=S1,
                ),
                section(
                    row(
                        column(
                            container(row(column(separator(P1), ident=C4), ident=R3), ident=X),
                            ident=C3,
                        ),
                        ident=R2,
                    ),
                    ident=S2,
                ),
            ]
        },
    )


def apres(modifier: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
    document = avant()
    modifier(document)
    return validate(document)


def ecarts(modifier: Callable[[dict[str, Any]], None]) -> tuple[Change, ...]:
    return diff(validate(avant()), apres(modifier))


def lire(document: dict[str, Any], *chemin: Any) -> Any:
    for part in chemin:
        document = document[part]
    return document


def colonnes(document: dict[str, Any], section_: int = 0) -> list[dict[str, Any]]:
    colonnes_: list[dict[str, Any]] = document["layout"]["sections"][section_]["rows"][0]["columns"]
    return colonnes_


def sections(document: dict[str, Any]) -> list[dict[str, Any]]:
    sections_: list[dict[str, Any]] = document["layout"]["sections"]
    return sections_


def resume(changes: tuple[Change, ...]) -> list[tuple[str | None, str, str | None]]:
    return [(c.node, c.kind, c.id) for c in changes]


# -- identité --------------------------------------------------------------------------------


def test_deux_documents_identiques_n_ont_aucun_ecart() -> None:
    assert diff(validate(avant()), validate(avant())) == ()


def test_un_ecart_de_dashboard_a_les_champs_d_un_ecart_d_analyse_sans_noeud() -> None:
    assert Change("/name", "modified", "a", "b") == Change(
        "/name", "modified", "a", "b", None, None
    )
    assert Change("/name", "modified", "a", "b").node is None


# -- en-tête et défauts ------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("champ", "valeur"),
    [("name", "Autre"), ("description", "Autre."), ("visibility", "shared")],
)
def test_l_en_tete_se_compare_champ_par_champ(champ: str, valeur: str) -> None:
    ancien = avant()[champ]
    assert ecarts(lambda d: d.update({champ: valeur})) == (
        Change(f"/{champ}", "modified", ancien, valeur, "dashboard", None),
    )


def test_le_proprietaire_se_compare_par_sous_champ() -> None:
    assert ecarts(lambda d: d["owner"].update({"subject": "user-0002"})) == (
        Change("/owner/subject", "modified", "user-0001", "user-0002", "dashboard", None),
    )


def test_l_identifiant_du_dashboard_n_est_pas_compare() -> None:
    assert ecarts(lambda d: d.update({"id": new_id()})) == ()


def test_les_defauts_sont_ajoutes_modifies_et_retires() -> None:
    ajoute = ecarts(lambda d: d["defaults"].update({"legend": "hidden"}))
    assert ajoute == (Change("/defaults/legend", "added", None, "hidden", "defaults", None),)
    base = avant()
    base["defaults"] = {"legend": "shown", "tooltip": "value"}
    ancien = validate(base)
    modifie = {**base, "defaults": {"legend": "hidden", "tooltip": "value"}}
    assert diff(ancien, validate(modifie)) == (
        Change("/defaults/legend", "modified", "shown", "hidden", "defaults", None),
    )
    retire = {**base, "defaults": {"tooltip": "value"}}
    assert diff(ancien, validate(retire)) == (
        Change("/defaults/legend", "removed", "shown", None, "defaults", None),
    )


def test_les_ecarts_d_en_tete_precedent_les_defauts_puis_les_noeuds() -> None:
    def modifier(d: dict[str, Any]) -> None:
        colonnes(d)[0]["span"] = 6
        d["defaults"]["legend"] = "hidden"
        d["name"] = "Autre"

    assert resume(ecarts(modifier)) == [
        ("dashboard", "modified", None),
        ("defaults", "added", None),
        ("column", "modified", C1),
    ]


# -- ajout, retrait et modification par type de noeud -------------------------------------------


def test_modifier_la_largeur_d_une_colonne_ne_rend_que_le_champ_modifie() -> None:
    assert ecarts(lambda d: colonnes(d)[0].update({"span": 5})) == (
        Change(
            "/layout/sections/0/rows/0/columns/0",
            "modified",
            {"span": 4},
            {"span": 5},
            "column",
            C1,
        ),
    )


def test_le_titre_d_une_section_est_ajoute_modifie_et_retire() -> None:
    assert ecarts(lambda d: sections(d)[0].update({"title": "Autre"})) == (
        Change(
            "/layout/sections/0", "modified", {"title": "Ventes"}, {"title": "Autre"}, "section", S1
        ),
    )
    assert ecarts(lambda d: sections(d)[0].pop("title")) == (
        Change("/layout/sections/0", "modified", {"title": "Ventes"}, {}, "section", S1),
    )
    assert ecarts(lambda d: sections(d)[1].update({"title": "Détail"})) == (
        Change("/layout/sections/1", "modified", {}, {"title": "Détail"}, "section", S2),
    )


def test_une_presentation_modifiee_est_rendue_en_entier_sous_son_champ() -> None:
    def modifier(d: dict[str, Any]) -> None:
        colonnes(d)[0]["children"][0]["presentation"] = {"chart": "line", "legend": "hidden"}

    (ecart,) = ecarts(modifier)
    assert (ecart.node, ecart.kind, ecart.id) == ("analysis", "modified", V1)
    assert ecart.before == {"presentation": {"chart": "bars"}}
    assert ecart.after == {"presentation": {"chart": "line", "legend": "hidden"}}


def test_changer_la_revision_epinglee_est_une_modification_de_la_reference() -> None:
    def modifier(d: dict[str, Any]) -> None:
        colonnes(d)[0]["children"][0]["reference"]["revision"] = 3

    (ecart,) = ecarts(modifier)
    assert ecart.before["reference"]["revision"] == 2
    assert ecart.after["reference"]["revision"] == 3
    assert (ecart.node, ecart.id, ecart.path) == (
        "analysis",
        V1,
        "/layout/sections/0/rows/0/columns/0/children/0",
    )


def test_modifier_un_kpi_un_texte_ou_un_filtre() -> None:
    def kpi_(d: dict[str, Any]) -> None:
        colonnes(d)[1]["children"][0]["presentation"]["title"] = "CA"

    def texte(d: dict[str, Any]) -> None:
        colonnes(d)[1]["children"][1]["blocks"] = [
            {"type": "paragraph", "content": [segment("autre")]}
        ]

    def filtre(d: dict[str, Any]) -> None:
        d["filters"][0].update({"label": "Zone", "default": "Nord"})

    assert resume(ecarts(kpi_)) == [("kpi", "modified", K1)]
    (ecart,) = ecarts(texte)
    assert (ecart.node, ecart.kind, ecart.id) == ("text", "modified", T1)
    assert set(ecart.before) == set(ecart.after) == {"blocks"}
    (ecart,) = ecarts(filtre)
    assert (ecart.node, ecart.kind, ecart.id, ecart.path) == (
        "filter",
        "modified",
        F1,
        "/filters/0",
    )
    assert ecart.before == {"label": "Région"}
    assert ecart.after == {"label": "Zone", "default": "Nord"}


def test_ajouter_et_retirer_un_composant() -> None:
    nouveau = separator()
    ajout = ecarts(lambda d: colonnes(d)[0]["children"].append(nouveau))
    assert ajout == (
        Change(
            "/layout/sections/0/rows/0/columns/0/children/1",
            "added",
            None,
            {"type": "separator"},
            "separator",
            nouveau["id"],
        ),
    )
    retrait = ecarts(lambda d: colonnes(d)[1]["children"].pop(1))
    assert retrait == (
        Change(
            "/layout/sections/0/rows/0/columns/1/children/1",
            "removed",
            {"type": "text", "blocks": [{"type": "paragraph", "content": [segment("x")]}]},
            None,
            "text",
            T1,
        ),
    )


def test_ajouter_et_retirer_une_colonne_une_rangee_un_conteneur_une_section() -> None:
    colonne, rangee, section_ = column(span=3), row(), section(title="Nouvelle")
    assert resume(ecarts(lambda d: colonnes(d).append(colonne))) == [
        ("column", "added", colonne["id"])
    ]
    assert resume(ecarts(lambda d: d["layout"]["sections"][0]["rows"].append(rangee))) == [
        ("row", "added", rangee["id"])
    ]
    assert resume(ecarts(lambda d: d["layout"]["sections"].append(section_))) == [
        ("section", "added", section_["id"])
    ]

    # retirer une cible oblige à retirer aussi le filtre qui la visait
    def retirer_c1(d: dict[str, Any]) -> None:
        colonnes(d).pop(0)
        d["filters"].pop(0)

    assert resume(ecarts(retirer_c1)) == [
        ("column", "removed", C1),
        ("analysis", "removed", V1),
        ("filter", "removed", F1),
    ]
    assert resume(ecarts(lambda d: colonnes(d, 1)[0]["children"][0]["rows"].clear())) == [
        ("row", "removed", R3),
        ("column", "removed", C4),
        ("separator", "removed", P1),
    ]
    assert resume(ecarts(lambda d: colonnes(d, 1)[0]["children"].clear())) == [
        ("container", "removed", X),
        ("row", "removed", R3),
        ("column", "removed", C4),
        ("separator", "removed", P1),
    ]
    assert resume(ecarts(lambda d: d["layout"]["sections"].pop(1))) == [
        ("section", "removed", S2),
        ("row", "removed", R2),
        ("column", "removed", C3),
        ("container", "removed", X),
        ("row", "removed", R3),
        ("column", "removed", C4),
        ("separator", "removed", P1),
    ]


def test_un_conteneur_ajoute_est_decrit_sans_ses_enfants() -> None:
    nouveau = container(row(column(separator())))
    rangee = row(column(nouveau, span=4))

    def modifier(d: dict[str, Any]) -> None:
        d["layout"]["sections"][0]["rows"].append(rangee)

    (ajout, colonne, conteneur, interieure, enfant, composant) = ecarts(modifier)
    assert (ajout.node, ajout.after) == ("row", {})
    assert (colonne.node, colonne.after) == ("column", {"span": 4})
    assert (conteneur.node, conteneur.kind, conteneur.after) == (
        "container",
        "added",
        {"type": "container"},
    )
    assert (interieure.node, enfant.node, composant.node) == ("row", "column", "separator")
    assert conteneur.path == "/layout/sections/0/rows/1/columns/0/children/0"
    assert composant.path.endswith("/children/0/rows/0/columns/0/children/0")


def test_un_filtre_ajoute_ou_retire() -> None:
    nouveau = {**common_filter([V1]), "label": "Canal"}
    assert resume(ecarts(lambda d: d["filters"].append(nouveau))) == [
        ("filter", "added", nouveau["id"])
    ]
    assert resume(ecarts(lambda d: d["filters"].pop(0))) == [("filter", "removed", F1)]
    (ecart,) = ecarts(lambda d: d["filters"].pop(0))
    assert ecart.path == "/filters/0"
    assert ecart.before["targets"] == [V1]
    assert ecart.after is None


def test_le_chemin_d_un_retrait_est_celui_de_l_ancien_document() -> None:
    (conteneur, *_) = ecarts(lambda d: colonnes(d, 1)[0]["children"].clear())
    assert conteneur.path == "/layout/sections/1/rows/0/columns/0/children/0"
    assert conteneur.after is None
    assert conteneur.before == {"type": "container"}


def test_l_ordre_du_rapport_suit_le_document_apres_puis_les_retraits() -> None:
    ajout = separator()

    def modifier(d: dict[str, Any]) -> None:
        d["layout"]["sections"][1]["rows"][0]["columns"][0]["children"].clear()
        colonnes(d)[1]["children"].append(ajout)
        colonnes(d)[0]["span"] = 5

    assert resume(ecarts(modifier)) == [
        ("column", "modified", C1),
        ("separator", "added", ajout["id"]),
        ("container", "removed", X),
        ("row", "removed", R3),
        ("column", "removed", C4),
        ("separator", "removed", P1),
    ]


# -- déplacements ------------------------------------------------------------------------------


def test_deplacer_un_composant_dans_une_autre_colonne_se_lit_comme_un_deplacement() -> None:
    def modifier(d: dict[str, Any]) -> None:
        composant = colonnes(d)[1]["children"].pop(0)
        colonnes(d)[0]["children"].append(composant)

    assert ecarts(modifier) == (
        Change(
            "/layout/sections/0/rows/0/columns/0/children/1",
            "moved",
            {"parent": C2, "index": 0},
            {"parent": C1, "index": 1},
            "kpi",
            K1,
        ),
    )


def test_deplacer_un_noeud_vers_un_autre_parent_emporte_son_sous_arbre_sans_bruit() -> None:
    vide = column(span=4)

    def modifier(d: dict[str, Any]) -> None:
        vide["children"].append(colonnes(d, 1)[0]["children"].pop(0))
        colonnes(d).append(vide)

    ecart = ecarts(modifier)
    assert resume(ecart) == [("column", "added", vide["id"]), ("container", "moved", X)]
    assert ecart[1].before == {"parent": C3, "index": 0}
    assert ecart[1].after == {"parent": vide["id"], "index": 0}


def test_echanger_deux_sections_deplace_l_une_des_deux() -> None:
    def modifier(d: dict[str, Any]) -> None:
        d["layout"]["sections"].reverse()

    (ecart,) = ecarts(modifier)
    assert (ecart.node, ecart.kind, ecart.id) == ("section", "moved", S1)
    assert ecart.before == {"parent": "layout", "index": 0}
    assert ecart.after == {"parent": "layout", "index": 1}
    assert ecart.path == "/layout/sections/1"


def test_une_rotation_ne_deplace_que_le_noeud_qui_a_saute() -> None:
    a, b, c = column(span=4), column(span=4), column(span=4)

    def avec(ordre: list[dict[str, Any]]) -> dict[str, Any]:
        document = avant()
        document["layout"]["sections"][1]["rows"][0]["columns"] = copy.deepcopy(ordre)
        return validate(document)

    ancien = avec([a, b, c])
    assert resume(diff(ancien, avec([b, c, a]))) == [("column", "moved", a["id"])]
    assert resume(diff(ancien, avec([c, a, b]))) == [("column", "moved", c["id"])]
    assert diff(ancien, avec([a, b, c])) == ()
    # une permutation sans suite croissante : deux déplacements au plus pour trois frères
    assert len(diff(ancien, avec([c, b, a]))) == 2


def test_inserer_ou_retirer_un_frere_ne_deplace_personne() -> None:
    nouvelle = section()
    avec_nouvelle = ecarts(lambda d: d["layout"]["sections"].insert(0, nouvelle))
    assert resume(avec_nouvelle) == [("section", "added", nouvelle["id"])]
    retiree = ecarts(lambda d: d["layout"]["sections"].pop(1))
    assert {kind for _, kind, _ in resume(retiree)} == {"removed"}
    assert S1 not in {ident for _, _, ident in resume(retiree)}


def test_reordonner_les_filtres_les_deplace_sous_leur_liste() -> None:
    (ecart,) = ecarts(lambda d: d["filters"].reverse())
    assert (ecart.node, ecart.kind, ecart.id) == ("filter", "moved", F1)
    assert ecart.before == {"parent": "filters", "index": 0}
    assert ecart.after == {"parent": "filters", "index": 1}


def test_un_noeud_deplace_et_modifie_donne_les_deux_entrees() -> None:
    def modifier(d: dict[str, Any]) -> None:
        composant = colonnes(d)[1]["children"].pop(0)
        composant["presentation"] = {"title": "CA"}
        colonnes(d)[0]["children"].append(composant)

    assert resume(ecarts(modifier)) == [("kpi", "moved", K1), ("kpi", "modified", K1)]


def test_un_noeud_deplace_dans_un_parent_ajoute_est_deplace_et_son_parent_ajoute() -> None:
    nouvelle = column(span=4)

    def modifier(d: dict[str, Any]) -> None:
        nouvelle["children"].append(colonnes(d)[1]["children"].pop(0))
        colonnes(d).append(nouvelle)

    assert resume(ecarts(modifier)) == [
        ("column", "added", nouvelle["id"]),
        ("kpi", "moved", K1),
    ]


# -- identité, type et strictesse -----------------------------------------------------------------


def test_un_identifiant_qui_change_de_type_de_noeud_est_un_retrait_et_un_ajout() -> None:
    def modifier(d: dict[str, Any]) -> None:
        colonnes(d)[1]["children"][0] = {**kpi(), "id": K1, "type": "analysis"}

    assert resume(ecarts(modifier)) == [("analysis", "added", K1), ("kpi", "removed", K1)]


def test_un_identifiant_de_filtre_repris_par_une_section_est_un_retrait_et_un_ajout() -> None:
    def modifier(d: dict[str, Any]) -> None:
        d["filters"].pop(0)
        d["layout"]["sections"].append(section(ident=F1))

    kinds = [(c.node, c.kind) for c in ecarts(modifier)]
    assert kinds == [("section", "added"), ("filter", "removed")]


def test_true_1_et_1_0_sont_des_valeurs_distinctes() -> None:
    def seuil(valeur: Any) -> Callable[[dict[str, Any]], None]:
        def modifier(d: dict[str, Any]) -> None:
            colonnes(d)[0]["children"][0]["presentation"]["threshold"] = {
                "value": valeur,
                "label": "s",
            }

        return modifier

    un, un_flottant = apres(seuil(1)), apres(seuil(1.0))
    (ecart,) = diff(un, un_flottant)
    assert (ecart.kind, ecart.before, ecart.after) == (
        "modified",
        {"presentation": {"chart": "bars", "threshold": {"value": 1, "label": "s"}}},
        {"presentation": {"chart": "bars", "threshold": {"value": 1.0, "label": "s"}}},
    )
    assert diff(un, apres(seuil(1))) == ()

    def valeur_par_defaut(valeur: Any) -> dict[str, Any]:
        document = avant()
        document["filters"][0].update({"operator": "eq", "default": valeur})
        return validate(document)

    assert len(diff(valeur_par_defaut(True), valeur_par_defaut(1))) == 1


def test_un_noeud_inchange_au_milieu_d_ecarts_n_apparait_pas() -> None:
    def modifier(d: dict[str, Any]) -> None:
        colonnes(d)[0]["span"] = 5
        colonnes(d)[1]["span"] = 7

    assert resume(ecarts(modifier)) == [("column", "modified", C1), ("column", "modified", C2)]


def test_un_champ_propre_inconnu_garde_la_fin_de_l_ordre_de_lecture() -> None:
    # le diff reste défini sur tout document validé : l'ordre des champs suit celui du format
    assert module._RANK["type"] < module._RANK["reference"] < module._RANK["presentation"]
    assert module._RANK["id"] < module._RANK["type"]
