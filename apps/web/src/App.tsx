import { useEffect, useState, type ReactNode } from "react";

import { AnalysePage } from "./analyses/AnalysePage";
import { AnalysesPage } from "./analyses/AnalysesPage";
import { CataloguePage } from "./catalogue/CataloguePage";
import { HistoriqueDashboard } from "./dashboards/Historique";
import { DashboardEditorPage } from "./dashboards/DashboardEditorPage";
import { DashboardsPage } from "./dashboards/DashboardsPage";
import { ExplorerPage } from "./explorer/ExplorerPage";
import { ExecutionsPage } from "./executions/ExecutionsPage";
import { logout, type Fetch } from "./identity/api";
import { LoginScreen } from "./identity/LoginScreen";
import { displayName, identityKey, loginReasonFrom } from "./identity/model";
import { useIdentity } from "./identity/useIdentity";
import { PrototypePage } from "./prototype/PrototypePage";
import { AppShell } from "./shell/AppShell";
import type { Identity } from "./shell/IdentityPill";
import { navigate, routeHash, useRoute, type Route } from "./shell/route";
import type { Environment, SectionId } from "./shell/sections";
import { SpaceSwitch } from "./shell/SpaceSwitch";
import { fetchSpace, fetchSpaces, type SpaceOutcome } from "./spaces/api";
import { CreateSpacePage } from "./spaces/CreateSpacePage";
import { ConnectionsPage } from "./spaces/ConnectionsPage";
import { onSpaceLost } from "./spaces/lost";
import { EnvironmentsPage } from "./spaces/EnvironmentsPage";
import { MembersPage } from "./spaces/MembersPage";
import { ParametersPage } from "./spaces/ParametersPage";
import { manages, SPACE_ID, type Space, type SpaceList } from "./spaces/model";
import { SpacesHome } from "./spaces/SpacesHome";
import { TelemetryPage } from "./telemetry/TelemetryPage";
import { Banner } from "./ui/Banner";
import { useRefreshed } from "./ui/useOutcome";

const NOT_FOUND = { status: "not_found" } as const;

/** Espace de la route, s'il y en a un. */
function spaceOf(route: Route): string | null {
  return route.page === "catalogue" || route.page === "members" || route.page === "environments" || route.page === "parameters" || route.page === "connections" || route.page === "executions" || route.page === "explorer" || route.page === "analyses" || route.page === "analysis" || route.page === "dashboards" || route.page === "dashboard" ? route.space : null;
}

interface Sections {
  available: ReadonlySet<SectionId>;
  pending: Partial<Record<SectionId, string>>;
}

/**
 * Entrées livrées : le catalogue (lot 04) pour un rôle dans l'espace, « Espace & connexions » pour
 * qui en gère les membres (plan 08, 8.4). Une entrée indisponible dit pourquoi, sans lien mort ; le
 * serveur reste seul juge (E7).
 */
export function sectionsFor(space: Space | null, platformAdmin: boolean): Sections {
  if (space === null) {
    return { available: new Set(), pending: { catalogue: "dans un espace", explorer: "dans un espace", analyses: "dans un espace", dashboards: "dans un espace", espace: "dans un espace" } };
  }
  const available = new Set<SectionId>();
  const pending: Partial<Record<SectionId, string>> = {};
  if (space.role === null) {
    pending.catalogue = "sans rôle";
    pending.explorer = "sans rôle";
    pending.analyses = "sans rôle";
    pending.dashboards = "sans rôle";
  } else {
    available.add("catalogue");
    // Les analyses et les dashboards vivent dans un dépôt versionné que le mode local n'a pas : comme l'Explorateur, ils lui sont fermés.
    if (!space.implicit) {
      available.add("explorer");
      available.add("analyses");
      available.add("dashboards");
    } else {
      pending.explorer = "mode local";
      pending.analyses = "mode local";
      pending.dashboards = "mode local";
    }
  }
  if (manages(space, platformAdmin)) {
    available.add("espace");
  } else {
    pending.espace = space.implicit ? "mode local" : "administrateurs";
  }
  return { available, pending };
}

/** Route de connexion du serveur quand une session est perdue pendant l'usage. */
const LOGIN_PATH = "/auth/login";

interface AppProps {
  fetcher?: Fetch;
  /** Navigation pleine page après la déconnexion ; remplaçable en test. */
  leave?: (path: string) => void;
}

function assign(path: string): void {
  window.location.assign(path);
}

