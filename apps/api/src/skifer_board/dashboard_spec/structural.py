"""Structural layer: JSON Schema validation of Dashboard as YAML v1."""

from typing import Any

from skifer_board.dashboard_spec.issues import ValidationIssue, json_pointer
from skifer_board.dashboard_spec.schema import schema_validator


def structural_issues(document: Any) -> list[ValidationIssue]:
    """Return every schema violation of `document`, sorted by path then message."""
    issues = [
        ValidationIssue(
            layer="structural",
            code="SCHEMA_VIOLATION",
            path=json_pointer(error.absolute_path),
            message=error.message,
        )
        for error in schema_validator().iter_errors(document)
    ]
    return sorted(issues, key=lambda issue: (issue.path, issue.message))
