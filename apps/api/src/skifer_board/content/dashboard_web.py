"""Routes des dashboards sous `/api/spaces/{space_id}/dashboards` (plan 19.2, B4 à B7).

Elles suivent le modèle des analyses (plan 18.2 et 18.3) : mêmes droits, même réponse pour un
dashboard invisible que pour un dashboard inexistant, même coup d'œil avant toute lecture du
contenu, même tête résolue une fois par requête, mêmes états de lecture, même réindexation, même
panne de base après une publication. Rien ne vient du navigateur que le corps validé : ni le
propriétaire, ni le rôle, ni l'identifiant. Le contenu servi vient toujours de git ; l'index ne
sert qu'à lister, à repérer un écart (`index_stale`) et à dire qui consomme une analyse.

À la sauvegarde, chaque analyse épinglée doit exister et être lisible par l'auteur (`find` des
analyses, règle par révision comprise) : sinon une violation unique `analysis_unavailable`, qui
ne distingue jamais une analyse invisible d'une inexistante. Un dashboard partagé ne peut épingler
que des révisions d'analyses partagées (`personal_reference`). À la lecture, la réponse donne
l'état de chaque composant exécutable pour la personne qui lit, sans rien recopier des analyses :
le web lit chaque révision par les routes des analyses.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable, Collection, Sequence
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

from ..execution.semantic import SemanticRefusal
from ..execution.store import ConnectionStore
from ..spaces.access import Access
from ..spaces.model import LocalMode, PersonRef, Role
from ..spaces.web import Invalid, Refused, _body, viewer
from . import dashboard as dashboard_format
from .dashboard import API_VERSION, Document, executables
from .dashboard_checks import Tile, personal_components, save_violations, tiles
from .errors import (
    CONTENT_UNAVAILABLE,
    DASHBOARD_NOT_FOUND,
    INVALID_DASHBOARD,
    REVISION_CONFLICT,
    ContentError,
    Violation,
)
from .index import INDEXED, DashboardIndex, DashboardRow
from .repository import DAMAGED_REASONS, DASHBOARD_KIND, ContentRepository, StoredRevision
from .web import (
    ANALYSIS_ID,
    LOGGER,
    NAME_MAX,
    READY,
    SERVER_FIELDS,
    STALE,
    UNRESOLVED,
    UNVERIFIED,
    Catalog,
    Consumer,
    Dependents,
    Located,
    _digits,
    _error,
    _expected,
    _person,
    _revision_json,
    _version,
    establish,
    find,
    owner_of,
    rights,
    visible,
    visible_to,
)

PERSONAL_REFERENCE = "personal_reference"
CONSUMER_KIND = "dashboard"


class PersonalReference(Exception):
    """Un dashboard partagé épingle des analyses qui ne le sont pas : les composants en cause."""

    def __init__(self, components: Sequence[str]) -> None:
        super().__init__(PERSONAL_REFERENCE)
        self.components = tuple(components)


def refuse(violations: Collection[Violation]) -> ContentError:
    """Refus `invalid_dashboard` : violations triées, première règle comme raison."""
    ordered = tuple(sorted(set(violations), key=lambda item: (item.path, item.rule)))
    return ContentError(INVALID_DASHBOARD, ordered[0].rule, ordered)


class Pinned:
    """Analyses épinglées par un dashboard, telles qu'une session peut les lire.

    La tête du dépôt est celle que l'appelant donne (`tip`, résolue une seule fois par requête, la
    même pour le dashboard et pour ses épingles) ; chaque révision épinglée est lue une fois.
    Une analyse est lisible si la session peut la voir (jugée sur sa tête, comme les routes des
    analyses), si elle n'est pas supprimée (une analyse supprimée ne se référence plus, même par
    son propriétaire) et si la révision épinglée l'est aussi (règle par révision, jugée sur
    l'en-tête de cette révision : son corps n'est ni chargé ni validé pour qui ne peut pas la voir).
    Invisible, supprimée, inexistante ou abîmée : `None`, sans qu'on puisse les distinguer. Dans un
    dépôt vide (`tip` vaut `None`), aucune analyse n'existe."""

    def __init__(
        self, repository: ContentRepository, space_id: str, actor: PersonRef, tip: str | None
    ) -> None:
        self._repository = repository
        self._space_id = space_id
        self._actor = actor
        self._tip = tip
        self._read: dict[tuple[str, int], Document | None] = {}

    def analysis(self, analysis_id: str, revision: int) -> Document | None:
        key = (analysis_id, revision)
        if key not in self._read:
            self._read[key] = self._load(analysis_id, revision)
        return self._read[key]

    def _allowed(self, owner: PersonRef | None, visibility: str | None, deleted: bool) -> bool:
        """Révision lisible, jugée sur son en-tête : un en-tête illisible ne passe pour personne."""
        if owner is None or visibility is None:
            return False
        return visible_to(owner, visibility, self._actor, deleted=deleted)

    def _load(self, analysis_id: str, revision: int) -> Document | None:
        if self._tip is None:
            return None
        try:
            _, seen = establish(
                self._repository, self._space_id, analysis_id, self._actor, at=self._tip
            )
            if seen.deleted:
                return None
            stored = self._repository.read(
                self._space_id, analysis_id, revision, at=self._tip, allow=self._allowed
            )
        except ContentError as error:
            if error.code == CONTENT_UNAVAILABLE and error.reason not in DAMAGED_REASONS:
                raise
            return None
        return stored.document

    def of(self, document: Document) -> dict[str, Document | None]:
        """Analyse lisible de chaque composant exécutable, par identifiant de composant."""
        return {
            component.id: self.analysis(component.analysis_id, component.revision)
            for component in executables(document)
        }


