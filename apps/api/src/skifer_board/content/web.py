"""Routes des analyses versionnées sous `/api/spaces/{space_id}/analyses` (plan 18.2).

Toute décision d'accès est prise ici, à partir de la session et du document lu dans git :
rien ne vient du navigateur, ni le propriétaire, ni le rôle, ni l'identifiant. Une analyse
personnelle n'est visible que de son propriétaire, administrateur compris : pour tout autre,
elle répond comme une analyse inexistante, sur toutes les routes, liste, historique et écart
compris. La visibilité se juge aussi révision par révision : une révision qui a été personnelle
n'est servie qu'à son propriétaire, même si l'analyse a été partagée depuis ; pour tout autre,
elle répond comme une révision inexistante (lecture, écart) et l'historique n'en donne aucune
métadonnée (`available: false`). La révision jugée est celle qui est servie : elle est lue une
seule fois, d'une même tête de dépôt. Le contenu servi vient toujours de git ; l'index ne sert
qu'à lister et à repérer un écart (`index_stale`). Les refus ont des codes fermés ; un message
ne cite ni valeur de filtre, ni nom d'analyse, ni personne.
"""

from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

from ..execution.semantic import SemanticRefusal
from ..execution.store import ConnectionStore
from ..spaces.access import Access
from ..spaces.model import LocalMode, PersonRef, Role
from ..spaces.web import Invalid, Refused, _body, _object, viewer
from .analysis import API_VERSION, Document, diff, validate
from .errors import (
    ANALYSIS_NOT_FOUND,
    CONTENT_UNAVAILABLE,
    INVALID_ANALYSIS,
    REVISION_CONFLICT,
    ContentError,
    Violation,
)
from .events import Kind, UsageEvents, saved_id
from .index import INDEXED, AnalysisIndex, IndexRow
from .references import contextual_violations, reference_violations, refusal
from .repository import ContentRepository, Entry, Glance, Revision, StoredRevision

LOGGER = "skifer_board.content"
ANALYSIS_ID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
ANALYSIS_IN_USE = "analysis_in_use"
ANALYSIS_MODEL_MISMATCH = "analysis_model_mismatch"
STALE = "index_stale"
UNRESOLVED = "unresolved_reference"
UNVERIFIED = "unverified"
READY = "ready"
MAX_REVISION = 999_999_999
NAME_MAX = 120
# Champs de l'analyse que le serveur pose lui-même : un corps qui les porte est refusé.
SERVER_FIELDS = ("api_version", "id", "owner")
REVISION_PARAMETER = "Numéro de révision : entier strictement positif."

# Statut HTTP de chaque refus du dépôt de contenus.
_STATUS = {
    CONTENT_UNAVAILABLE: 503,
    REVISION_CONFLICT: 409,
    INVALID_ANALYSIS: 422,
    ANALYSIS_NOT_FOUND: 404,
}

Catalog = Callable[[], dict[str, Any]]


@dataclass(frozen=True)
class Consumer:
    """Ce qui dépend d'une analyse (un tableau de bord, au lot 07) ; sans nom ni contenu."""

    kind: str
    id: str


Consumers = Callable[[str, str], Sequence[Consumer]]
# Dernière exécution d'une personne qui référençait une analyse (plan 18.3b) : la révision
# référencée et le résumé de l'exécution, ou `None`. Cette personne seule, jamais une autre.
LastExecution = Callable[[str, str, PersonRef], tuple[int, dict[str, Any]] | None]


def no_consumers(space_id: str, analysis_id: str) -> Sequence[Consumer]:
    """Avant le lot 07, rien ne consomme une analyse : le contrôle est en place, la liste vide."""
    return ()


@dataclass(frozen=True)
class Rights:
    """Ce que la session peut faire d'une analyse qu'elle voit (plan 18, A5)."""

    owner: bool
    revise: bool
    delete: bool
    duplicate: bool

    def json(self) -> dict[str, bool]:
        return {
            "owner": self.owner,
            "revise": self.revise,
            "delete": self.delete,
            "duplicate": self.duplicate,
        }


def owner_of(document: Document) -> PersonRef:
    owner = document["owner"]
    return PersonRef(owner["issuer"], owner["subject"])


