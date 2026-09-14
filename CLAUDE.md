# CLAUDE.md — skifer-board

## Contexte

**skifer-board** est la suite de [skifer](../skifer) : une plateforme de **self-BI agentique**
auto-hébergée. Dashboards personnalisés, rapports ad-hoc, et une reporting suite du type
Power BI / Looker, mais sans dépendre d'aucune plateforme logicielle commerciale : une instance
GCP, Azure ou autre, et on est autonome.

skifer centralise la **transformation** et la **couche sémantique** avec une approche déclarative
(le *What* en YAML, strictement découplé du *How* en Python). skifer-board est la **couche de
consommation** de cette couche sémantique. Il ne la remplace jamais, ne la contourne jamais.

Le dépôt skifer est un frère de ce dossier : `../skifer`. Lire son `CLAUDE.md` avant toute
décision d'architecture — il décrit précisément la frontière que le board consomme.

## Décisions déjà prises (2026-09-13)

| Décision | Choix |
|---|---|
| Dépôt | Séparé de skifer, ici. Couplage avec skifer **par HTTP uniquement** (REST + MCP). Spark n'entre jamais dans le board. |
| Socle graphique | **Pas Plotly Dash** : c'est un framework d'applications Python (un dashboard = du code), sans self-service ni spec déclarative. Contraire au principe What vs How. |
| Format des dashboards | **Dashboard as YAML** : une tuile = une `SemanticQuery` (noms de dimensions, métriques, filtres, période — jamais de SQL) + une spec de visualisation. Généré par l'agent, éditable par un humain, versionné par git. |
| Renderer | **Tranché en temps 2.** Options : construire sur ECharts (Apache 2.0) / Vega-Lite (BSD), ou s'appuyer sur Apache Superset pour les dashboards classiques et concentrer le board sur l'ad-hoc et l'agentique. |
| KPI prêts à l'emploi | Pas de dépendance externe (il n'existe pas de bibliothèque open source de KPI réutilisables). Ce seront des **KPI packs** déclaratifs : modèle sémantique template + dashboards template par domaine, à la manière des Looker Blocks. |

## Ce que skifer fournit déjà (à consommer, pas à reconstruire)

Tout est dans `../skifer/src/skifer/` :

- **Requête sémantique sans SQL émis par un LLM** : `agentic/resolver.py` (`QueryResolver`),
  `semantic/planner` (`SemanticPlanner`, chemins de jointure, sécurité de grain, calendriers).
- **Preuve par requête** : `SemanticEngine.query_with_evidence()` → `SemanticEvidence`
  (hash `sha256:v1:` du SQL exécuté, hashs de définition des métriques, lineage, snapshot de
  certification, décision de policy, durée). La **ligne de provenance** devient le pied de
  chaque tuile. Le hash du SQL est la **clé de cache naturelle** des résultats.
- **Gate de certification fail-closed** : `semantic/access_policy.py`, `ConsumerContext`,
  `consumer_class`, `off | warn | enforce | supervised`.
- **La frontière de sécurité** : `agentic/data_service.py` (`AgentReadyDataService`) — scopes
  `models:read`, `contracts:read`, `lineage:read`, `query:execute`, plafonds durs
  (`ServiceLimits`), DTO par allowlist, pagination opaque. **Le board ne parle qu'à ça.**
- **MCP read-only** : `mcp/` (stdio / http, bind loopback obligatoire, bearer injecté).
- **Agent GenBI** : `agentic/agent.py` (`GenBIAgent`), `agentic/hub.py` (`AgenticHub`),
  serving MLflow dans `serving/`.
- **Adaptive Gold** : `adaptive/` — les événements d'usage des dashboards seront la première
  source de volume de cette boucle (proposition → PR → évaluation).
- **Briques réutilisables pour la reporting suite** : `agentic/exporter.py` (PDF via fpdf2),
  `observability/alerts.py` (`AlertDispatcher`).
- **Statement Execution API Databricks** déjà utilisée pour les materialized views
  (`params.sql_warehouse_id`) — même mécanisme pour exécuter sans Spark.
