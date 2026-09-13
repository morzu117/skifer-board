"""Entry points validating a Dashboard as YAML v1 document or file."""

from pathlib import Path
from typing import Any

from skifer_board.dashboard_spec.issues import ValidationIssue
from skifer_board.dashboard_spec.loader import DashboardLoadError, load_dashboard
from skifer_board.dashboard_spec.semantic import semantic_issues
from skifer_board.dashboard_spec.structural import structural_issues


def validate_document(document: Any) -> list[ValidationIssue]:
    """Return the structural issues of `document`, or its semantic issues if it has none."""
    issues = structural_issues(document)
    if issues:
        return issues
    return semantic_issues(document)


def validate_file(path: str | Path) -> list[ValidationIssue]:
    """Load a YAML dashboard file and validate it; load failures are returned as issues."""
    try:
        document = load_dashboard(path)
    except DashboardLoadError as error:
        return [error.issue]
    return validate_document(document)
