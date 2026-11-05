"""Fixtures partagées des tests du dépôt de contenus et des routes des analyses (plan 18)."""

from catalog.conftest import espace as espace
from catalog.conftest import service as service
from identity.conftest import cles as cles
from identity.conftest import config as config
from identity.conftest import fournisseur as fournisseur
from identity.conftest import horloge as horloge
from spaces.conftest import moteur_hors_utc as moteur_hors_utc
from spaces.monde import config_plateforme as config_plateforme
from spaces.monde import monde as monde
from state.conftest import migre as migre

from .serveur import banc as banc
from .serveur import banc_sans_depot as banc_sans_depot