def visible_to(
    owner: PersonRef, visibility: str, actor: PersonRef, *, deleted: bool = False
) -> bool:
    """Personnelle (ou supprimée) : son propriétaire seulement ; partagée : tout lecteur."""
    if owner == actor:
        return True
    return not deleted and visibility == "shared"


def visible(document: Document, actor: PersonRef, *, deleted: bool = False) -> bool:
    return visible_to(owner_of(document), document["visibility"], actor, deleted=deleted)


def rights(
    access: Access, actor: PersonRef, document: Document, *, deleted: bool = False
) -> Rights:
    """Droits d'une session sur une analyse qu'elle voit.

    Créer, réviser, supprimer et dupliquer exigent `creator` ou `admin` ; réviser ou supprimer
    une analyse exige en plus d'en être le propriétaire, ou d'administrer l'espace quand elle
    est partagée. Le rôle de l'administration de la plateforme n'y compte pas.
    """
    creator = access.role is not None and access.role.allows(Role.CREATOR)
    admin = access.role is not None and access.role.allows(Role.ADMIN)
    owner = owner_of(document) == actor
    manage = creator and not deleted and (owner or (document["visibility"] == "shared" and admin))
    return Rights(
        owner,
        manage,
        manage,
        creator and not deleted and visible(document, actor),
    )


@dataclass(frozen=True)
class Located:
    """Historique d'une analyse visible, lu d'une même tête de dépôt avec le contenu de chaque
    révision, et l'indication de chacune : la session a-t-elle le droit de la voir ?"""

    entries: tuple[Entry, ...]
    shown: tuple[bool, ...]
    deleted: bool

    @property
    def current(self) -> int | None:
        return None if self.deleted else self.entries[-1].revision.number

    def saved(self, number: int) -> StoredRevision:
        """Révision enregistrée `number`, si elle existe et si la session peut la voir ;
        sinon, comme une révision inexistante."""
        saves = [
            (entry, shown)
            for entry, shown in zip(self.entries, self.shown, strict=True)
            if entry.revision.action == "save"
        ]
        if number > len(saves) or not saves[number - 1][1]:
            raise ContentError(ANALYSIS_NOT_FOUND, "missing_revision")
        entry = saves[number - 1][0]
        assert entry.document is not None
        return StoredRevision(entry.revision, entry.document)


def _error(status: int, code: str, **fields: Any) -> JSONResponse:
    return JSONResponse({"error": {"code": code, **fields}}, status_code=status)


def _person(ref: PersonRef) -> dict[str, str]:
    return {"issuer": ref.issuer, "subject": ref.subject}


def _violations(items: Sequence[Violation]) -> list[dict[str, str]]:
    return [{"path": item.path, "rule": item.rule} for item in items]


def _revision_json(revision: Revision) -> dict[str, Any]:
    return {
        "revision": revision.number,
        "available": True,
        "commit": revision.commit,
        "committed_at": revision.committed_at.isoformat(),
        "actor": _person(revision.actor),
        "action": revision.action,
    }


def _version(value: str | None, parameter: str) -> int:
    """Numéro de révision d'un paramètre : entier strictement positif écrit en chiffres."""
    number = _digits(value)
    if number is None or number < 1:
        raise Refused(400, "invalid_parameter", parameter=parameter, detail=REVISION_PARAMETER)
    return number


def _expected(value: object) -> int:
    if type(value) is not int or not 1 <= value <= MAX_REVISION:
        raise Invalid("expected_revision")
    return value


def _digits(value: str | None) -> int | None:
    """Entier écrit en chiffres ASCII (au plus neuf), ou `None`."""
    if value is None or not value.isascii() or not value.isdigit() or len(value) > 9:
        return None
    return int(value)