export function App({ fetcher = fetch, leave = assign }: AppProps) {
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const { state, retry } = useIdentity(fetcher);

  if (state.status === "loading") {
    return (
      <main className="sb-login" aria-busy="true">
        <p role="status">Lecture de l'identité…</p>
      </main>
    );
  }
  if (state.status === "unauthenticated") {
    return <LoginScreen loginUrl={state.loginUrl} reason={loginReasonFrom(window.location.search)} />;
  }
  if (state.status === "lost") {
    return <LoginScreen loginUrl={LOGIN_PATH} reason="session_expired" />;
  }
  if (state.status === "error") {
    return (
      <main className="sb-login">
        <Banner
          tone="danger"
          action={
            <button type="button" className="sb-button" onClick={retry}>
              Réessayer
            </button>
          }
        >
          Identité indisponible : {state.message} Aucune donnée n'est affichée.
        </Banner>
      </main>
    );
  }

  const identity: Identity | null = state.status === "established" ? { name: displayName(state.identity), entity: null } : null;
  const onLogout =
    state.status === "established"
      ? () => {
          void logout(fetcher).then((outcome) => {
            if (outcome.status === "ok") {
              leave(outcome.redirect);
            } else {
              setLogoutError(outcome.message);
            }
          });
        }
      : undefined;

  return (
    <Workspace key={state.status === "established" ? identityKey(state.identity) : ""} fetcher={fetcher} identity={identity} session={state.status === "established" ? identityKey(state.identity) : ""} onLogout={onLogout}>
      {logoutError === null ? null : <Banner tone="danger">{logoutError}</Banner>}
    </Workspace>
  );
}

interface WorkspaceProps {
  fetcher: Fetch;
  identity: Identity | null;
  /** Clé stable de la session (émetteur et sujet), ou « » sans identité établie. */
  session: string;
  onLogout: (() => void) | undefined;
  /** Bandeaux de la coque, au-dessus de la page. */
  children: ReactNode;
}

type Current = { status: "loading" } | SpaceOutcome<Space> | null;

/**
 * Coque établie : l'espace courant vient de l'adresse, et le serveur le confirme avec le rôle de
 * la personne. Un espace absent ou refusé s'affiche « Espace introuvable », sans rien de plus
 * (plan 08, E7).
 */
function Workspace({ fetcher, identity, session, onLogout, children }: WorkspaceProps) {
  const [environment, setEnvironment] = useState<Environment>("DEV");
  const route = useRoute();
  const hash = routeHash(route);
  // Espace perdu pendant l'usage : relu une seule fois par navigation, pour que l'accès retiré
  // s'affiche aussitôt (E4) sans boucler si le serveur reconfirme l'espace.
  const [lost, setLost] = useState({ hash, reread: false });
  if (lost.hash !== hash) {
    setLost({ hash, reread: false });
  }
  useEffect(
    () =>
      onSpaceLost(() => {
        setLost((value) => (value.reread ? value : { ...value, reread: true }));
      }),
    [],
  );
  const reread = lost.hash === hash && lost.reread ? "relu" : "";
  // Une écriture sur les membres peut changer son propre rôle (E4) : la liste et l'espace sont
  // relus, l'ancienne réponse restant affichée pendant la relecture.
  const [revision, setRevision] = useState(0);
  // La liste est relue à chaque navigation : le sélecteur ne garde pas un espace retiré.
  const listed = useRefreshed(`spaces:${hash}:${reread}`, revision, (signal) => fetchSpaces(signal, fetcher));
  const spaceId = spaceOf(route);
  const current: Current = useRefreshed(`space:${spaceId ?? ""}:${reread}`, revision, (signal) =>
    // Un identifiant hors format (E1) ne désigne aucun espace : rien n'est demandé au serveur.
    spaceId === null ? Promise.resolve(null) : SPACE_ID.test(spaceId) ? fetchSpace(spaceId, signal, fetcher) : Promise.resolve(NOT_FOUND),
  );
  const space = current?.status === "ok" ? current.value : null;
  const platformAdmin = listed.status === "ok" && listed.value.platformAdmin;
  const sections = sectionsFor(space, platformAdmin);
  const active = route.page === "explorer" ? "explorer" : route.page === "analyses" || route.page === "analysis" ? "analyses" : route.page === "dashboards" || route.page === "dashboard" ? "dashboards" : route.page === "catalogue" ? "catalogue" : route.page === "members" || route.page === "environments" || route.page === "parameters" || route.page === "connections" ? "espace" : undefined;

  return (
    <AppShell
      workspace={space?.atlas ?? null}
      available={sections.available}
      active={active !== undefined && sections.available.has(active) ? active : undefined}
      // Les entrées ne sont offertes que dans un espace confirmé : elles mènent à ses pages.
      onNavigate={(section) => {
        if (space !== null) {
          navigate(section === "espace" ? { page: "members", space: space.id } : section === "explorer" ? { page: "explorer", space: space.id } : section === "analyses" ? { page: "analyses", space: space.id } : section === "dashboards" ? { page: "dashboards", space: space.id } : { page: "catalogue", space: space.id });
        }
      }}
      breadcrumb={breadcrumb(route, current)}
      pending={sections.pending}
      spaceSwitch={
        <SpaceSwitch
          spaces={listed.status === "ok" ? listed.value.spaces : listed.status === "loading" ? "loading" : null}
          current={space}
          onChange={(id) => {
            navigate({ page: "catalogue", space: id });
          }}
        />
      }
      environment={environment}
      onEnvironmentChange={setEnvironment}
      // L'environnement choisi reste un état de la coque (plan 09, 9.3) ; le droit vient du serveur.
      deploy={space === null ? null : new Set(space.environments.filter((found) => found.deploy).map((found) => found.code))}
      identity={identity}
      onLogout={onLogout}
    >
      {children}
      <Page
        route={route}
        current={current}
        listed={listed}
        fetcher={fetcher}
        environment={environment}
        session={session}
        onWritten={() => {
          setRevision((value) => value + 1);
        }}
      />
    </AppShell>
  );
}

