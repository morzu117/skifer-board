"""Routes communes des thèmes, modèles et composants (plan 20.2)."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from datetime import datetime
from uuid import uuid4

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

from ..spaces.access import Access
from ..spaces.model import LocalMode, PersonRef, Role
from ..spaces.web import Invalid, Refused, _body, viewer
from .common import changes_json
from .dashboard_web import PersonalReference, Pinned
from .errors import CONTENT_UNAVAILABLE, ContentError, Violation
from .repository import (
    COMPONENT_KIND,
    DAMAGED_REASONS,
    PAGE_TEMPLATE_KIND,
    THEME_KIND,
    ContentRepository,
    Kind,
    Revision,
    StoredRevision,
)
from .shared_access import can_change, latest_visible, revision_visible
from .shared_consumers import SharedConsumers
from .shared_index import ApprovalRow, SharedIndex, SharedRow
from .web import (
    ANALYSIS_ID,
    LOGGER,
    SERVER_FIELDS,
    _digits,
    _error,
    _expected,
    _person,
    _revision_json,
    _version,
    retry_head,
)


def install_shared_routes(
    app: FastAPI,
    repository: ContentRepository | None,
    index: SharedIndex | None,
    reader: Callable[[Request, str], Access],
    consumers: SharedConsumers | None = None,
) -> None:
    """Installe les routes de gestion des trois genres."""
    log = logging.getLogger(LOGGER)

    def active(
        request: Request, space_id: str, required: Role = Role.CREATOR
    ) -> tuple[Access, PersonRef]:
        access = reader(request, space_id)
        if access.implicit or index is None:
            raise LocalMode(space_id)
        if access.role is None or not access.role.allows(required):
            raise Refused(403, "forbidden", required=required.value)
        identity = viewer(request)
        assert identity is not None
        return access, PersonRef.of(identity)

    def depot() -> ContentRepository:
        if repository is None:
            raise ContentError(CONTENT_UNAVAILABLE, "not_configured")
        return repository

    def row_of(space_id: str, ident: str, kind: Kind) -> SharedRow | None:
        assert index is not None
        try:
            return index.get(kind.name, space_id, ident)
        except SQLAlchemyError:
            raise ContentError(CONTENT_UNAVAILABLE, "index_unavailable") from None

    def approvals(space_id: str, ident: str, kind: Kind, tip: str) -> set[int]:
        try:
            saved = depot().read_approvals(space_id, ident, kind=kind, at=tip).document["approvals"]
        except ContentError as error:
            if error.code != "approvals_not_found":
                raise
            saved = []
        return {item["revision"] for item in saved}

    def checked(
        space_id: str,
        ident: str,
        kind: Kind,
        actor: PersonRef,
        access: Access,
        revision: int | None,
    ) -> tuple[StoredRevision, SharedRow | None, set[int], str]:
        if ANALYSIS_ID.fullmatch(ident) is None:
            raise ContentError(kind.not_found, "missing")
        repo = depot()
        tip = repo.head()
        if tip is None:
            raise ContentError(kind.not_found, "missing")
        glance = repo.glance(space_id, ident, at=tip, kind=kind)
        if glance.owner is None or glance.deleted:
            raise ContentError(kind.not_found, "missing")
        owner = glance.owner
        indexed = row_of(space_id, ident, kind)
        accepted = approvals(space_id, ident, kind, tip)
        if revision is not None and not revision_visible(
            access.role, actor, owner, revision, accepted
        ):
            raise ContentError(kind.not_found, "missing_revision")
        history = repo.history(space_id, ident, at=tip, kind=kind)
        target = (
            latest_visible(
                (entry.number for entry in history if entry.action == "save"),
                access.role,
                actor,
                owner,
                accepted,
            )
            if revision is None
            else revision
        )
        if target is None:
            raise ContentError(kind.not_found, "missing_revision")
        stored = repo.read(space_id, ident, target, at=tip, kind=kind)
        return stored, indexed, accepted, history[-1].commit

    def visible_history(
        space_id: str, ident: str, kind: Kind, actor: PersonRef, access: Access
    ) -> tuple[str, tuple[Revision, ...], bool]:
        if ANALYSIS_ID.fullmatch(ident) is None:
            raise ContentError(kind.not_found, "missing")
        repo = depot()
        tip = repo.head()
        if tip is None:
            raise ContentError(kind.not_found, "missing")
        glance = repo.glance(space_id, ident, at=tip, kind=kind)
        if glance.owner is None or (glance.deleted and actor != glance.owner):
            raise ContentError(kind.not_found, "missing")
        accepted = set() if glance.deleted else approvals(space_id, ident, kind, tip)
        if (
            actor != glance.owner
            and not (access.role is not None and access.role.allows(Role.ADMIN))
            and not accepted
        ):
            raise ContentError(kind.not_found, "missing")
        entries = repo.history(space_id, ident, at=tip, kind=kind)
        visible = tuple(
            entry
            for entry in entries
            if revision_visible(access.role, actor, glance.owner, entry.number, accepted)
        )
        if not visible:
            raise ContentError(kind.not_found, "missing")
        return tip, visible, glance.deleted

    def present(
        space_id: str,
        stored: StoredRevision,
        row: SharedRow | None,
        accepted: set[int],
        kind: Kind,
        current_commit: str,
    ) -> JSONResponse:
        stale = (
            row is None
            or row.commit != current_commit
            or row.approved_revision != max(accepted, default=None)
        )
        approved = max(accepted, default=None)
        return JSONResponse(
            {
                "id": stored.document["id"],
                "space_id": space_id,
                "revision": stored.revision.number,
                "commit": stored.revision.commit,
                "committed_at": stored.revision.committed_at.isoformat(),
                "revised_by": _person(stored.revision.actor),
                "state": "approved" if stored.revision.number in accepted else "draft",
                "approved_revision": approved,
                "index_state": "index_stale" if stale else "indexed",
                kind.name: stored.document,
            },
            headers={"ETag": f'"{stored.revision.commit}"'},
        )

    def check_component(
        kind: Kind, space_id: str, document: dict[str, object], actor: PersonRef
    ) -> str | None:
        if kind is not COMPONENT_KIND:
            return None
        reference = document["analysis"]
        assert isinstance(reference, dict)
        analysis_id = reference["analysis_id"]
        revision = reference["revision"]
        tip = depot().head()
        found = Pinned(depot(), space_id, actor, tip).analysis(analysis_id, revision)
        if found is None:
            raise ContentError("analysis_not_found", "missing")
        if found["visibility"] != "shared":
            raise PersonalReference([analysis_id])
        return tip

    def install(kind: Kind, segment: str) -> None:
        path = f"/api/spaces/{{space_id}}/{segment}"

        @app.post(path)
        async def create(request: Request, space_id: str) -> JSONResponse:
            _, actor = active(request, space_id)
            repo = depot()
            body = await _body(request)
            if not isinstance(body, dict):
                raise Invalid("body")
            forbidden = [
                Violation(f"/{key}", "field_not_allowed") for key in SERVER_FIELDS if key in body
            ]
            if forbidden:
                raise ContentError(kind.invalid, forbidden[0].rule, tuple(forbidden))

            def work() -> JSONResponse:
                ident = str(uuid4())
                document = kind.validate(
                    {
                        "api_version": f"board.{kind.name}/v1",
                        "id": ident,
                        "owner": _person(actor),
                        **body,
                    }
                )
                checked_tip = check_component(kind, space_id, document, actor)
                stored = repo.write(
                    space_id,
                    ident,
                    document,
                    expected_revision=None,
                    actor=actor,
                    kind=kind,
                    expected_head=checked_tip,
                )
                assert index is not None
                new_row = SharedRow.of(kind, space_id, stored)
                row: SharedRow | None = new_row
                try:
                    index.upsert(new_row)
                except SQLAlchemyError:
                    log.warning("shared content index not updated")
                    row = None
                response = present(space_id, stored, row, set(), kind, stored.revision.commit)
                response.status_code = 201
                return response

            return await asyncio.to_thread(retry_head, work)

        @app.get(path)
        def listing(request: Request, space_id: str) -> JSONResponse:
            access, actor = active(request, space_id)
            repo = depot()
            tip = repo.head()
            if tip is None:
                return JSONResponse({f"{kind.name}s": [], "unreadable": 0})
            assert index is not None
            try:
                rows = index.rows(kind.name, space_id)
            except SQLAlchemyError:
                raise ContentError(CONTENT_UNAVAILABLE, "index_unavailable") from None
            items = []
            unreadable = 0
            for row in rows:
                accepted: set[int] = set()
                try:
                    accepted = approvals(space_id, row.content_id, kind, tip)
                    glance = repo.glance(space_id, row.content_id, at=tip, kind=kind)
                    if glance.owner is None or glance.deleted:
                        continue
                    history = repo.history(space_id, row.content_id, at=tip, kind=kind)
                    number = latest_visible(
                        (entry.number for entry in history if entry.action == "save"),
                        access.role,
                        actor,
                        glance.owner,
                        accepted,
                    )
                    if number is None:
                        continue
                    saved = repo.read(space_id, row.content_id, number, at=tip, kind=kind)
                    items.append(
                        {
                            "id": saved.document["id"],
                            "name": saved.document["name"],
                            "owner": saved.document["owner"],
                            "revision": number,
                            "commit": saved.revision.commit,
                            "committed_at": saved.revision.committed_at.isoformat(),
                            "state": "approved" if number in accepted else "draft",
                            "approved_revision": max(accepted, default=None),
                            "index_state": "indexed"
                            if row.commit == history[-1].commit
                            and row.approved_revision == max(accepted, default=None)
                            else "index_stale",
                        }
                    )
                except ContentError as error:
                    if error.code == kind.not_found:
                        continue
                    if error.code != CONTENT_UNAVAILABLE or error.reason not in DAMAGED_REASONS:
                        raise
                    if (
                        row.owner == actor
                        or (access.role is not None and access.role.allows(Role.ADMIN))
                        or accepted
                    ):
                        unreadable += 1
                    continue
            items.sort(key=lambda item: (item["name"].casefold(), item["id"]))
            return JSONResponse({f"{kind.name}s": items, "unreadable": unreadable})

        @app.get(path + "/{content_id}")
        def read(
            request: Request, space_id: str, content_id: str, revision: str | None = None
        ) -> JSONResponse:
            access, actor = active(request, space_id)
            number = None if revision is None else _version(revision, "revision")
            stored, row, accepted, current_commit = checked(
                space_id, content_id, kind, actor, access, number
            )
            return present(space_id, stored, row, accepted, kind, current_commit)

        @app.get(path + "/{content_id}/consumers")
        def get_consumers(request: Request, space_id: str, content_id: str) -> JSONResponse:
            access, actor = active(request, space_id)
            stored, _, _, _ = checked(space_id, content_id, kind, actor, access, None)
            if kind is PAGE_TEMPLATE_KIND:
                return JSONResponse({"id": content_id, "consumers": [], "others": 0})
            if consumers is None:
                raise ContentError(CONTENT_UNAVAILABLE, "index_unavailable")
            found = consumers(
                space_id, kind.name, content_id, stored.revision.number, actor, depot().head()
            )
            return JSONResponse({"id": content_id, **found.json()})

        @app.get(path + "/{content_id}/history")
        def history(request: Request, space_id: str, content_id: str) -> JSONResponse:
            """Les numéros publics restent inchangés, même lorsque des révisions sont masquées."""
            access, actor = active(request, space_id)
            _, entries, deleted = visible_history(space_id, content_id, kind, actor, access)
            return JSONResponse(
                {
                    "id": content_id,
                    "current_revision": None if deleted else entries[-1].number,
                    "deleted": deleted,
                    "revisions": [_revision_json(entry) for entry in entries],
                }
            )

        @app.get(path + "/{content_id}/diff")
        def diff(request: Request, space_id: str, content_id: str) -> JSONResponse:
            access, actor = active(request, space_id)
            first = _version(request.query_params.get("from"), "from")
            second = _version(request.query_params.get("to"), "to")
            tip, entries, _ = visible_history(space_id, content_id, kind, actor, access)
            available = {entry.number for entry in entries if entry.action == "save"}
            if first not in available or second not in available:
                raise ContentError(kind.not_found, "missing_revision")
            repo = depot()
            before = repo.read(space_id, content_id, first, at=tip, kind=kind).document
            after = repo.read(space_id, content_id, second, at=tip, kind=kind).document
            changes = kind.diff(before, after)
            return JSONResponse(
                {
                    "id": content_id,
                    "base": first,
                    "other": second,
                    "changes": changes_json(changes),
                }
            )

        @app.get(path + "/{content_id}/approvals")
        def get_approvals(request: Request, space_id: str, content_id: str) -> JSONResponse:
            access, actor = active(request, space_id)
            tip, entries, deleted = visible_history(space_id, content_id, kind, actor, access)
            if deleted:
                raise ContentError(kind.not_found, "missing")
            try:
                doc = depot().read_approvals(space_id, content_id, kind=kind, at=tip).document
            except ContentError as error:
                if error.code != "approvals_not_found":
                    raise
                return JSONResponse({"id": content_id, "approvals": []})
            visible = {entry.number for entry in entries if entry.action == "save"}
            return JSONResponse(
                {
                    "id": content_id,
                    "approvals": [item for item in doc["approvals"] if item["revision"] in visible],
                }
            )

        @app.post(path + "/{content_id}/approvals")
        async def approve(request: Request, space_id: str, content_id: str) -> JSONResponse:
            _, actor = active(request, space_id, Role.ADMIN)
            if ANALYSIS_ID.fullmatch(content_id) is None:
                raise ContentError(kind.not_found, "missing")
            repo = depot()
            body = await _body(request)
            if not isinstance(body, dict) or set(body) != {"revision", "expected_revision"}:
                raise Invalid("body")
            revision = _expected(body["revision"])
            expected = _expected(body["expected_revision"])

            def work() -> JSONResponse:
                saved = repo.approve(
                    space_id,
                    content_id,
                    revision,
                    expected_revision=expected,
                    actor=actor,
                    kind=kind,
                )
                entries = saved.document["approvals"]
                previous = max(
                    (item["revision"] for item in entries if item["revision"] < revision),
                    default=None,
                )
                diff = None
                if previous is not None:
                    before = repo.read(
                        space_id, content_id, previous, at=saved.revision.commit, kind=kind
                    ).document
                    after = repo.read(
                        space_id, content_id, revision, at=saved.revision.commit, kind=kind
                    ).document
                    diff = changes_json(kind.diff(before, after))
                rows = [
                    ApprovalRow(
                        kind.name,
                        space_id,
                        content_id,
                        item["revision"],
                        PersonRef(item["approver"]["issuer"], item["approver"]["subject"]),
                        datetime.fromisoformat(item["approved_at"].replace("Z", "+00:00")),
                    )
                    for item in entries
                ]
                assert index is not None
                indexed = False
                try:
                    indexed = index.record_approvals(
                        kind.name, space_id, content_id, expected, rows
                    )
                except SQLAlchemyError:
                    log.warning("shared approvals index not updated")
                return JSONResponse(
                    {
                        "id": content_id,
                        "state": "approved",
                        "approved_revision": max(item["revision"] for item in entries),
                        "diff": diff,
                        "index_state": "indexed" if indexed else "index_stale",
                    },
                    status_code=201,
                )

            return await asyncio.to_thread(retry_head, work)

        @app.put(path + "/{content_id}")
        async def revise(request: Request, space_id: str, content_id: str) -> JSONResponse:
            access, actor = active(request, space_id)
            repo = depot()
            body = await _body(request)
            if not isinstance(body, dict):
                raise Invalid("body")
            values = dict(body)
            expected = _expected(values.pop("expected_revision", None))
            forbidden = [
                Violation(f"/{key}", "field_not_allowed") for key in SERVER_FIELDS if key in values
            ]
            if forbidden:
                raise ContentError(kind.invalid, forbidden[0].rule, tuple(forbidden))

            def work() -> JSONResponse:
                old, row, accepted, _ = checked(space_id, content_id, kind, actor, access, None)
                owner = PersonRef(old.document["owner"]["issuer"], old.document["owner"]["subject"])
                if not can_change(access.role, actor, owner):
                    raise Refused(403, "not_owner")
                if old.revision.number != expected:
                    raise ContentError("revision_conflict", "stale")
                document = kind.validate(
                    {
                        "api_version": f"board.{kind.name}/v1",
                        "id": content_id,
                        "owner": _person(owner),
                        **values,
                    }
                )
                checked_tip = check_component(kind, space_id, document, actor)
                saved = repo.write(
                    space_id,
                    content_id,
                    document,
                    expected_revision=expected,
                    actor=actor,
                    kind=kind,
                    expected_head=checked_tip,
                )
                assert index is not None
                new_row = SharedRow.of(kind, space_id, saved, max(accepted, default=None))
                try:
                    index.upsert(new_row)
                    row = new_row
                except SQLAlchemyError:
                    log.warning("shared content index not updated")
                response = present(space_id, saved, row, accepted, kind, saved.revision.commit)
                response.status_code = 200 if saved.unchanged else 201
                return response

            return await asyncio.to_thread(retry_head, work)

        @app.delete(path + "/{content_id}")
        def remove(
            request: Request, space_id: str, content_id: str, expected_revision: str | None = None
        ) -> Response:
            access, actor = active(request, space_id)
            repo = depot()
            expected = _expected(_digits(expected_revision))
            if ANALYSIS_ID.fullmatch(content_id) is None:
                raise ContentError(kind.not_found, "missing")
            tip = repo.head()
            if tip is None:
                raise ContentError(kind.not_found, "missing")
            glance = repo.glance(space_id, content_id, at=tip, kind=kind)
            if glance.owner is None or glance.deleted:
                raise ContentError(kind.not_found, "missing")
            if not can_change(access.role, actor, glance.owner):
                checked(space_id, content_id, kind, actor, access, None)
                raise Refused(403, "not_owner")
            old = repo.read(space_id, content_id, at=tip, kind=kind)
            if old.revision.number != expected:
                raise ContentError("revision_conflict", "stale")

            def attempt() -> Response | Revision | None:
                current_tip = repo.head()
                if kind is not PAGE_TEMPLATE_KIND:
                    if consumers is None:
                        raise ContentError(CONTENT_UNAVAILABLE, "index_unavailable")
                    dependents = consumers(
                        space_id, kind.name, content_id, expected, actor, current_tip
                    )
                    if dependents:
                        return _error(409, "content_in_use", **dependents.json())
                try:
                    return repo.delete(
                        space_id,
                        content_id,
                        expected_revision=expected,
                        actor=actor,
                        expected_head=current_tip,
                        kind=kind,
                    )
                except ContentError as error:
                    if error.code != "revision_conflict" or error.reason != "head_changed":
                        raise
                    return None

            outcome = attempt()
            if outcome is None:
                outcome = attempt()
                if outcome is None:
                    raise ContentError("revision_conflict", "stale")
            if isinstance(outcome, Response):
                return outcome
            removed = outcome
            assert index is not None
            try:
                index.remove(kind.name, space_id, content_id, removed.number)
            except SQLAlchemyError:
                log.warning("shared content index not updated")
            return Response(status_code=204)

    for content_kind, segment in (
        (THEME_KIND, "themes"),
        (PAGE_TEMPLATE_KIND, "page-templates"),
        (COMPONENT_KIND, "components"),
    ):
        install(content_kind, segment)
