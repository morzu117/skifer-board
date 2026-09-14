"""Validation issue shared by the structural and semantic layers."""

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Literal

Layer = Literal["structural", "semantic"]


@dataclass(frozen=True)
class ValidationIssue:
    """One problem found in a dashboard document.

    `path` is a JSON Pointer (RFC 6901) to the offending location, `""` for the document root.
    """

    layer: Layer
    code: str
    path: str
    message: str


def json_pointer(parts: Iterable[str | int]) -> str:
    """Build a JSON Pointer from path segments, escaping `~` as `~0` and `/` as `~1`."""
    return "".join("/" + str(part).replace("~", "~0").replace("/", "~1") for part in parts)
