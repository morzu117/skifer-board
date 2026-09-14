"""JSON Schema of Dashboard as YAML v1, loaded once per process.

The schema file is located relative to this module, by walking up its parent directories until
one holds `packages/dashboard-spec/schema/dashboard.v1.json` — never from the current working
directory.

Known limitation: this lookup assumes the monorepo layout. Shipping the schema inside a
deployable distribution is left to a later packaging step.
"""

import json
from functools import cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

SCHEMA_RELATIVE_PATH = Path("packages") / "dashboard-spec" / "schema" / "dashboard.v1.json"


def schema_path() -> Path:
    """Return the path of the v1 schema file, found from this module's location."""
    for directory in Path(__file__).resolve().parents:
        candidate = directory / SCHEMA_RELATIVE_PATH
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(f"{SCHEMA_RELATIVE_PATH} not found above {Path(__file__).resolve()}")


@cache
def load_schema() -> dict[str, Any]:
    """Return the parsed v1 schema."""
    schema: dict[str, Any] = json.loads(schema_path().read_text(encoding="utf-8"))
    return schema


@cache
def schema_validator() -> Draft202012Validator:
    """Return the draft 2020-12 validator for the v1 schema, built once."""
    return Draft202012Validator(load_schema())