class DashboardConsumers:
    """Qui consomme une analyse : les dashboards dont la révision courante l'épingle, séparés selon
    ce que la session a le droit de voir.

    Git fait foi. L'index des références n'est cru que pour un dashboard dont la ligne porte le
    dernier commit de son fichier sur la tête de la requête (une seule lecture, `latest`). Un
    dashboard que l'index ne connaît pas, ou dont la ligne est en retard (publication réussie, index
    non écrit ou pas encore à jour), est relu depuis git sur cette même tête ; un dashboard supprimé
    n'est pas un consommateur, une ligne dont le fichier n'est plus dans git est ignorée. Un
    dashboard abîmé, dont on ne peut pas dire qu'il n'épingle pas l'analyse, compte parmi les
    autres :
    dans le doute, l'analyse est tenue pour consommée. Si l'index ou le dépôt ne répondent pas,
    l'exhaustivité n'est pas établie : l'appel lève `content_unavailable`, jamais une liste vide.

    La visibilité se juge sur ce qu'on sait du dashboard à cette révision : propriétaire et
    visibilité de la ligne ou du contenu relu."""

    def __init__(self, repository: ContentRepository | None, index: DashboardIndex) -> None:
        self._repository = repository
        self._index = index

    def __call__(
        self, space_id: str, analysis_id: str, actor: PersonRef, at: str | None
    ) -> Dependents:
        if self._repository is None:
            raise ContentError(CONTENT_UNAVAILABLE, "not_configured")
        try:
            known = {row.dashboard_id: row for row in self._index.rows(space_id)}
            pinning = {row.dashboard_id for row in self._index.consumers(space_id, analysis_id)}
        except SQLAlchemyError:
            raise ContentError(CONTENT_UNAVAILABLE, "index_unavailable") from None
        newest = self._repository.latest(space_id, at=at, kind=DASHBOARD_KIND)
        shown: list[Consumer] = []
        others = 0
        for dashboard_id, commit in sorted(newest.items()):
            row = known.get(dashboard_id)
            if row is None or row.commit != commit:
                try:
                    row = DashboardRow.of(
                        space_id,
                        self._repository.read(space_id, dashboard_id, at=at, kind=DASHBOARD_KIND),
                    )
                except ContentError as error:
                    if error.code == DASHBOARD_NOT_FOUND:
                        continue
                    if error.code == CONTENT_UNAVAILABLE and error.reason in DAMAGED_REASONS:
                        others += 1
                        continue
                    raise
                pins = any(item.analysis_id == analysis_id for item in row.references)
            else:
                pins = dashboard_id in pinning
            if not pins:
                continue
            if visible_to(row.owner, row.visibility, actor):
                shown.append(Consumer(CONSUMER_KIND, dashboard_id))
            else:
                others += 1
        return Dependents(tuple(shown), others)