function breadcrumb(route: Route, current: Current): readonly string[] {
  if (route.page === "home") {
    return ["Vos espaces"];
  }
  if (route.page === "prototype") {
    return ["Prototype graphique"];
  }
  if (route.page === "create") {
    return ["Vos espaces", "Nouvel espace"];
  }
  if (route.page === "telemetry") {
    return ["Vos espaces", "Télémétrie"];
  }
  if (current?.status === "ok") {
    if (route.page === "members") {
      return [current.value.name, "Membres et rôles"];
    }
    if (route.page === "environments") {
      return [current.value.name, "Environnements"];
    }
    if (route.page === "parameters") {
      return [current.value.name, "Paramètres"];
    }
    if (route.page === "connections") {
      return [current.value.name, "Connexions"];
    }
    if (route.page === "explorer") return [current.value.name, "Explorer"];
    if (route.page === "analyses") return [current.value.name, "Analyses"];
    if (route.page === "analysis") return [current.value.name, "Analyses", "Fiche analyse"];
    if (route.page === "dashboards") return [current.value.name, "Dashboards"];
    if (route.page === "dashboard") return [current.value.name, "Dashboards", "Éditeur"];
    if (route.page === "executions") {
      return [current.value.name, "Exécutions"];
    }
    return current.value.role === null ? [current.value.name] : [current.value.name, "Catalogue Atlas"];
  }
  return [current?.status === "not_found" ? "Espace introuvable" : "Espace"];
}

interface PageProps {
  route: Route;
  current: Current;
  listed: { status: "loading" } | SpaceOutcome<SpaceList>;
  fetcher: Fetch;
  /** Environnement choisi dans la coque. */
  environment: Environment;
  /** Clé stable de la session : un changement de personne abandonne ce que les pages de dashboards ont lu et recommence sous la nouvelle. */
  session: string;
  onWritten: () => void;
}

