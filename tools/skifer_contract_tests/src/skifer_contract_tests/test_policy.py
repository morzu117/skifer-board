"""Contract: certification decisions beyond the nominal ALLOW path (D15).

`DENY` on `finance.invoices` is covered by `test_query.py`; it is not duplicated here.
"""

from typing import Any

import httpx

from skifer_contract_tests.assertions import assert_error


def query_body(model: str, metric: str) -> dict[str, Any]:
    return {"model": model, "metrics": [metric]}


def test_warn_model_returns_rows_with_reasons(
    skifer: httpx.Client, auth_headers: dict[str, str], warn_model: str
) -> None:
    view = skifer.get(f"/models/{warn_model}", headers=auth_headers).json()
    body = query_body(warn_model, view["metrics"][0])
    response = skifer.post("/query", json=body, headers=auth_headers)
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["rows"]
    assert payload["evidence"]["policy"]["decision"] == "WARN"
    assert payload["evidence"]["policy"]["reasons"]


def test_require_human_model_is_denied_without_rows(
    skifer: httpx.Client, auth_headers: dict[str, str], require_human_model: str
) -> None:
    view = skifer.get(f"/models/{require_human_model}", headers=auth_headers).json()
    body = query_body(require_human_model, view["metrics"][0])
    response = skifer.post("/query", json=body, headers=auth_headers)
    error = assert_error(response, 403, "SemanticAccessDenied")
    assert error["decision"] == "REQUIRE_HUMAN"
    assert error["reasons"]
    assert isinstance(error["evaluated_at"], str) and error["evaluated_at"]
    assert "recommended_action" in error
    assert "rows" not in response.json()
    assert "rows" not in error
