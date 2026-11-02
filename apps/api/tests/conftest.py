"""Profil reproductible et borné des propriétés pour le gate hors ligne."""

from hypothesis import settings

settings.register_profile("filet_contextuel", max_examples=40, deadline=None, derandomize=True)
settings.load_profile("filet_contextuel")

# Instance PostgreSQL locale et jetable, sans réseau (plan 07, P9).
pytest_plugins = ["postgres"]