def install_dashboard_routes(
    app: FastAPI,
    repository: ContentRepository | None,
    index: DashboardIndex | None,
    connections: ConnectionStore | None,
    catalog: Catalog | None,
    reader: Callable[[Request, str], Access],
) -> None:
    """Pose les routes des dashboards. Sans dépôt configuré, elles répondent `content_unavailable` ;
    en mode local (ni base ni index), elles répondent `local_mode`, comme les analyses."""
    path = "/api/spaces/{space_id}/dashboards"
    log = logging.getLogger(LOGGER)

    @app.exception_handler(PersonalReference)
    async def personal_reference(request: Request, error: PersonalReference) -> JSONResponse:
        return _error(422, PERSONAL_REFERENCE, components=list(error.components))

    def active(request: Request, space_id: str) -> tuple[Access, PersonRef]:
        access = reader(request, space_id)
        if access.implicit or index is None:
            raise LocalMode(space_id)
        identity = viewer(request)
        assert identity is not None
        return access, PersonRef.of(identity)

    def creator(access: Access) -> None:
        if access.role is None or not access.role.allows(Role.CREATOR):
            raise Refused(403, "forbidden", required=Role.CREATOR.value)

    def depot() -> ContentRepository:
        if repository is None:
            raise ContentError(CONTENT_UNAVAILABLE, "not_configured")
        return repository

    def models() -> dict[str, Any] | None:
        """Catalogue déclaré, ou `None` quand le moteur ne peut pas le décrire."""
        if catalog is None:
            return None
        try:
            return catalog()
        except SemanticRefusal:
            return None

    def connection_names(space_id: str) -> set[str]:
        assert connections is not None
        return {item.name for item, _ in connections.list(space_id)}

    def pinning(space_id: str, actor: PersonRef, tip: str | None) -> Pinned:
        return Pinned(depot(), space_id, actor, tip)

    def check(space_id: str, document: Document, actor: PersonRef, tip: str | None) -> Pinned:
        """Validation à la sauvegarde (B4, B7) : sans catalogue, rien n'est sauvegardé. Les
        violations passent avant `personal_reference`, qui suppose des analyses lisibles.

        Les analyses sont lues sur la tête `tip` de la requête, la même que celle du dashboard
        source. Elles sont rendues : la réponse qui suit la publication les réutilise, si bien
        qu'une requête résout la tête une seule fois et lit chaque révision une seule fois."""
        found = models()
        if found is None:
            raise Refused(503, "engine_unavailable")
        pinned = pinning(space_id, actor, tip)
        pins = pinned.of(document)
        violations = save_violations(document, pins, found)
        if violations:
            raise refuse(violations)
        if document["visibility"] == "shared":
            personal = personal_components(document, pins)
            if personal:
                raise PersonalReference(personal)
        return pinned

    def compose(body: dict[str, Any], dashboard_id: str, owner: PersonRef) -> Document:
        reserved = [name for name in SERVER_FIELDS if name in body]
        if reserved:
            raise refuse([Violation(f"/{name}", "field_not_allowed") for name in reserved])
        return dashboard_format.validate(
            {"api_version": API_VERSION, "id": dashboard_id, "owner": _person(owner), **body}
        )

    def stamp(space_id: str, stored: StoredRevision) -> None:
        """Index mis à jour après la publication dans git. Une base indisponible ne défait
        pas une révision publiée : l'écart sera vu (`index_stale`) et la réindexation le lève."""
        assert index is not None
        try:
            index.upsert(DashboardRow.of(space_id, stored))
        except SQLAlchemyError:
            log.warning("dashboard index not updated")

    def state_of(
        space_id: str,
        stored: StoredRevision,
        actor: PersonRef,
        *,
        current: bool,
        pinned: Pinned,
    ) -> tuple[str, list[Tile]]:
        """État d'un dashboard relu et de chacun de ses composants exécutables, pour cette
        session : écart d'index (révision courante seulement), puis état invérifiable (catalogue
        ou base illisibles), puis composant indisponible, sinon prêt.

        Cet état s'ajoute à une lecture ou à une publication déjà faites : il ne les défait
        jamais. Une base qui ne répond pas rend le dashboard `unverified`, sans erreur.
        """
        pins = pinned.of(stored.document)
        stale = False
        found: dict[str, Any] | None = None
        names: Collection[str] = ()
        try:
            if current:
                assert index is not None
                row = index.get(space_id, stored.document["id"])
                stale = row is None or (row.revision, row.commit) != (
                    stored.revision.number,
                    stored.revision.commit,
                )
            found = models()
            if found is not None:
                names = connection_names(space_id)
        except SQLAlchemyError:
            log.warning("dashboard state not verified")
            found = None
        states = tiles(stored.document, pins, found, names)
        if stale:
            return STALE, states
        if found is None:
            return UNVERIFIED, states
        if any(item.state != READY for item in states):
            return UNRESOLVED, states
        return READY, states

    def present(
        space_id: str,
        stored: StoredRevision,
        access: Access,
        actor: PersonRef,
        *,
        current_revision: int | None,
        pinned: Pinned,
        deleted: bool = False,
    ) -> dict[str, Any]:
        state, states = state_of(
            space_id,
            stored,
            actor,
            current=not deleted and current_revision == stored.revision.number,
            pinned=pinned,
        )
        return {
            "id": stored.document["id"],
            "space_id": space_id,
            "revision": stored.revision.number,
            "current_revision": current_revision,
            "commit": stored.revision.commit,
            "committed_at": stored.revision.committed_at.isoformat(),
            "revised_by": _person(stored.revision.actor),
            "state": state,
            "components": [item.json() for item in states],
            "permissions": rights(access, actor, stored.document, deleted=deleted).json(),
            "dashboard": stored.document,
        }

    def locate(space_id: str, dashboard_id: str, actor: PersonRef) -> Located:
        return find(repository, space_id, dashboard_id, actor, DASHBOARD_KIND)

    def current(space_id: str, dashboard_id: str, actor: PersonRef) -> tuple[StoredRevision, str]:
        """Révision courante d'un dashboard visible de la session, et la tête du dépôt dont elle est
        lue : la requête s'y tient pour toutes ses autres lectures."""
        if ANALYSIS_ID.fullmatch(dashboard_id) is None:
            raise ContentError(DASHBOARD_NOT_FOUND, "missing")
        tip, _ = establish(depot(), space_id, dashboard_id, actor, kind=DASHBOARD_KIND)
        stored = depot().read(space_id, dashboard_id, at=tip, kind=DASHBOARD_KIND)
        if not visible(stored.document, actor):
            raise ContentError(DASHBOARD_NOT_FOUND, "missing")
        return stored, tip

    @app.post(path)
    async def create_dashboard(request: Request, space_id: str) -> JSONResponse:
        access, actor = active(request, space_id)
        creator(access)
        depot()
        body = await _body(request)
        if not isinstance(body, dict):
            raise Invalid("body")

        def work() -> JSONResponse:
            dashboard_id = str(uuid4())
            document = compose(body, dashboard_id, actor)
            pinned = check(space_id, document, actor, depot().head())
            stored = depot().write(
                space_id,
                dashboard_id,
                document,
                expected_revision=None,
                actor=actor,
                kind=DASHBOARD_KIND,
            )
            stamp(space_id, stored)
            number = stored.revision.number
            return JSONResponse(
                present(space_id, stored, access, actor, current_revision=number, pinned=pinned),
                status_code=201,
            )

        return await asyncio.to_thread(work)

    @app.get(path)
    def list_dashboards(request: Request, space_id: str) -> JSONResponse:
        _, actor = active(request, space_id)
        depot_ = depot()
        # La tête une seule fois : l'index est comparé à elle, et chaque ligne périmée est jugée
        # puis lue sur ce même commit.
        tip = depot_.head()
        if tip is None:
            return JSONResponse({"dashboards": [], "unreadable": 0})
        newest = depot_.latest(space_id, at=tip, kind=DASHBOARD_KIND)
        items: list[dict[str, Any]] = []
        unreadable = 0
        assert index is not None
        for row in index.rows(space_id):
            shown = row
            state = INDEXED
            if newest.get(row.dashboard_id) != row.commit:
                # L'index ne dit plus ce que git dit : c'est git qui fait foi, ou rien.
                state = STALE
                try:
                    establish(
                        depot_, space_id, row.dashboard_id, actor, at=tip, kind=DASHBOARD_KIND
                    )
                    shown = DashboardRow.of(
                        space_id,
                        depot_.read(space_id, row.dashboard_id, at=tip, kind=DASHBOARD_KIND),
                    )
                except ContentError as error:
                    # Compté pour le seul propriétaire de l'index : le propriétaire ne change
                    # jamais, alors que la visibilité d'une ligne périmée peut avoir changé.
                    if error.code != DASHBOARD_NOT_FOUND and row.owner == actor:
                        unreadable += 1
                    continue
            if shown.owner != actor and shown.visibility != "shared":
                continue
            items.append(
                {
                    "id": shown.dashboard_id,
                    "name": shown.name,
                    "visibility": shown.visibility,
                    "owner": _person(shown.owner),
                    "is_owner": shown.owner == actor,
                    "revision": shown.revision,
                    "commit": shown.commit,
                    "committed_at": shown.committed_at.isoformat(),
                    "state": state,
                }
            )
        items.sort(key=lambda item: (item["name"].casefold(), item["id"]))
        return JSONResponse({"dashboards": items, "unreadable": unreadable})

    @app.get(path + "/{dashboard_id}")
    def get_dashboard(request: Request, space_id: str, dashboard_id: str) -> JSONResponse:
        access, actor = active(request, space_id)
        stored, tip = current(space_id, dashboard_id, actor)
        return JSONResponse(
            present(
                space_id,
                stored,
                access,
                actor,
                current_revision=stored.revision.number,
                pinned=pinning(space_id, actor, tip),
            )
        )

    @app.get(path + "/{dashboard_id}/revisions")
    def list_revisions(request: Request, space_id: str, dashboard_id: str) -> JSONResponse:
        _, actor = active(request, space_id)
        found = locate(space_id, dashboard_id, actor)
        return JSONResponse(
            {
                "id": dashboard_id,
                "current_revision": found.current,
                "deleted": found.deleted,
                "revisions": [
                    _revision_json(entry.revision)
                    if shown
                    else {"revision": entry.revision.number, "available": False}
                    for entry, shown in zip(found.entries, found.shown, strict=True)
                ],
            }
        )

    @app.get(path + "/{dashboard_id}/revisions/{revision}")
    def get_revision(
        request: Request, space_id: str, dashboard_id: str, revision: str
    ) -> JSONResponse:
        access, actor = active(request, space_id)
        number = _version(revision, "revision")
        found = locate(space_id, dashboard_id, actor)
        stored = found.saved(number)
        return JSONResponse(
            present(
                space_id,
                stored,
                access,
                actor,
                current_revision=found.current,
                pinned=pinning(space_id, actor, found.tip),
                deleted=found.deleted,
            )
        )

    @app.get(path + "/{dashboard_id}/diff")
    def get_diff(
        request: Request,
        space_id: str,
        dashboard_id: str,
        base: str | None = None,
        other: str | None = None,
    ) -> JSONResponse:
        _, actor = active(request, space_id)
        first, second = _version(base, "base"), _version(other, "other")
        found = locate(space_id, dashboard_id, actor)
        # Les deux côtés sont lus de la même tête et jugés chacun : un écart ne dit rien d'une
        # révision que la session ne peut pas voir.
        changes = DASHBOARD_KIND.diff(found.saved(first).document, found.saved(second).document)
        return JSONResponse(
            {
                "id": dashboard_id,
                "base": first,
                "other": second,
                "changes": [
                    {
                        "path": item.path,
                        "kind": item.kind,
                        "node": item.node,
                        "id": item.id,
                        "before": item.before,
                        "after": item.after,
                    }
                    for item in changes
                ],
            }
        )

    @app.post(path + "/{dashboard_id}/revisions")
    async def revise_dashboard(request: Request, space_id: str, dashboard_id: str) -> JSONResponse:
        access, actor = active(request, space_id)
        creator(access)
        depot()
        body = await _body(request)
        if not isinstance(body, dict):
            raise Invalid("body")
        values = dict(body)
        expected = _expected(values.pop("expected_revision", None))

        def work() -> JSONResponse:
            stored, tip = current(space_id, dashboard_id, actor)
            before = stored.document
            allowed = rights(access, actor, before)
            if not allowed.revise:
                raise Refused(403, "forbidden", required="owner")
            if stored.revision.number != expected:
                raise ContentError(REVISION_CONFLICT, "stale")
            document = compose(values, dashboard_id, owner_of(before))
            if not allowed.owner and document["visibility"] != before["visibility"]:
                # Un administrateur révise un dashboard partagé ; le rendre personnel est le
                # choix de son propriétaire.
                raise Refused(403, "forbidden", required="owner")
            pinned = check(space_id, document, actor, tip)
            saved = depot().write(
                space_id,
                dashboard_id,
                document,
                expected_revision=expected,
                actor=actor,
                kind=DASHBOARD_KIND,
            )
            if not saved.unchanged:
                stamp(space_id, saved)
            # Un contenu identique à la courante n'est pas publié (le dépôt le reconnaît sous son
            # verrou) : la courante est rendue, 200 au lieu de 201.
            return JSONResponse(
                present(
                    space_id,
                    saved,
                    access,
                    actor,
                    current_revision=saved.revision.number,
                    pinned=pinned,
                ),
                status_code=200 if saved.unchanged else 201,
            )

        return await asyncio.to_thread(work)

    @app.post(path + "/{dashboard_id}/duplicate")
    async def duplicate_dashboard(
        request: Request, space_id: str, dashboard_id: str
    ) -> JSONResponse:
        access, actor = active(request, space_id)
        creator(access)
        depot()
        body: object = await _body(request) if await request.body() else {}
        if not isinstance(body, dict) or not set(body) <= {"name"}:
            raise Invalid("body")

        def work() -> JSONResponse:
            found, tip = current(space_id, dashboard_id, actor)
            source = found.document
            name = body.get("name", f"Copie de {source['name']}"[:NAME_MAX])
            new_id = str(uuid4())
            document = compose(
                {
                    "name": name,
                    "description": source["description"],
                    "visibility": "personal",
                    "defaults": source["defaults"],
                    "filters": source["filters"],
                    "layout": source["layout"],
                },
                new_id,
                actor,
            )
            pinned = check(space_id, document, actor, tip)
            stored = depot().write(
                space_id, new_id, document, expected_revision=None, actor=actor, kind=DASHBOARD_KIND
            )
            stamp(space_id, stored)
            return JSONResponse(
                present(space_id, stored, access, actor, current_revision=1, pinned=pinned),
                status_code=201,
            )

        return await asyncio.to_thread(work)

    @app.delete(path + "/{dashboard_id}")
    def delete_dashboard(
        request: Request, space_id: str, dashboard_id: str, expected_revision: str | None = None
    ) -> Response:
        access, actor = active(request, space_id)
        creator(access)
        depot_ = depot()
        expected = _expected(_digits(expected_revision))
        stored, _ = current(space_id, dashboard_id, actor)
        if not rights(access, actor, stored.document).delete:
            raise Refused(403, "forbidden", required="owner")
        if stored.revision.number != expected:
            raise ContentError(REVISION_CONFLICT, "stale")
        removed = depot_.delete(
            space_id, dashboard_id, expected_revision=expected, actor=actor, kind=DASHBOARD_KIND
        )
        assert index is not None
        try:
            index.remove(space_id, dashboard_id, removed.number)
        except SQLAlchemyError:
            log.warning("dashboard index not updated")
        return Response(status_code=204)
