"""Async client to skifer's public API (SK-02): the board's only access to skifer data (I2).

No SQL, no cache, no retry, no logging of the bearer token. Errors are generic in this module
(`SkiferClientError`); typed errors per SK-02.5 arrive in 4.2.
"""

from collections.abc import AsyncIterator, Mapping
from types import TracebackType
from typing import Any, Self, TypeVar

import httpx
from pydantic import BaseModel, JsonValue, ValidationError

from skifer_board.skifer_client.dto import (
    GovernedModelView,
    Identity,
    ModelPage,
    ModelSummary,
    QueryRequest,
    QueryResult,
)
from skifer_board.skifer_client.errors import SkiferClientError

API_PREFIX = "/api/v1"

ModelT = TypeVar("ModelT", bound=BaseModel)


class SkiferClient:
    """The board's only access to skifer data; the bearer is supplied by the caller (I2)."""

    def __init__(
        self,
        base_url: str,
        token: str,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        timeout: float = 10.0,
    ) -> None:
        self._http = httpx.AsyncClient(
            base_url=base_url.rstrip("/") + API_PREFIX,
            headers={"Authorization": f"Bearer {token}"},
            transport=transport,
            timeout=timeout,
        )

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        await self._http.aclose()

    @staticmethod
    def _decode(response: httpx.Response) -> object:
        value: object = response.json()
        return value

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: Mapping[str, str | int] | None = None,
        json: Mapping[str, JsonValue] | None = None,
    ) -> httpx.Response:
        response = await self._http.request(method, path, params=params, json=json)
        if response.is_success:
            return response
        try:
            body = self._decode(response)
        except ValueError:
            body = response.text
        raise SkiferClientError(response.status_code, body)

    def _parse(self, model: type[ModelT], response: httpx.Response) -> ModelT:
        try:
            payload = self._decode(response)
        except ValueError as error:
            raise SkiferClientError(response.status_code, response.text) from error
        try:
            return model.model_validate(payload)
        except ValidationError as error:
            raise SkiferClientError(response.status_code, payload) from error

    async def health(self) -> bool:
        response = await self._request("GET", "/health")
        payload = self._decode(response)
        return bool(isinstance(payload, dict) and payload.get("status") == "ok")

    async def me(self) -> Identity:
        response = await self._request("GET", "/me")
        return self._parse(Identity, response)

    async def list_models(self, cursor: str | None = None, limit: int = 50) -> ModelPage:
        params: dict[str, str | int] = {"limit": limit}
        if cursor is not None:
            params["cursor"] = cursor
        response = await self._request("GET", "/models", params=params)
        return self._parse(ModelPage, response)

    async def iter_models(self, limit: int = 100) -> AsyncIterator[ModelSummary]:
        cursor: str | None = None
        while True:
            page = await self.list_models(cursor=cursor, limit=limit)
            for item in page.items:
                yield item
            if page.next_cursor is None:
                return
            cursor = page.next_cursor

    async def get_model(self, key: str) -> GovernedModelView:
        response = await self._request("GET", f"/models/{key}")
        return self._parse(GovernedModelView, response)

    async def query(self, request: QueryRequest, limit: int = 100) -> QueryResult:
        body: dict[str, Any] = request.model_dump(mode="json", exclude_none=True)
        response = await self._request("POST", "/query", params={"limit": limit}, json=body)
        return self._parse(QueryResult, response)