- **Couche applicative + API locale (Plan 31 skifer, mergé le 2026-09-13 sur `main`)** : `services/`
  (projet, règles, gouvernance, qualité, sémantique, agents, exécution — tous derrière un
  `RequestContext` et des scopes nommés) et `api/` (FastAPI **loopback uniquement**, extra `[api]`,
  `skifer api serve|openapi`, routes 1:1 avec les services : `api/routes/semantic.py`, `catalog.py`,
  `certifications.py`, `lineage.py`, `dictionary.py`, `jobs.py`…). `services/identity.py`
  (`LocalIdentity`) dérive le sujet de l'OS : l'autorité ne vient jamais de la requête.
  **C'est le point de départ de l'API que `skifer_client` consomme**, mais elle est locale
  (loopback, identité OS) — pas encore une API distante multi-utilisateurs.

## Ce qui manque, et où ça se construit

### Côté skifer (prérequis, plan `docs/roadmap/35B_*` dans skifer — pas ici)

1. **Backend d'exécution sans Spark** : Databricks SQL warehouse (Statement Execution API) en
   prod, DuckDB + delta-rs en local / petite instance. Le SQL de `QueryResolver` est du Spark
   SQL → transpilation de dialecte (sqlglot, MIT).
2. **Exposition distante de l'API Plan 31** : aujourd'hui loopback + `LocalIdentity`. Il faut un
   bind non-loopback derrière une auth réelle (bearer vérifié par un vérificateur injecté, comme
   `mcp/auth.py`), et un format colonnaire pour les résultats (Arrow IPC de préférence). Une seule
   frontière : l'API n'expose rien d'autre que les services.
3. **Identité utilisateur** : mapping SSO → `RequestContext` / `ConsumerContext` (consumer class,
   scopes), et row-level security, qui n'existe pas encore.

⚠️ Ne pas démarrer ce travail dans `../skifer` sans accord explicite : un autre chantier y est
en cours sur une autre machine.

### Côté skifer-board (ici)

Phases validées, dans l'ordre :

2. **Dashboard as YAML + renderer** : spec du format, validation, rendu web, pied de provenance
   par tuile, cache de résultats clé = hash du SQL, invalidation sur `source_definition_hash`.
