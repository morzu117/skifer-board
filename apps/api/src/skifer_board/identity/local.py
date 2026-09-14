"""The board's own local identity: never derived from an incoming request (F1.5)."""

import getpass
from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class LocalIdentity:
    subject: str
    consumer_class: Literal["dashboard"]


def local_identity() -> LocalIdentity:
    """Return the board's local identity; `subject` falls back to `"unknown"` if the OS omits it."""
    try:
        subject = getpass.getuser()
    except OSError:
        subject = "unknown"
    return LocalIdentity(subject=subject, consumer_class="dashboard")
