import { useEffect, useState, type ReactNode } from "react";

import { CataloguePage } from "./catalogue/CataloguePage";
import { logout, type Fetch } from "./identity/api";
import { LoginScreen } from "./identity/LoginScreen";
import { displayName, loginReasonFrom } from "./identity/model";
import { useIdentity } from "./identity/useIdentity";
import { PrototypePage } from "./prototype/PrototypePage";
import { AppShell } from "./shell/AppShell";
import type { Identity } from "./shell/IdentityPill";
import { navigate, routeHash, useRoute, type Route } from "./shell/route";
import type { Environment, SectionId } from "./shell/sections";
import { SpaceSwitch } from "./shell/SpaceSwitch";
import { fetchSpace, fetchSpaces, type SpaceOutcome } from "./spaces/api";
import { onSpaceLost } from "./spaces/lost";
import { SPACE_ID, type Space, type SpaceList } from "./spaces/model";
import { SpacesHome } from "./spaces/SpacesHome";
import { Banner } from "./ui/Banner";
import { useOutcome } from "./ui/useOutcome";

/** Seul le catalogue est livré (lot 04) ; les autres sections restent à venir. */
const AVAILABLE = new Set<SectionId>(["catalogue"]);
const NOTHING = new Set<SectionId>();
/** Hors d'un espace lisible, le catalogue n'est pas « à venir » : il se lit dans un espace. */
const OUTSIDE: Partial<Record<SectionId, string>> = { catalogue: "dans un espace" };
const NOT_FOUND = { status: "not_found" } as const;

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
    <Workspace fetcher={fetcher} identity={identity} onLogout={onLogout}>
      {logoutError === null ? null : <Banner tone="danger">{logoutError}</Banner>}
    </Workspace>
  );
}

interface WorkspaceProps {
  fetcher: Fetch;
  identity: Identity | null;
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
function Workspace({ fetcher, identity, onLogout, children }: WorkspaceProps) {
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
  // La liste est relue à chaque navigation : le sélecteur ne garde pas un espace retiré.
  const listed = useOutcome(`spaces:${hash}:${reread}`, (signal) => fetchSpaces(signal, fetcher));
  const spaceId = route.page === "catalogue" ? route.space : null;
  const current: Current = useOutcome(`space:${spaceId ?? ""}:${reread}`, (signal) =>
    // Un identifiant hors format (E1) ne désigne aucun espace : rien n'est demandé au serveur.
    spaceId === null ? Promise.resolve(null) : SPACE_ID.test(spaceId) ? fetchSpace(spaceId, signal, fetcher) : Promise.resolve(NOT_FOUND),
  );
  const space = current?.status === "ok" ? current.value : null;
  const readable = space !== null && space.role !== null;

  return (
    <AppShell
      workspace={space?.atlas ?? null}
      available={readable ? AVAILABLE : NOTHING}
      active={route.page === "catalogue" && readable ? "catalogue" : undefined}
      // Le catalogue n'est offert que sur la page d'un espace lisible : y revenir est la seule navigation.
      onNavigate={() => {
        navigate(route);
      }}
      breadcrumb={breadcrumb(route, current)}
      pending={readable ? undefined : OUTSIDE}
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
      identity={identity}
      onLogout={onLogout}
    >
      {children}
      <Page route={route} current={current} listed={listed} fetcher={fetcher} />
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
  if (current?.status === "ok") {
    return current.value.role === null ? [current.value.name] : [current.value.name, "Catalogue Atlas"];
  }
  return [current?.status === "not_found" ? "Espace introuvable" : "Espace"];
}

interface PageProps {
  route: Route;
  current: Current;
  listed: { status: "loading" } | SpaceOutcome<SpaceList>;
  fetcher: Fetch;
}

function Page({ route, current, listed, fetcher }: PageProps) {
  if (route.page === "home") {
    return <SpacesHome listed={listed} />;
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
  if (current.value.role === null) {
    return (
      <>
        <Heading title={current.value.name} />
        <Banner tone="neutral">Vous administrez la plateforme sans rôle dans cet espace : vous en gérez les membres, son catalogue ne vous est pas lisible.</Banner>
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