def establish(
    repository: ContentRepository,
    space_id: str,
    analysis_id: str,
    actor: PersonRef,
    at: str | None = None,
) -> tuple[str, Glance]:
    """Refuse, comme une analyse inconnue, ce que la session n'a pas le droit de voir, avant de
    lire l'histoire ou le moindre autre contenu : le coût d'un refus ne dépend ni du nombre de
    révisions ni de leur contenu.

    La tête du dépôt est résolue ici, une seule fois (sauf si l'appelant la fournit avec `at`), et
    rendue : toutes les lectures qui suivent portent sur ce commit, jamais sur une tête relue plus
    tard. La visibilité se juge sur le contenu de cette tête (ou, pour une analyse supprimée, sur
    celui d'avant la suppression). Quand ce contenu est illisible, rien n'établit qu'une personne
    peut voir l'analyse : seule celle qui l'a créée passe, et la lecture complète lui dit alors ce
    qui ne va pas (`content_unavailable`). Pour toute autre, l'analyse abîmée répond comme
    inconnue. Une panne générale du dépôt (absent, git indisponible, tête illisible) se lève telle
    quelle.
    """
    tip = repository.head() if at is None else at
    if tip is None:
        raise ContentError(ANALYSIS_NOT_FOUND, "missing")
    seen = repository.glance(space_id, analysis_id, at=tip)
    if seen.owner is None or seen.visibility is None:
        # Inconnue, ou contenu illisible : seule la personne qui l'a créée passe.
        if seen.owner is None or seen.owner != actor:
            raise ContentError(ANALYSIS_NOT_FOUND, "missing")
    elif not visible_to(seen.owner, seen.visibility, actor, deleted=seen.deleted):
        raise ContentError(ANALYSIS_NOT_FOUND, "missing")
    return tip, seen


def find(
    repository: ContentRepository | None, space_id: str, analysis_id: str, actor: PersonRef
) -> Located:
    """Historique d'une analyse que la session a le droit de voir ; sinon, comme inconnue.

    L'analyse se juge sur sa dernière révision enregistrée, chaque révision sur son propre
    contenu : rendue personnelle après avoir été partagée, l'analyse disparaît pour tout
    autre que son propriétaire ; partagée après avoir été personnelle, elle laisse ses
    premières révisions à son propriétaire.
    """
    if repository is None:
        raise ContentError(CONTENT_UNAVAILABLE, "not_configured")
    if ANALYSIS_ID.fullmatch(analysis_id) is None:
        raise ContentError(ANALYSIS_NOT_FOUND, "missing")
    tip, seen = establish(repository, space_id, analysis_id, actor)

    def allow(owner: PersonRef | None, visibility: str | None, deleted: bool) -> bool:
        """Révision lisible par la session, jugée sur son seul en-tête. Un en-tête illisible ne
        passe que pour la personne qui a créé l'analyse : le chargement complet lui dit ce qui
        ne va pas ; pour toute autre, la révision est masquée."""
        if owner is None or visibility is None:
            return seen.owner == actor
        return visible_to(owner, visibility, actor, deleted=deleted)

    entries = repository.entries(space_id, analysis_id, at=tip, allow=allow)
    deleted = entries[-1].revision.action == "delete"
    last = [entry for entry in entries if entry.revision.action == "save"][-1]
    if last.document is None or not visible(last.document, actor, deleted=deleted):
        raise ContentError(ANALYSIS_NOT_FOUND, "missing")
    # Une suppression n'a pas de contenu : elle se montre à qui voit l'analyse supprimée,
    # c'est-à-dire à son propriétaire. Une révision masquée n'a pas été chargée.
    shown = tuple(
        not entry.hidden
        and (entry.document is None or visible(entry.document, actor, deleted=deleted))
        for entry in entries
    )
    return Located(entries, shown, deleted)


class AnalysisUse:
    """Ce que l'exécution demande aux analyses (A8) : vérifier une référence, puis consigner
    qu'une exécution l'a portée. La référence ne change rien à l'exécution elle-même."""

    def __init__(self, repository: ContentRepository | None, events: UsageEvents | None) -> None:
        self._repository = repository
        self._events = events
        self._log = logging.getLogger(LOGGER)

    def check(
        self, space_id: str, analysis_id: str, revision: int, actor: PersonRef, model: str
    ) -> None:
        """Accepte une référence si l'analyse est de cet espace, si la révision existe, si la
        session a le droit de la voir (règle par révision) et si le modèle est celui de la
        révision. Tout ce que la session ne peut pas voir répond comme une analyse inexistante."""
        found = find(self._repository, space_id, analysis_id, actor)
        if found.deleted:
            raise ContentError(ANALYSIS_NOT_FOUND, "missing")
        stored = found.saved(revision)
        if stored.document["query"]["model"] != model:
            raise Refused(422, ANALYSIS_MODEL_MISMATCH)

    def executed(self, space_id: str, analysis_id: str, revision: int, execution_id: str) -> None:
        """Événement `executed`, identifié par l'exécution acceptée ; ne lève jamais."""
        assert self._events is not None
        try:
            self._events.record(execution_id, "executed", space_id, analysis_id, revision)
        except SQLAlchemyError:
            self._log.warning("analysis event not recorded")


