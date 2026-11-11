"""Index des dashboards et de leurs références en base (plan 19.2, B5)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from skifer_board.content import ContentRepository
from skifer_board.content.index import (
    INDEXED,
    AnalysisIndex,
    DashboardIndex,
    DashboardRow,
    Reference,
)
from skifer_board.content.repository import DASHBOARD_KIND
from skifer_board.spaces.model import PersonRef
from skifer_board.state.schema import analysis_index, dashboard_index, dashboard_references
from sqlalchemy import Connection, Engine, func, select
from sqlalchemy.exc import IntegrityError

from .monde import ACTOR, OTHER, init, new_id, repository
from .monde_dashboard import (
    column,
    container,
    dashboard,
    kpi,
    row,
    section,
    separator,
    text,
    visual,
    with_components,
)
from .test_index import INSTANT, ligne

HORLOGE = INSTANT + timedelta(minutes=1)


def refs(*couples: tuple[str, str, int]) -> tuple[Reference, ...]:
    return tuple(Reference(*couple) for couple in couples)


def tableau(
    space: str = "finance",
    ident: str | None = None,
    references: tuple[Reference, ...] = (),
    **changes: object,
) -> DashboardRow:
    valeurs: dict[str, object] = {
        "space_id": space,
        "dashboard_id": ident or new_id(),
        "name": "Pilotage",
        "owner": ACTOR,
        "visibility": "shared",
        "revision": 1,
        "commit": "a" * 40,
        "committed_at": INSTANT,
        "references": references,
    }
    valeurs.update(changes)
    return DashboardRow(**valeurs)  # type: ignore[arg-type]


def sans_references(item: DashboardRow) -> DashboardRow:
    return DashboardRow(
        item.space_id,
        item.dashboard_id,
        item.name,
        item.owner,
        item.visibility,
        item.revision,
        item.commit,
        item.committed_at,
        (),
        item.state,
    )


@pytest.fixture
def index(migre: Engine) -> DashboardIndex:
    return DashboardIndex(migre, lambda: HORLOGE)


@pytest.fixture
def depot(tmp_path: Path) -> ContentRepository:
    return repository(init(tmp_path / "contenus"), clock=lambda: INSTANT)


def compte(migre: Engine, table: object) -> int:
    with migre.connect() as connexion:
        return connexion.execute(select(func.count()).select_from(table)).scalar_one()  # type: ignore[arg-type]


# -- DashboardRow.of ---------------------------------------------------------------------------


def test_une_ligne_vient_d_une_revision_lue_dans_git(depot: ContentRepository) -> None:
    ident = new_id()
    autre, tiers = new_id(), new_id()
    c1, c2, c3, c4 = new_id(), new_id(), new_id(), new_id()
    contenu = dashboard(
        ident,
        name="Ventes",
        visibility="shared",
        layout={
            "sections": [
                section(
                    row(
                        column(text(), visual(c1, autre, 2, chart="bars"), span=6),
                        column(kpi(c2, tiers, 1), separator(), span=6),
                    )
                ),
                section(
                    row(
                        column(container(row(column(visual(c3, autre, 3)))), span=6),
                        column(visual(c4, tiers), span=6),
                    )
                ),
            ]
        },
    )
    stored = depot.write(
        "finance", ident, contenu, expected_revision=None, actor=ACTOR, kind=DASHBOARD_KIND
    )
    lue = DashboardRow.of("finance", stored)
    assert lue == DashboardRow(
        "finance",
        ident,
        "Ventes",
        ACTOR,
        "shared",
        1,
        stored.revision.commit,
        stored.revision.committed_at,
        (
            Reference(c1, autre, 2),
            Reference(c2, tiers, 1),
            Reference(c3, autre, 3),
            Reference(c4, tiers, 1),
        ),
    )
    assert lue.state == INDEXED


def test_un_dashboard_sans_composant_executable_n_a_pas_de_reference(
    depot: ContentRepository,
) -> None:
    ident = new_id()
    stored = depot.write(
        "finance",
        ident,
        with_components(text(), separator(), id=None)
        if False
        else with_components(text(), dashboard_id=None)
        if False
        else dashboard(ident, layout={"sections": [section(row(column(text(), separator())))]}),
        expected_revision=None,
        actor=OTHER,
        kind=DASHBOARD_KIND,
    )
    lue = DashboardRow.of("rh", stored)
    assert (lue.space_id, lue.owner, lue.visibility, lue.references) == (
        "rh",
        ACTOR,
        "personal",
        (),
    )


# -- upsert, get, rows -------------------------------------------------------------------------


def test_ecrire_puis_relire_une_ligne_et_ses_references(index: DashboardIndex) -> None:
    attendue = tableau(references=refs(("c2", "a2", 4), ("c1", "a1", 1)))
    assert index.get("finance", attendue.dashboard_id) is None
    index.upsert(attendue)
    relue = index.get("finance", attendue.dashboard_id)
    assert relue is not None and relue.state == INDEXED
    # Les références sont relues dans l'ordre des composants.
    assert relue == tableau(
        ident=attendue.dashboard_id, references=refs(("c1", "a1", 1), ("c2", "a2", 4))
    )
    assert relue.committed_at == INSTANT and relue.owner == ACTOR


def test_un_etat_autre_qu_indexe_est_garde(index: DashboardIndex) -> None:
    attendue = tableau(state="index_stale")
    index.upsert(attendue)
    relue = index.get("finance", attendue.dashboard_id)
    assert relue is not None and relue.state == "index_stale"


def test_un_dashboard_sans_reference_s_ecrit(index: DashboardIndex, migre: Engine) -> None:
    attendue = tableau()
    index.upsert(attendue)
    assert index.get("finance", attendue.dashboard_id) == attendue
    assert compte(migre, dashboard_references) == 0


def test_une_revision_superieure_remplace_la_ligne_et_les_references(
    index: DashboardIndex, migre: Engine
) -> None:
    premiere = tableau(references=refs(("c1", "a1", 1), ("c2", "a2", 1)))
    index.upsert(premiere)
    deuxieme = tableau(
        ident=premiere.dashboard_id,
        revision=2,
        commit="b" * 40,
        name="Renommé",
        owner=OTHER,
        visibility="personal",
        references=refs(("c2", "a3", 2), ("c3", "a1", 1)),
    )
    index.upsert(deuxieme)
    assert index.get("finance", premiere.dashboard_id) == deuxieme
    assert compte(migre, dashboard_references) == 2


def test_une_revision_sans_composant_vide_les_references(
    index: DashboardIndex, migre: Engine
) -> None:
    premiere = tableau(references=refs(("c1", "a1", 1)))
    index.upsert(premiere)
    vide = tableau(ident=premiere.dashboard_id, revision=2, commit="b" * 40)
    index.upsert(vide)
    assert index.get("finance", premiere.dashboard_id) == vide
    assert compte(migre, dashboard_references) == 0


def test_une_ecriture_en_retard_ne_ramene_pas_l_index_en_arriere(
    index: DashboardIndex,
) -> None:
    recente = tableau(revision=3, commit="c" * 40, references=refs(("c1", "a1", 3)))
    index.upsert(recente)
    ancienne = tableau(
        ident=recente.dashboard_id,
        revision=2,
        commit="b" * 40,
        name="Ancien",
        references=refs(("c9", "a9", 1), ("c8", "a8", 1)),
    )
    index.upsert(ancienne)
    # Ni la ligne ni les références de la révision ancienne n'ont été écrites.
    assert index.get("finance", recente.dashboard_id) == recente


def test_une_revision_egale_rejoue_la_ligne_et_remplace_les_references(
    index: DashboardIndex,
) -> None:
    premiere = tableau(revision=3, commit="c" * 40, references=refs(("c1", "a1", 1)))
    index.upsert(premiere)
    rejeu = tableau(
        ident=premiere.dashboard_id,
        revision=3,
        commit="d" * 40,
        references=refs(("c2", "a2", 2)),
    )
    index.upsert(rejeu)
    assert index.get("finance", premiere.dashboard_id) == rejeu


def test_un_composant_a_la_meme_analyse_deux_fois_dans_un_dashboard(
    index: DashboardIndex,
) -> None:
    attendue = tableau(references=refs(("c1", "a1", 1), ("c2", "a1", 2)))
    index.upsert(attendue)
    assert index.get("finance", attendue.dashboard_id) == attendue


def test_deux_composants_de_meme_identifiant_echouent_sans_rien_ecrire(
    index: DashboardIndex,
) -> None:
    gardee = tableau(references=refs(("c1", "a1", 1)))
    index.upsert(gardee)
    doublon = tableau(
        ident=gardee.dashboard_id,
        revision=2,
        references=refs(("c1", "a1", 1), ("c1", "a2", 1)),
    )
    with pytest.raises(IntegrityError):
        index.upsert(doublon)
    # La transaction entière est annulée : la ligne reste celle de la révision 1.
    assert index.get("finance", gardee.dashboard_id) == gardee


def test_get_ne_voit_que_l_espace_demande(index: DashboardIndex) -> None:
    attendue = tableau(references=refs(("c1", "a1", 1)))
    index.upsert(attendue)
    assert index.get("rh", attendue.dashboard_id) is None


def test_les_lignes_sont_par_espace_triees_et_sans_references(index: DashboardIndex) -> None:
    a, b = sorted(
        [tableau(references=refs(("c1", "a1", 1))), tableau(references=refs(("c1", "a2", 1)))],
        key=lambda item: item.dashboard_id,
    )
    index.upsert(b)
    index.upsert(a)
    index.upsert(tableau("rh", owner=OTHER))
    assert index.rows("finance") == [sans_references(a), sans_references(b)]
    assert all(item.references == () for item in index.rows("finance"))
    assert [item.space_id for item in index.rows("rh")] == ["rh"]
    assert index.rows("vide") == []
    # Même identifiant de dashboard, autre espace : une autre ligne.
    index.upsert(tableau("rh", a.dashboard_id))
    assert index.get("rh", a.dashboard_id) is not None and index.get("finance", a.dashboard_id) == a


def test_l_instant_d_indexation_vient_de_l_horloge(index: DashboardIndex, migre: Engine) -> None:
    index.upsert(tableau())
    with migre.connect() as connexion:
        trouve = connexion.execute(select(dashboard_index.c.indexed_at)).scalar_one()
    assert trouve == HORLOGE


def test_l_horloge_par_defaut_est_utc(migre: Engine) -> None:
    avant = datetime.now(UTC)
    base = DashboardIndex(migre)
    base.upsert(tableau())
    with migre.connect() as connexion:
        trouve = connexion.execute(select(dashboard_index.c.indexed_at)).scalar_one()
    assert avant <= trouve <= datetime.now(UTC)


def test_les_instants_sont_relus_en_utc_quel_que_soit_le_fuseau_de_la_base(
    moteur_hors_utc: Engine,
) -> None:
    base = DashboardIndex(moteur_hors_utc, lambda: INSTANT)
    attendue = tableau(references=refs(("c1", "a1", 1)))
    base.upsert(attendue)
    relue = base.get("finance", attendue.dashboard_id)
    assert relue is not None and relue.committed_at.utcoffset() == timedelta(0)
    assert relue.committed_at.isoformat() == "2026-11-05T12:00:00+00:00"
    assert base.rows("finance")[0].committed_at.utcoffset() == timedelta(0)
    assert base.consumers("finance", "a1")[0].committed_at.utcoffset() == timedelta(0)


def test_l_index_ne_porte_ni_mise_en_page_ni_filtre_ni_requete() -> None:
    colonnes = {c.name for c in dashboard_index.columns} | {
        c.name for c in dashboard_references.columns
    }
    assert colonnes.isdisjoint(
        {"layout", "filters", "defaults", "query", "sql", "text", "blocks", "value"}
    )


# -- remove ------------------------------------------------------------------------------------


def test_retirer_un_dashboard_retire_ses_references_en_cascade(
    index: DashboardIndex, migre: Engine
) -> None:
    gardee = tableau(references=refs(("c1", "a1", 1)))
    retiree = tableau(revision=2, references=refs(("c1", "a1", 1), ("c2", "a2", 1)))
    index.upsert(gardee)
    index.upsert(retiree)
    assert compte(migre, dashboard_references) == 3
    index.remove("finance", retiree.dashboard_id, 2)
    assert index.get("finance", retiree.dashboard_id) is None
    assert index.rows("finance") == [sans_references(gardee)]
    assert compte(migre, dashboard_references) == 1
    # Rejouer le retrait est sans effet.
    index.remove("finance", retiree.dashboard_id, 2)
    assert index.get("finance", gardee.dashboard_id) == gardee


def test_retirer_ne_touche_pas_une_ligne_plus_recente(index: DashboardIndex) -> None:
    recente = tableau(revision=4, references=refs(("c1", "a1", 1)))
    index.upsert(recente)
    index.remove("finance", recente.dashboard_id, 3)
    assert index.get("finance", recente.dashboard_id) == recente


def test_retirer_ne_touche_pas_un_autre_espace(index: DashboardIndex) -> None:
    ici, la = tableau(), tableau("rh", owner=OTHER)
    index.upsert(ici)
    index.upsert(la)
    index.remove("rh", ici.dashboard_id, 9)
    assert index.get("finance", ici.dashboard_id) == ici
    assert index.get("rh", la.dashboard_id) == la


# -- consumers ---------------------------------------------------------------------------------


def test_les_consommateurs_d_une_analyse(index: DashboardIndex) -> None:
    a, b, c = sorted([new_id(), new_id(), new_id()])
    # Insérés dans le désordre : le résultat est trié par identifiant de dashboard.
    index.upsert(tableau(ident=c, references=refs(("c1", "cible", 1))))
    index.upsert(tableau(ident=a, references=refs(("c1", "cible", 7))))
    index.upsert(tableau(ident=b, references=refs(("c1", "autre", 1))))
    trouves = index.consumers("finance", "cible")
    assert [item.dashboard_id for item in trouves] == [a, c]
    assert all(item.references == () for item in trouves)
    assert trouves[0].owner == ACTOR and trouves[0].revision == 1
    assert index.consumers("finance", "inconnue") == []


def test_un_dashboard_qui_epingle_deux_fois_l_analyse_n_est_rendu_qu_une_fois(
    index: DashboardIndex,
) -> None:
    ident = new_id()
    index.upsert(tableau(ident=ident, references=refs(("c1", "cible", 1), ("c2", "cible", 2))))
    assert [item.dashboard_id for item in index.consumers("finance", "cible")] == [ident]


def test_les_consommateurs_sont_ceux_de_l_espace_demande(index: DashboardIndex) -> None:
    ident = new_id()
    index.upsert(tableau("finance", ident, references=refs(("c1", "cible", 1))))
    index.upsert(tableau("rh", new_id(), owner=OTHER, references=refs(("c1", "cible", 1))))
    assert [item.space_id for item in index.consumers("finance", "cible")] == ["finance"]
    assert [item.space_id for item in index.consumers("rh", "cible")] == ["rh"]
    assert index.consumers("autre", "cible") == []


def test_seule_la_revision_courante_d_un_dashboard_compte(index: DashboardIndex) -> None:
    ident = new_id()
    index.upsert(tableau(ident=ident, references=refs(("c1", "cible", 1))))
    index.upsert(tableau(ident=ident, revision=2, references=refs(("c1", "autre", 1))))
    assert index.consumers("finance", "cible") == []
    assert [item.dashboard_id for item in index.consumers("finance", "autre")] == [ident]


def test_les_consommateurs_suivent_la_suppression_d_un_dashboard(index: DashboardIndex) -> None:
    ident = new_id()
    index.upsert(tableau(ident=ident, references=refs(("c1", "cible", 1))))
    index.remove("finance", ident, 1)
    assert index.consumers("finance", "cible") == []


# -- replace_in et AnalysisIndex.replace(inside=) ---------------------------------------------


def remplacer(
    migre: Engine,
    analyses: list[object],
    boards: list[DashboardRow],
    horloge: datetime = HORLOGE,
) -> int:
    base = DashboardIndex(migre, lambda: horloge)
    return AnalysisIndex(migre, lambda: horloge).replace(
        analyses,  # type: ignore[arg-type]
        inside=lambda connexion: base.replace_in(connexion, boards),
    )


def test_remplacer_tous_les_dashboards_et_leurs_references(
    index: DashboardIndex, migre: Engine
) -> None:
    ancienne = tableau(references=refs(("c1", "a1", 1)))
    index.upsert(ancienne)
    nouveaux = [
        tableau(references=refs(("c1", "a1", 1), ("c2", "a2", 2))),
        tableau("rh", owner=OTHER),
        tableau(references=refs(("c1", "a2", 1))),
    ]
    assert remplacer(migre, [], nouveaux) == 0
    assert index.get("finance", ancienne.dashboard_id) is None
    for attendu in nouveaux:
        assert index.get(attendu.space_id, attendu.dashboard_id) == attendu
    assert compte(migre, dashboard_index) == 3
    assert compte(migre, dashboard_references) == 3
    with migre.connect() as connexion:
        instants = connexion.execute(select(dashboard_index.c.indexed_at)).scalars().all()
    assert set(instants) == {HORLOGE}


def test_remplacer_par_rien_vide_les_deux_tables(index: DashboardIndex, migre: Engine) -> None:
    index.upsert(tableau(references=refs(("c1", "a1", 1))))
    remplacer(migre, [], [])
    assert compte(migre, dashboard_index) == 0
    assert compte(migre, dashboard_references) == 0


def test_remplacer_sans_aucune_reference_vide_les_anciennes(
    index: DashboardIndex, migre: Engine
) -> None:
    index.upsert(tableau(references=refs(("c1", "a1", 1))))
    nouveau = tableau()
    remplacer(migre, [], [nouveau])
    assert index.rows("finance") == [nouveau]
    assert compte(migre, dashboard_references) == 0


def test_remplacer_prend_l_horloge_de_l_index_des_dashboards(migre: Engine) -> None:
    base = DashboardIndex(migre, lambda: HORLOGE)
    AnalysisIndex(migre, lambda: INSTANT).replace(
        [], inside=lambda connexion: base.replace_in(connexion, [tableau()])
    )
    with migre.connect() as connexion:
        trouve = connexion.execute(select(dashboard_index.c.indexed_at)).scalar_one()
    assert trouve == HORLOGE


def test_l_horloge_par_defaut_de_replace_in_est_utc(migre: Engine) -> None:
    avant = datetime.now(UTC)
    base = DashboardIndex(migre)
    AnalysisIndex(migre).replace([], inside=lambda c: base.replace_in(c, [tableau()]))
    with migre.connect() as connexion:
        trouve = connexion.execute(select(dashboard_index.c.indexed_at)).scalar_one()
    assert avant <= trouve <= datetime.now(UTC)


def test_remplacer_n_attend_qu_un_iterable(index: DashboardIndex, migre: Engine) -> None:
    attendu = tableau(references=refs(("c1", "a1", 1)))
    base = DashboardIndex(migre, lambda: HORLOGE)
    AnalysisIndex(migre, lambda: HORLOGE).replace(
        [], inside=lambda c: base.replace_in(c, iter([attendu]))
    )
    assert index.get("finance", attendu.dashboard_id) == attendu


def test_le_crochet_s_execute_dans_la_transaction_des_analyses(migre: Engine) -> None:
    vues: list[int] = []

    ordre: list[str] = []

    def inside(connexion: Connection) -> None:
        # La connexion donnée voit déjà les analyses du remplacement, pas encore validées.
        ordre.append("dedans")
        vues.append(
            connexion.execute(select(func.count()).select_from(analysis_index)).scalar_one()
        )

    nouvelle = ligne()
    AnalysisIndex(migre, lambda: HORLOGE).replace(
        [nouvelle],
        before_commit=lambda: ordre.append("avant_commit"),
        inside=inside,
    )
    assert vues == [1]
    assert ordre == ["dedans", "avant_commit"]
    # Hors de la transaction, rien n'était visible avant le commit.
    assert AnalysisIndex(migre).get("finance", nouvelle.analysis_id) == nouvelle


def test_sans_crochet_les_dashboards_ne_sont_pas_touches(
    index: DashboardIndex, migre: Engine
) -> None:
    gardee = tableau(references=refs(("c1", "a1", 1)))
    index.upsert(gardee)
    AnalysisIndex(migre, lambda: HORLOGE).replace([ligne()])
    assert index.get("finance", gardee.dashboard_id) == gardee


def test_un_crochet_qui_echoue_n_ecrit_rien_des_analyses(
    index: DashboardIndex, migre: Engine
) -> None:
    analyses = AnalysisIndex(migre, lambda: HORLOGE)
    analyse_gardee = ligne()
    analyses.upsert(analyse_gardee)
    dashboard_garde = tableau(references=refs(("c1", "a1", 1)))
    index.upsert(dashboard_garde)

    def echoue(connexion: Connection) -> None:
        index.replace_in(connexion, [tableau("rh", owner=OTHER)])
        raise RuntimeError

    with pytest.raises(RuntimeError):
        analyses.replace([ligne("rh", owner=OTHER)], inside=echoue)
    assert analyses.rows("finance") == [analyse_gardee]
    assert analyses.rows("rh") == []
    assert index.rows("finance") == [sans_references(dashboard_garde)]
    assert index.rows("rh") == []
    assert compte(migre, dashboard_references) == 1


def test_un_dashboard_en_defaut_n_ecrit_rien_des_analyses(
    index: DashboardIndex, migre: Engine
) -> None:
    analyses = AnalysisIndex(migre, lambda: HORLOGE)
    analyse_gardee = ligne()
    analyses.upsert(analyse_gardee)
    dashboard_garde = tableau()
    index.upsert(dashboard_garde)
    doublon = tableau()
    with pytest.raises(IntegrityError):
        remplacer(migre, [ligne("rh", owner=OTHER)], [doublon, doublon])
    assert analyses.rows("finance") == [analyse_gardee]
    assert analyses.rows("rh") == []
    assert index.rows("finance") == [dashboard_garde]


def test_un_echec_avant_commit_n_ecrit_rien_des_dashboards(
    index: DashboardIndex, migre: Engine
) -> None:
    analyses = AnalysisIndex(migre, lambda: HORLOGE)
    gardee = tableau(references=refs(("c1", "a1", 1)))
    index.upsert(gardee)

    def refuse() -> None:
        raise RuntimeError

    with pytest.raises(RuntimeError):
        analyses.replace(
            [ligne()],
            refuse,
            lambda c: index.replace_in(c, [tableau("rh", owner=OTHER)]),
        )
    assert analyses.rows("finance") == []
    assert index.get("finance", gardee.dashboard_id) == gardee
    assert index.rows("rh") == []


def test_les_deux_index_sont_independants_pour_un_meme_identifiant(
    index: DashboardIndex, migre: Engine
) -> None:
    ident = new_id()
    analyses = AnalysisIndex(migre, lambda: HORLOGE)
    analyses.upsert(ligne(ident=ident))
    index.upsert(tableau(ident=ident, name="Tableau"))
    assert analyses.get("finance", ident) is not None
    got = index.get("finance", ident)
    assert got is not None and got.name == "Tableau"
    index.remove("finance", ident, 1)
    assert analyses.get("finance", ident) is not None


def test_reference_et_ligne_se_comparent_par_valeur() -> None:
    assert Reference("c", "a", 1) == Reference("c", "a", 1)
    assert Reference("c", "a", 1) != Reference("c", "a", 2)
    assert tableau(ident="d").owner == PersonRef(ACTOR.issuer, ACTOR.subject)
