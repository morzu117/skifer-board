"""Contrat descriptif du registre de connexions (plan 12, 12.1).

Il ne porte jamais d'identifiant, de jeton, d'URL libre ou de SQL.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum

from ..spaces.model import Environment, PersonRef

NAME = re.compile(r"[a-z][a-z0-9_]{0,62}")
ENDPOINT_KEY = re.compile(r"[a-z][a-z0-9_-]{0,62}")


class Connector(StrEnum):
    DUCKDB = "duckdb"
    DATABRICKS = "databricks"


class IdentityMode(StrEnum):
    PERSON = "person"
    SERVICE = "service"


@dataclass(frozen=True)
class LogicalConnection:
    space_id: str
    name: str
    created_at: datetime
    created_by: PersonRef


@dataclass(frozen=True)
class Binding:
    space_id: str
    name: str
    environment: Environment
    connector: Connector
    endpoint_key: str
    identity_mode: IdentityMode
    set_at: datetime
    set_by: PersonRef
