"""Safe YAML loading of Dashboard as YAML documents.

Only `yaml.safe_load` is used. A text that is not readable YAML, or whose root is not a mapping,
is reported as a single structural `SCHEMA_VIOLATION` issue at the root path, carried by
`DashboardLoadError`. `validate_file` returns that issue instead of raising, so no exception
reaches its caller.
"""

from pathlib import Path
from typing import Any

import yaml

from skifer_board.dashboard_spec.issues import ValidationIssue


class DashboardLoadError(ValueError):
    """The document could not be loaded as a YAML mapping."""

    def __init__(self, issue: ValidationIssue) -> None:
        super().__init__(issue.message)
        self.issue = issue


def _load_error(message: str) -> DashboardLoadError:
    one_line = " ".join(message.split())
    return DashboardLoadError(
        ValidationIssue(layer="structural", code="SCHEMA_VIOLATION", path="", message=one_line)
    )


def load_dashboard_text(text: str) -> Any:
    """Parse a dashboard from YAML text; raise `DashboardLoadError` if it is not a mapping."""
    try:
        document = yaml.safe_load(text)
    except yaml.YAMLError as error:
        raise _load_error(f"document is not valid YAML: {error}") from error
    if not isinstance(document, dict):
        raise _load_error(f"document root must be a mapping, got {type(document).__name__}")
    return document


def load_dashboard(path: str | Path) -> Any:
    """Parse a dashboard from a UTF-8 YAML file; raise `DashboardLoadError` if unreadable."""
    try:
        text = Path(path).read_text(encoding="utf-8")
    except UnicodeDecodeError as error:
        raise _load_error(f"document is not valid UTF-8: {error}") from error
    return load_dashboard_text(text)