function Page({ route, current, listed, fetcher, environment, session, onWritten }: PageProps) {
  if (route.page === "home") {
    return <SpacesHome listed={listed} />;
  }
  if (route.page === "create") {
    return (
      <CreateSpacePage
        listed={listed}
        fetcher={fetcher}
        onCreated={(space) => {
          navigate({ page: "members", space: space.id });
        }}
      />
    );
  }
  if (route.page === "telemetry") {
    return <TelemetryPage fetcher={fetcher} />;
  }
  if (route.page === "prototype" || current === null) {
    return <PrototypePage />;
  }
  if (current.status === "loading") {
    return (
      <p role="status" aria-busy="true">
        Lecture de l'espace…
      </p>
    );
  }
  if (current.status === "not_found") {
    return (
      <Heading title="Espace introuvable" className="sb-space-missing">
        <a href={routeHash({ page: "home" })}>Retour à vos espaces</a>
      </Heading>
    );
  }
  if (current.status === "error") {
    return (
      <>
        <Heading title="Espace indisponible" />
        <Banner tone="danger">{current.message} Aucune donnée n'est affichée.</Banner>
      </>
    );
  }
  if (route.page === "members") {
    if (current.value.implicit) {
      return (
        <>
          <Heading title="Membres et rôles" />
          <Banner tone="neutral">En mode local, sans fournisseur d'identité, l'espace est implicite et vous en êtes l'administrateur : ses membres ne se gèrent pas.</Banner>
        </>
      );
    }
    // Le serveur décide : un rôle insuffisant est refusé par lui, et la page rend ce refus.
    return <MembersPage key={current.value.id} space={current.value} fetcher={fetcher} onWritten={onWritten} />;
  }
  if (route.page === "environments") {
    if (current.value.implicit) {
      return (
        <>
          <Heading title="Environnements" />
          <Banner tone="neutral">
            En mode local, sans fournisseur d'identité, vous pouvez déployer dans les trois environnements de l'espace implicite : les droits de déployer ne se gèrent pas.
          </Banner>
        </>
      );
    }
    return <EnvironmentsPage key={current.value.id} space={current.value} fetcher={fetcher} target={environment} onWritten={onWritten} />;
  }
  if (route.page === "parameters") {
    if (current.value.implicit) {
      return (
        <>
          <Heading title="Paramètres" />
          <Banner tone="neutral">En mode local, sans base d'état, les paramètres de déploiement ne se gèrent pas : aucune configuration n'est gardée.</Banner>
        </>
      );
    }
    return <ParametersPage key={current.value.id} space={current.value} fetcher={fetcher} target={environment} onWritten={onWritten} />;
  }
  if (route.page === "connections") {
    if (current.value.implicit) {
      return (
        <>
          <Heading title="Connexions" />
          <Banner tone="neutral">En mode local, les connexions d'un espace ne se gèrent pas. Seul l'essai d'un DuckDB déclaré sur le serveur est disponible.</Banner>
        </>
      );
    }
    return <ConnectionsPage key={current.value.id} space={current.value} fetcher={fetcher} target={environment} onWritten={onWritten} />;
  }
  if (route.page === "explorer") {
    return <ExplorerPage key={`${current.value.id}:${environment}:${route.analysis?.id ?? ""}:${String(route.analysis?.revision)}`} space={current.value} analysis={route.analysis} fetcher={fetcher} target={environment} />;
  }
  if (route.page === "analyses") {
    return <AnalysesPage key={current.value.id} space={current.value} fetcher={fetcher} />;
  }
  if (route.page === "analysis") {
    return <AnalysePage key={`${current.value.id}:${route.id}:${String(route.revision)}:${String(route.view)}:${JSON.stringify(route.compare)}`} space={current.value} id={route.id} revision={route.revision} view={route.view} compare={route.compare} fetcher={fetcher} />;
  }
  if (route.page === "dashboards") {
    return <DashboardsPage key={`${current.value.id}:${session}`} space={current.value} fetcher={fetcher} />;
  }
  if (route.page === "dashboard") {
    if (route.view === "history") return <HistoriqueDashboard key={`${current.value.id}:${route.id}:${session}:${JSON.stringify(route.compare)}`} space={current.value.id} id={route.id} compare={route.compare} fetcher={fetcher} />;
    return <DashboardEditorPage key={`${current.value.id}:${route.id}:${session}:${String(route.revision)}`} space={current.value} id={route.id} revision={route.revision} fetcher={fetcher} environment={environment} identity={session} />;
  }
  if (route.page === "executions") {
    return <ExecutionsPage key={current.value.id} space={current.value} platformAdmin={listed.status === "ok" && listed.value.platformAdmin} fetcher={fetcher} target={environment} />;
  }
  if (current.value.role === null) {
    return (
      <>
        <Heading title={current.value.name} />
        <Banner tone="neutral">
          Vous administrez la plateforme sans rôle dans cet espace : vous en gérez les membres, son catalogue ne vous est pas lisible.{" "}
          <a href={routeHash({ page: "members", space: current.value.id })}>Gérer les membres</a>
        </Banner>
      </>
    );
  }
  return <CataloguePage key={current.value.id} space={current.value.id} fetcher={fetcher} />;
}

function Heading({ title, className, children }: { title: string; className?: string; children?: ReactNode }) {
  return (
    <div className={className === undefined ? "sb-page-head" : `sb-page-head ${className}`}>
      <div>
        <h1 className="sb-page-head__title">{title}</h1>
        {children === undefined ? null : <p className="sb-page-head__lead">{children}</p>}
      </div>
    </div>
  );
}
