"""The board's own local identity: never derived from an incoming request (F1.5)."""

import getpass
from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class LocalIdentity:
    subject: str
    consumer_class: Literal["dashboard"]


def local_identity() -> LocalIdentity:
    """Return the board's local identity; `subject` falls back to `"unknown"` if the OS omits it.

    On Python 3.12, getpass.getuser() may raise KeyError (UID absent) or ImportError (pwd
    module missing on Windows); both are treated the same as OSError and fallback to "unknown".
    """
    try:
        subject = getpass.getuser()
    except (OSError, KeyError, ImportError):
        subject = "unknown"
    return LocalIdentity(subject=subject, consumer_class="dashboard")
