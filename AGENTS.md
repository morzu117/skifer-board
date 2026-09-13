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