def install_analysis_routes(
    app: FastAPI,
    repository: ContentRepository | None,
    index: AnalysisIndex | None,
    connections: ConnectionStore | None,
    catalog: Catalog | None,
    reader: Callable[[Request, str], Access],
    consumers: Consumers = no_consumers,
    events: UsageEvents | None = None,
    last_execution: LastExecution | None = None,
) -> None:
    """Pose les routes des analyses. Sans dépôt configuré, elles répondent `content_unavailable` ;
    en mode local (ni base ni index), elles répondent `local_mode`, comme les exécutions."""
    path = "/api/spaces/{space_id}/analyses"
    log = logging.getLogger(LOGGER)

    @app.exception_handler(ContentError)
    async def content_error(request: Request, error: ContentError) -> JSONResponse:
        status = _STATUS[error.code]
        if error.code == INVALID_ANALYSIS:
            return _error(
                status, error.code, reason=error.reason, violations=_violations(error.violations)
            )
        if error.code == REVISION_CONFLICT:
            return _error(status, error.code, reason=error.reason)
        if error.code == CONTENT_UNAVAILABLE:
            # Le détail reste au journal de l'exploitation, pas dans la réponse.
            log.warning("content unavailable: %s", error.reason)
        return _error(status, error.code)

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

    def identifier(value: str) -> str:
        if ANALYSIS_ID.fullmatch(value) is None:
            raise ContentError(ANALYSIS_NOT_FOUND, "missing")
        return value

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

    def check_references(space_id: str, document: Document) -> None:
        """Validation à la sauvegarde (A6) : sans catalogue, rien n'est sauvegardé."""
        found = models()
        if found is None:
            raise Refused(503, "engine_unavailable")
        violations = reference_violations(document, found, connection_names(space_id))
        violations += contextual_violations(document, found)
        if violations:
            raise refusal(violations)

    def compose(body: dict[str, Any], analysis_id: str, owner: PersonRef) -> Document:
        reserved = [name for name in SERVER_FIELDS if name in body]
        if reserved:
            raise refusal([Violation(f"/{name}", "field_not_allowed") for name in reserved])
        return validate(
            {"api_version": API_VERSION, "id": analysis_id, "owner": _person(owner), **body}
        )

    def stamp(space_id: str, stored: StoredRevision) -> None:
        """Index mis à jour après la publication dans git. Une base indisponible ne défait
        pas une révision publiée : l'écart sera vu (`index_stale`) et la réindexation le lève."""
        assert index is not None
        try:
            index.upsert(IndexRow.of(space_id, stored))
        except SQLAlchemyError:
            log.warning("analysis index not updated")

    def note(kind: Kind, event_id: str, space_id: str, analysis_id: str, revision: int) -> bool:
        """Événement d'usage : une panne de la base ne défait ni ne refuse rien, elle est
        consignée sans détail. Rend `False` quand l'événement n'a pas pu être enregistré."""
        assert events is not None
        try:
            events.record(event_id, kind, space_id, analysis_id, revision)
        except SQLAlchemyError:
            log.warning("analysis event not recorded")
            return False
        return True

    def published(space_id: str, stored: StoredRevision) -> None:
        """Index et événement `saved` d'une révision qui vient d'être publiée."""
        stamp(space_id, stored)
        note(
            "saved",
            saved_id(stored.revision.commit, stored.revision.action),
            space_id,
            stored.document["id"],
            stored.revision.number,
        )

    def state_of(
        space_id: str, stored: StoredRevision, *, current: bool
    ) -> tuple[str, list[Violation]]:
        """État d'une analyse relue, par priorité : écart d'index (révision courante seulement),
        puis état invérifiable (catalogue ou base illisibles), puis références disparues.

        Cet état s'ajoute à une lecture ou à une publication déjà faites : il ne les défait
        jamais. Une base qui ne répond pas rend l'analyse `unverified`, sans erreur.
        """
        try:
            if current:
                assert index is not None
                row = index.get(space_id, stored.document["id"])
                if row is None or (row.revision, row.commit) != (
                    stored.revision.number,
                    stored.revision.commit,
                ):
                    return STALE, []
            found = models()
            if found is None:
                return UNVERIFIED, []
            violations = reference_violations(stored.document, found, connection_names(space_id))
        except SQLAlchemyError:
            log.warning("analysis state not verified")
            return UNVERIFIED, []
        if violations:
            return UNRESOLVED, violations
        return READY, violations

    def present(
        space_id: str,
        stored: StoredRevision,
        access: Access,
        actor: PersonRef,
        *,
        current_revision: int | None,
        deleted: bool = False,
    ) -> dict[str, Any]:
        state, violations = state_of(
            space_id, stored, current=not deleted and current_revision == stored.revision.number
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
            "unresolved": _violations(violations),
            "permissions": rights(access, actor, stored.document, deleted=deleted).json(),
            "analysis": stored.document,
        }

    def locate(space_id: str, analysis_id: str, actor: PersonRef) -> Located:
        return find(repository, space_id, analysis_id, actor)

    def current(space_id: str, analysis_id: str, actor: PersonRef) -> StoredRevision:
        """Révision courante d'une analyse visible de la session."""
        identifier(analysis_id)
        tip, _ = establish(depot(), space_id, analysis_id, actor)
        stored = depot().read(space_id, analysis_id, at=tip)
        if not visible(stored.document, actor):
            raise ContentError(ANALYSIS_NOT_FOUND, "missing")
        return stored

    @app.post(path)
    async def create_analysis(request: Request, space_id: str) -> JSONResponse:
        access, actor = active(request, space_id)
        creator(access)
        depot()
        body = await _body(request)
        if not isinstance(body, dict):
            raise Invalid("body")

        def work() -> JSONResponse:
            analysis_id = str(uuid4())
            document = compose(body, analysis_id, actor)
            check_references(space_id, document)
            stored = depot().write(
                space_id, analysis_id, document, expected_revision=None, actor=actor
            )
            published(space_id, stored)
            number = stored.revision.number
            return JSONResponse(
                present(space_id, stored, access, actor, current_revision=number), status_code=201
            )

        return await asyncio.to_thread(work)

    @app.get(path)
    def list_analyses(request: Request, space_id: str) -> JSONResponse:
        _, actor = active(request, space_id)
        depot_ = depot()
        # La tête une seule fois : l'index est comparé à elle, et chaque ligne périmée est jugée
        # puis lue sur ce même commit.
        tip = depot_.head()
        if tip is None:
            return JSONResponse({"analyses": [], "unreadable": 0})
        newest = depot_.latest(space_id, at=tip)
        items: list[dict[str, Any]] = []
        unreadable = 0
        assert index is not None
        for row in index.rows(space_id):
            shown = row
            state = INDEXED
            if newest.get(row.analysis_id) != row.commit:
                # L'index ne dit plus ce que git dit : c'est git qui fait foi, ou rien.
                state = STALE
                try:
                    # La visibilité d'abord, sur la même tête : le contenu complet n'est lu et
                    # validé que pour une session qui a le droit de voir l'analyse.
                    establish(depot_, space_id, row.analysis_id, actor, at=tip)
                    shown = IndexRow.of(space_id, depot_.read(space_id, row.analysis_id, at=tip))
                except ContentError as error:
                    # Compté pour le seul propriétaire de l'index : le propriétaire ne change
                    # jamais, alors que la visibilité d'une ligne périmée peut avoir changé.
                    if error.code != ANALYSIS_NOT_FOUND and row.owner == actor:
                        unreadable += 1
                    continue
            if shown.owner != actor and shown.visibility != "shared":
                continue
            items.append(
                {
                    "id": shown.analysis_id,
                    "name": shown.name,
                    "visibility": shown.visibility,
                    "owner": _person(shown.owner),
                    "is_owner": shown.owner == actor,
                    "revision": shown.revision,
                    "commit": shown.commit,
                    "committed_at": shown.committed_at.isoformat(),
                    "model": shown.model,
                    "metrics": list(shown.metrics),
                    "state": state,
                }
            )
        items.sort(key=lambda item: (item["name"].casefold(), item["id"]))
        return JSONResponse({"analyses": items, "unreadable": unreadable})

    @app.get(path + "/{analysis_id}")
    def get_analysis(request: Request, space_id: str, analysis_id: str) -> JSONResponse:
        access, actor = active(request, space_id)
        stored = current(space_id, analysis_id, actor)
        return JSONResponse(
            present(space_id, stored, access, actor, current_revision=stored.revision.number)
        )

    @app.get(path + "/{analysis_id}/revisions")
    def list_revisions(request: Request, space_id: str, analysis_id: str) -> JSONResponse:
        _, actor = active(request, space_id)
        found = locate(space_id, analysis_id, actor)
        return JSONResponse(
            {
                "id": analysis_id,
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

    @app.get(path + "/{analysis_id}/revisions/{revision}")
    def get_revision(
        request: Request, space_id: str, analysis_id: str, revision: str
    ) -> JSONResponse:
        access, actor = active(request, space_id)
        number = _version(revision, "revision")
        found = locate(space_id, analysis_id, actor)
        stored = found.saved(number)
        return JSONResponse(
            present(
                space_id,
                stored,
                access,
                actor,
                current_revision=found.current,
                deleted=found.deleted,
            )
        )

    @app.get(path + "/{analysis_id}/diff")
    def get_diff(
        request: Request,
        space_id: str,
        analysis_id: str,
        base: str | None = None,
        other: str | None = None,
    ) -> JSONResponse:
        _, actor = active(request, space_id)
        first, second = _version(base, "base"), _version(other, "other")
        found = locate(space_id, analysis_id, actor)
        # Les deux côtés sont lus de la même tête et jugés chacun : un écart ne dit rien d'une
        # révision que la session ne peut pas voir.
        changes = diff(found.saved(first).document, found.saved(second).document)
        return JSONResponse(
            {
                "id": analysis_id,
                "base": first,
                "other": second,
                "changes": [
                    {
                        "path": item.path,
                        "kind": item.kind,
                        "before": item.before,
                        "after": item.after,
                    }
                    for item in changes
                ],
            }
        )

    @app.post(path + "/{analysis_id}/opened")
    async def opened_analysis(request: Request, space_id: str, analysis_id: str) -> JSONResponse:
        """Consigne l'ouverture d'une révision (A8). Une lecture n'écrit jamais : l'ouverture est
        un appel explicite du client, avec l'identifiant qu'il a tiré, donc rejouable."""
        _, actor = active(request, space_id)
        depot()
        assert events is not None
        if not events.keyed:
            # Sans la clé du serveur, une ouverture ne peut pas être consignée sans personne.
            log.warning("analysis opened not recorded: usage key missing")
            raise ContentError(CONTENT_UNAVAILABLE, "usage_key_missing")
        values = _object(await _body(request), "body", {"event_id", "revision"})
        client = values["event_id"]
        if not isinstance(client, str) or ANALYSIS_ID.fullmatch(client) is None:
            raise Invalid("event_id")
        number = values["revision"]
        if type(number) is not int or not 1 <= number <= MAX_REVISION:
            raise Invalid("revision")

        def work() -> JSONResponse:
            found = locate(space_id, analysis_id, actor)
            if found.deleted:
                raise ContentError(ANALYSIS_NOT_FOUND, "missing")
            found.saved(number)
            recorded = note(
                "opened",
                events.opened_id(space_id, analysis_id, actor, client),
                space_id,
                analysis_id,
                number,
            )
            return JSONResponse({"recorded": recorded}, status_code=202)

        return await asyncio.to_thread(work)

    @app.get(path + "/{analysis_id}/usage")
    def get_usage(request: Request, space_id: str, analysis_id: str) -> JSONResponse:
        """Compte des événements d'une analyse, par sorte, sans aucune personne."""
        _, actor = active(request, space_id)
        current(space_id, analysis_id, actor)
        assert events is not None
        return JSONResponse(
            {
                "id": analysis_id,
                "usage": {
                    kind: {
                        "total": found.total,
                        "last_30_days": found.last_30_days,
                        "last_at": None if found.last_at is None else found.last_at.isoformat(),
                    }
                    for kind, found in events.usage(space_id, analysis_id).items()
                },
            }
        )

    @app.get(path + "/{analysis_id}/last-execution")
    def get_last_execution(request: Request, space_id: str, analysis_id: str) -> JSONResponse:
        """Preuves de la fiche (18.3b) : la dernière exécution de la session qui référençait
        cette analyse, toutes révisions confondues. Les droits sont ceux de lire l'analyse
        courante, vérifiés avant toute lecture d'exécution ; une analyse invisible répond
        comme une analyse inexistante. Les exécutions des autres personnes ne sont jamais lues."""
        _, actor = active(request, space_id)
        current(space_id, analysis_id, actor)
        assert last_execution is not None
        found = last_execution(space_id, analysis_id, actor)
        return JSONResponse(
            {
                "id": analysis_id,
                "revision": None if found is None else found[0],
                "execution": None if found is None else found[1],
            }
        )

    @app.post(path + "/{analysis_id}/revisions")
    async def revise_analysis(request: Request, space_id: str, analysis_id: str) -> JSONResponse:
        access, actor = active(request, space_id)
        creator(access)
        depot()
        body = await _body(request)
        if not isinstance(body, dict):
            raise Invalid("body")
        values = dict(body)
        expected = _expected(values.pop("expected_revision", None))

        def work() -> JSONResponse:
            stored = current(space_id, analysis_id, actor)
            before = stored.document
            allowed = rights(access, actor, before)
            if not allowed.revise:
                raise Refused(403, "forbidden", required="owner")
            if stored.revision.number != expected:
                raise ContentError(REVISION_CONFLICT, "stale")
            document = compose(values, analysis_id, owner_of(before))
            if not allowed.owner and document["visibility"] != before["visibility"]:
                # Un administrateur révise une analyse partagée ; la rendre personnelle est
                # le choix de son propriétaire.
                raise Refused(403, "forbidden", required="owner")
            check_references(space_id, document)
            saved = depot().write(
                space_id, analysis_id, document, expected_revision=expected, actor=actor
            )
            if not saved.unchanged:
                published(space_id, saved)
            # Un contenu identique à la courante n'est pas publié (le dépôt le reconnaît sous son
            # verrou) : la courante est rendue, 200 au lieu de 201.
            return JSONResponse(
                present(space_id, saved, access, actor, current_revision=saved.revision.number),
                status_code=200 if saved.unchanged else 201,
            )

        return await asyncio.to_thread(work)

    @app.post(path + "/{analysis_id}/duplicate")
    async def duplicate_analysis(request: Request, space_id: str, analysis_id: str) -> JSONResponse:
        access, actor = active(request, space_id)
        creator(access)
        depot()
        body: object = await _body(request) if await request.body() else {}
        if not isinstance(body, dict) or not set(body) <= {"name"}:
            raise Invalid("body")

        def work() -> JSONResponse:
            source = current(space_id, analysis_id, actor).document
            name = body.get("name", f"Copie de {source['name']}"[:NAME_MAX])
            new_id = str(uuid4())
            document = compose(
                {
                    "name": name,
                    "description": source["description"],
                    "visibility": "personal",
                    "query": source["query"],
                    "contextual": source["contextual"],
                    "presentation": source["presentation"],
                },
                new_id,
                actor,
            )
            check_references(space_id, document)
            stored = depot().write(space_id, new_id, document, expected_revision=None, actor=actor)
            published(space_id, stored)
            return JSONResponse(
                present(space_id, stored, access, actor, current_revision=1), status_code=201
            )

        return await asyncio.to_thread(work)

    @app.delete(path + "/{analysis_id}")
    def delete_analysis(
        request: Request, space_id: str, analysis_id: str, expected_revision: str | None = None
    ) -> Response:
        access, actor = active(request, space_id)
        creator(access)
        depot_ = depot()
        expected = _expected(_digits(expected_revision))
        stored = current(space_id, analysis_id, actor)
        if not rights(access, actor, stored.document).delete:
            raise Refused(403, "forbidden", required="owner")
        if stored.revision.number != expected:
            raise ContentError(REVISION_CONFLICT, "stale")
        dependents = consumers(space_id, analysis_id)
        if dependents:
            return _error(
                409,
                ANALYSIS_IN_USE,
                consumers=[{"kind": item.kind, "id": item.id} for item in dependents],
            )
        removed = depot_.delete(space_id, analysis_id, expected_revision=expected, actor=actor)
        assert index is not None
        try:
            index.remove(space_id, analysis_id, removed.number)
        except SQLAlchemyError:
            log.warning("analysis index not updated")
        return Response(status_code=204)