3. **Explorateur ad-hoc sans LLM** : choisir modèle, dimensions, métriques, filtres → graphique.
   (Équivalent de l'*explore* Lightdash.) Ne dépend d'aucun LLM.
4. **Agentique** : chat → `SemanticQuery` + spec de viz → « épingler au dashboard ».
5. **Reporting suite** : planification, exports PDF, abonnements, alertes.
6. **KPI packs**.

La phase 2 peut démarrer sans attendre skifer : la spec YAML des dashboards ne dépend d'aucun
code skifer, seulement de la forme d'une `SemanticQuery`.

## Projets open source à étudier avant de construire

| Projet | Licence | Pourquoi |
|---|---|---|
| Lightdash | MIT | Le plus proche du produit visé (BI sur couche sémantique dbt). Étudier l'UX d'exploration. Forker = gros chantier TypeScript lié à dbt. |
| Rill | Apache 2.0 | BI-as-code, metrics view YAML, DuckDB. Très aligné sur la philosophie et le mode local. |
| Evidence | MIT | Rapports as code (markdown + SQL). Gain rapide pour la reporting suite statique. |
| Apache Superset | Apache 2.0 | Solution de repli complète pour les dashboards classiques. Défaut : sa propre couche sémantique doublonnerait skifer. |
| Perspective (FINOS) | Apache 2.0 | Pivots et viz haute performance dans le navigateur, utile pour l'ad-hoc. |
| ECharts / Vega-Lite | Apache 2.0 / BSD | Grammaires de viz déclaratives, candidats naturels pour le « How » du renderer. |
| sqlglot | MIT | Transpilation Spark SQL → DuckDB. |

Vérifier les licences au moment de l'adoption ; ce tableau date du 2026-09-13.

## Stack pressentie

- **Front** : Next.js / React 19 / Tailwind / shadcn / zustand — même stack que
  `../klasso/apps/web`, à réutiliser comme référence de conventions.
- **Back** (si nécessaire au-delà de l'API skifer) : Python, FastAPI. Le board ne dépend pas
  de `pyspark`.
- Choix définitifs à figer dans le premier plan.

## Conventions héritées de skifer

- **Plans de développement** dans `docs/roadmap/<NN>_<feature>_plan.md` : contexte, phases avec
  fichiers créés/modifiés, risques, stratégie de vérification. Le plan est **commité avant tout
  code** et attend la **validation explicite** de l'utilisateur.
- Un point de plan = un commit, message référençant le plan (`feat(plan01-2.1): ...`).
- Toute modification de code = test associé + entrée dans `CHANGELOG.md` sous `[Unreleased]`.
- **Ne jamais bumper la version** : l'utilisateur gère le versioning.
- Les appels LLM sont toujours mockés en test ; aucun réseau, aucune clé, aucun cluster.

## Premières tâches pour la session qui démarre ici

1. Lire `../skifer/CLAUDE.md`, `../skifer/src/skifer/agentic/data_service.py`, `../skifer/src/skifer/api/`
   et `../skifer/src/skifer/services/` (Plan 31). Si `../skifer` n'existe pas sur la machine :
   `git clone https://github.com/morzu117/skifer.git ../skifer`.
2. Écrire `docs/roadmap/01_skifer_board_foundation_plan.md` : format dashboard-as-YAML,
   architecture du board, contrat attendu de l'API skifer (pour que le plan 35B côté skifer
   soit écrit à partir des besoins réels du board), choix de stack.
3. Attendre la validation avant de coder.

<!-- agentkit:start 0.5.3 -->

## Chaîne agent — skifer-board

Rendu depuis agent-kernel 0.5.3. Ne pas éditer à la main :
toute modification est écrasée au prochain `/sync`. Pour changer ce bloc,
modifier le noyau ou `agent.yml`.

### Routage de la connaissance

Pour une question donnée, il y a **exactement un** premier point d'entrée.
Interroger deux sources « au cas où » double le coût au lieu de le diviser.

| La question porte sur | Premier appel | Interdit |
|---|---|---|
| Ce que le code fait, où c'est défini, qui appelle quoi, impact d'un changement | `codegraph_explore` | grep, lecture de fichier, sous-agent d'exploration |
| Pourquoi une décision, ce qui a été tenté, l'état d'un cycle | `gbrain search` | relire l'historique git |
| Comment on travaille, quelle phase fait quoi | ce bloc | tout appel |
| Rien ne répond | lecture directe | — |

**Deux règles à ne pas violer :**

Le source rendu par `codegraph_explore` est **déjà lu**.
Ne pas le re-vérifier au grep.

**Ne jamais déléguer l'exploration du code à un sous-agent.** L'index n'aide
que s'il est interrogé directement ; un sous-agent qui lit des fichiers
annule le bénéfice. La phase qui doit comprendre le code l'interroge
elle-même.

### Quand une capacité ne répond pas

Ce bloc est **commité**. Il sera donc lu dans des environnements que le rendu
n'a pas inspectés : un worktree, un conteneur, une machine sans l'outillage.
La vérification faite au `/sync` vaut pour la machine qui a rendu, pas pour
celle qui lit.

La règle d'exclusivité vaut **là où la capacité répond**. Là où elle ne
répond pas, la table de routage retombe sur sa dernière ligne — lecture
directe. Deux conditions, non négociables :

**Dis-le.** Nomme la capacité absente dans ton handoff. Un agent qui retombe
silencieusement sur le grep rend un travail qui ressemble au travail normal
sans en avoir les garanties : le rayon d'impact déclaré n'en est plus un, et
la review vérifie un contrat qui n'existe pas.

**Ne fais pas semblant.** Ne présente pas une lecture de fichiers comme un
rayon d'impact. La phase plan dit explicitement qu'il n'a pas pu être établi ;
la review sait alors qu'elle n'a rien à comparer.

L'index momentanément en retard sur une écriture est un cas particulier de
capacité qui ne répond pas — même conduite.

### Règle d'hygiène mémoire

Si l'information est dérivable du code, elle n'a rien à faire en mémoire.
Une page qui décrit qui appelle quoi sera fausse dans deux semaines et
duplique ce que l'index donne à jour. La mémoire sert à ce qui n'est pas
dans le code : les intentions, les options écartées, les pièges appris.

Si la réponse obtenue est durable **et non dérivable du code**, elle remonte
en mémoire avant la fin de la phase.

### Phases

| Phase | Lit | Écrit |
|---|---|---|
| plan | la demande, `lesson:` pertinents, l'index structurel | `skifer-board:plan:<task>` |
| dev | `skifer-board:plan:<task>`, l'index structurel | `skifer-board:dev-handoff:<task>` |
| review | `skifer-board:plan:<task>`, `skifer-board:dev-handoff:<task>`, le diff, l'index structurel | `skifer-board:review:<task>` |
| triage | `skifer-board:review:<task>` | rien — elle route |
| retro | les trois pages du cycle | `skifer-board:retro:<cycle>`, et zéro ou plusieurs `lesson:<domaine>:<slug>` |

Les agents ne s'échangent rien latéralement — ils se coordonnent par les
pages mémoire, par git et par le document de plan. L'orchestrateur lance les
agents de phase ; c'est le seul appel direct de la chaîne.

### Definition of Done

Quatre points, tous obligatoires, avant de rendre la main :

**1. Le commit existe** sur la branche courante. Un point de plan est un
commit. Du travail non commité est du travail non rendu.

**2. Le gate de la couche touchée est vert**, lancé **en entier** — pas un
sous-ensemble, pas « les tests qui semblent pertinents ». Un gate partiel
rate les dérives d'artefacts générés.

**api**

```bash
pnpm run check:api
```

**spec**

```bash
pnpm run check:spec
```

**web**

```bash
pnpm run check:web
```

**docs**

```bash
python -c "import pathlib,yaml; [yaml.safe_load(p.read_text()) for p in pathlib.Path('.').rglob('*.y*ml') if not {'node_modules','.venv'} & set(p.parts)]" && grep -q '^## \[Unreleased\]' CHANGELOG.md
```

**3. Le diff est resté dans le périmètre** — voir ci-dessous.

**4. Le handoff est écrit**, selon la phase.

### Contrainte de périmètre (stricte)

**Insertion-only.** N'ajoute que ce que la sous-tâche demande. Ne reformate
pas, ne réindente pas, ne touche à aucune ligne existante hors cible.

Le contrôle est mécanique, pas déclaratif :

```bash
git --no-pager show <COMMIT> | grep -E "^-" | grep -vE "^---" | wc -l
```

Proche de zéro. Toute suppression de ligne existante hors en-têtes est un
dépassement — reformatage automatique, refactor non demandé — et vaut revert
ou escalade.

Ne modifie ni le manifeste, ni la configuration du projet, ni la CI sans que
le brief le demande. Ne bump aucune version.

### Échec pré-existant

Un gate rouge sur quelque chose que ton diff ne touche pas ne te bloque pas.
Trois conditions, toutes obligatoires :

**Le prouver** — rejouer le test sur la base, sans ton diff. Sans la
démonstration, l'échec est le tien.

**Le signaler** — fichier, message exact, depuis quand. Dans le handoff. Un
échec remarqué et non signalé est un échec de DoD.

**Ne pas le contourner** — aucun `skip`, aucun test exclu, aucun seuil
abaissé, aucune assertion retirée. Rendre un test vert en supprimant ce qu'il
vérifiait n'est pas un raccourci.

### Escalade

Remontent à l'humain, et rien d'autre : un finding de conception ou
d'architecture, un dépassement de périmètre, une sous-tâche encore rouge
après 2 re-dev, un garde-fou budget atteint, une
ambiguïté irréductible du besoin ou du plan.

Le reste se déroule et se présente à la fin.

### Pages mémoire

```
skifer-board — pages cycliques du projet
  skifer-board:plan:<task>
  skifer-board:dev-handoff:<task>
  skifer-board:review:<task>
  skifer-board:retro:<cycle>

lessons — espace partagé, transverse
  lesson:<domaine>:<slug>
```

`<task>` est un slug stable sur tout le cycle : il relie les quatre pages.

Les pages préfixées `skifer-board:` sont cycliques et se purgent une
fois la rétro faite. Les pages `lesson:` sont **transverses, sans préfixe
projet, et écrites dans un espace partagé** — c'est la seule couche qui
s'accumule, et la seule façon qu'une leçon apprise ici serve ailleurs. Une
`lesson:` écrite dans l'espace du projet est une leçon perdue. Seule la phase
retro y écrit.

### Capacités

#### `structural_index` — codegraph

**Appel**

```
codegraph_explore    (MCP, agent principal)
codegraph explore    (CLI, sous-agents et harnais sans MCP)
```

Un appel rend le source verbatim des symboles pertinents groupés par fichier,
les chemins d'appel entre eux — sauts de dispatch dynamique inclus — et un
résumé du rayon d'impact.

Le reste de la surface, par ordre d'utilité :

```bash
codegraph impact <symbole>       # ce qu'un changement de ce symbole touche
codegraph affected <fichiers…>   # les fichiers de test concernés
codegraph callers <symbole>      # qui l'appelle
codegraph callees <symbole>      # ce qu'il appelle
codegraph node <symbole|fichier> # un symbole et sa trace d'appels
codegraph query <recherche>      # trouver un symbole par son nom
codegraph context <tâche…>       # symboles et relations pour une tâche
```

**Par phase**

| Phase | Usage |
|---|---|
| plan | `codegraph impact <symbole>` → le rayon d'impact va dans la page de plan |
| dev | `codegraph_explore` pour comprendre avant de modifier |
| review | `codegraph affected` → les tests à faire tourner ; comparaison du diff au rayon déclaré |

**Contraintes**

**Le source rendu est déjà lu.** Ne pas le re-vérifier au grep.

**Ne jamais déléguer l'exploration à un sous-agent.** L'outil n'aide que
s'il est interrogé directement.

**Bannière de péremption.** Après une écriture de fichier, une fenêtre courte
existe pendant laquelle l'index n'a pas rattrapé. Les réponses portent alors
une bannière nommant les fichiers en attente — la lire et ouvrir le fichier
directement quand elle apparaît.

#### `memory` — gbrain

**Appel**

```bash
gbrain search "<termes>" --source <source>          # recherche par mots-clés
gbrain query "<question>" --source <source>         # recherche hybride
gbrain put <slug> --content "…" --source <source>   # écrire une page
echo "<contenu>" | gbrain put <slug> --source <source>
```

Avant d'écrire, chercher : une page existante sur le même sujet se met à jour
plutôt que de se dupliquer.

**Contraintes**

**Rien de dérivable du code.** C'est la règle qui détermine si la mémoire
reste utile ou pourrit. Voir `policy/routing.md`.

**Écriture aux frontières de phase seulement.** Pas d'écriture opportuniste
en cours de travail — ça produit du volume sans validation.

**`lesson:` en rétro uniquement.** Aucune autre phase ne touche à l'espace
transverse.

#### `dev_agent` — claude-dev

**Appel**

Le brief passe par un fichier : il contient des backticks, des guillemets et
des dollars qui se font manger au passage du shell.

```bash
claude -p "$(cat /tmp/brief.txt)" --permission-mode bypassPermissions --strict-mcp-config --mcp-config .mcp.json --model <MODEL> --max-budget-usd <BUDGET> --output-format json --no-session-persistence < /dev/null
```

| Flag | Rôle |
|---|---|
| `-p` | one-shot programmatique ; `claude` lit `CLAUDE.md` du projet nativement (le bloc rendu) |
| `--permission-mode bypassPermissions` | miroir du `--dangerously-bypass-approvals-and-sandbox` de Codex : aucun prompt en mode `-p`, sinon chaque `Bash` est refusé et le dev rend un travail à moitié |
| `--strict-mcp-config --mcp-config .mcp.json` | seuls les serveurs MCP du **projet** (l'index structurel) ; sans lui les ~150 outils MCP de l'opérateur entrent dans chaque tour (mesuré : 0,58 $ le tour à vide) |
| `--model <MODEL>` | `models.trivial` / `standard` / `complex` du manifeste |
| `--max-budget-usd <BUDGET>` | garde-fou budget : trivial 2, standard 8, complexe 15 (dépassé ⇒ `subtype: error_max_budget_usd`, travail partiel commité ou non — relire `git status`) |
| `--output-format json` | `result` = compte rendu final du dev, `total_cost_usd` = coût réel |
| `--no-session-persistence` | rien dans `~/.claude` |

**Le `< /dev/null` n'est pas optionnel** : stdin fermé, comme pour Codex.
**Pas de `--bare`** : il saute le trousseau, le CLI répond « Not logged in ».

**Par phase**

| Phase | Usage |
|---|---|
| dev | l'intégralité de la phase |

**Contraintes**

**Aucun credential GitHub.** L'agent de dev ne pousse pas, n'ouvre pas de PR,
ne merge pas. Il commite en local sur la branche courante. Le brief le
répète ; `bypassPermissions` ne l'en dispense pas.

**Ne conçoit pas.** Si le brief est ambigu sur une décision de conception, il
s'arrête et le signale dans son handoff. Inventer une architecture est une
escalade humaine manquée.

**Même fournisseur que la review.** Le manifeste le dit ; la PR le dit.

#### `review_agent` — claude

**Appel**

Le prompt passe par un fichier, pas en argument direct : le diff contient des
guillemets et des dollars qui se font manger au passage du shell.

```bash
{ echo "<INSTRUCTIONS DE REVIEW>"; echo; echo "DIFF:"; git --no-pager show <COMMIT>; } > /tmp/rev.txt
claude -p "$(cat /tmp/rev.txt)" --tools "" --strict-mcp-config --mcp-config '{"mcpServers":{}}' --model <MODEL> --output-format json --max-budget-usd 0.50 --no-session-persistence < /dev/null
rm -f /tmp/rev.txt
```

| Flag | Rôle |
|---|---|
| `-p` | one-shot programmatique |
| `--tools ""` | aucun outil intégré : un seul tour, garde-fou anti-exploration |
| `--strict-mcp-config --mcp-config '{"mcpServers":{}}'` | aucun serveur MCP : sans lui, les schémas d'outils MCP de l'opérateur (gbrain, codegraph…) entrent dans le contexte et font exploser le budget avant le premier mot (mesuré : 0,58 $ pour un « PONG », contre 0,04 $) |
| `--model <MODEL>` | `claude-sonnet-5` pour une review standard (~0,07 $ pour un commit de taille courante) ; `claude-opus-5` sur un diff transverse |
| `--output-format json` | enveloppe JSON ; les findings sont dans le champ `result`, le coût dans `total_cost_usd` |
| `--max-budget-usd` | garde-fou budget (`guardrails.max_price` du manifeste) — dépassé, `subtype` vaut `error_max_budget_usd` et `result` est nul : relancer avec un diff plus court, pas un budget plus haut |
| `--no-session-persistence` | rien n'est écrit dans `~/.claude` |

**Pas de `--bare`** : il saute la lecture du trousseau et la session OAuth
avec — le CLI répond « Not logged in ».

Instruction utile dans le prompt : « tu as tout en ligne, tu n'as aucun
outil, juge ».

**Par phase**

| Phase | Usage |
|---|---|
| review | l'intégralité de la phase |

**Contraintes**

**Ne réécrit pas le code.** Il juge le diff qu'on lui donne.

**Reçoit le diff en ligne.** On ne lui donne pas accès au repo pour qu'il
aille chercher : c'est précisément ce qu'on borne.

**Aucun outil, aucun MCP.** `--tools ""` et le MCP vide ne sont pas
optionnels : avec des outils, `claude` lit des fichiers, lance des tests, et
le reviewer redevient un agent de dev.

### Commandes

```
test   pnpm run check
lint   python -c "import pathlib,yaml; [yaml.safe_load(p.read_text()) for p in pathlib.Path('.').rglob('*.y*ml') if not {'node_modules','.venv'} & set(p.parts)]"
```

### Contexte projet

- Charge des extraits ciblés, jamais des fichiers entiers. C'est un levier de coût, et sur une machine à mémoire contrainte c'est aussi ce qui décide si la session tient ou se fait tuer.
- Couche de consommation de la couche sémantique skifer : dashboards, exploration ad-hoc, agentique, reporting. Aucune couche sémantique propre.
- Couplage à skifer par HTTP uniquement (REST + MCP), au travers de AgentReadyDataService. Le board n'émet jamais de SQL ; Spark n'y entre jamais.
- Dashboard as YAML : une tuile = une SemanticQuery (noms uniquement) + une spec de viz sémantique, jamais d'options brutes du renderer.
- Fondation en cours (plan 01) : monorepo pnpm + uv, apps/api (FastAPI, paquet skifer_board) et apps/web (Next.js 15) ; gate `pnpm run check`.
- Plan docs/roadmap/NN_*_plan.md commité et validé avant tout code. Un point de plan = un commit feat(planNN-x.y). Toute modif = test + CHANGELOG [Unreleased]. Jamais de bump de version. LLM mocké, aucun réseau en test.
- ../skifer est modifié en parallèle sur une autre machine : n'y rien écrire sans accord explicite.

<!-- agentkit:end -->
