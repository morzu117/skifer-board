import { useState } from "react";

import { CataloguePage } from "./catalogue/CataloguePage";
import { logout, type Fetch } from "./identity/api";
import { LoginScreen } from "./identity/LoginScreen";
import { displayName, loginReasonFrom } from "./identity/model";
import { useIdentity } from "./identity/useIdentity";
import { PrototypePage } from "./prototype/PrototypePage";
import { AppShell } from "./shell/AppShell";
import type { Identity } from "./shell/IdentityPill";
import { navigate, useRoute } from "./shell/route";
import type { Environment, SectionId } from "./shell/sections";
import { Banner } from "./ui/Banner";

/** Seul le catalogue est livré (lot 04) ; les autres sections restent à venir. */
const AVAILABLE = new Set<SectionId>(["catalogue"]);

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
  const [environment, setEnvironment] = useState<Environment>("DEV");
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const route = useRoute();
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
    <AppShell
      workspace={null}
      available={AVAILABLE}
      active={route === "catalogue" ? "catalogue" : undefined}
      onNavigate={() => {
        navigate("catalogue");
      }}
      breadcrumb={[route === "catalogue" ? "Catalogue Atlas" : "Prototype graphique"]}
      environment={environment}
      onEnvironmentChange={setEnvironment}
      identity={identity}
      onLogout={onLogout}
    >
      {logoutError === null ? null : <Banner tone="danger">{logoutError}</Banner>}
      {route === "catalogue" ? <CataloguePage /> : <PrototypePage />}
    </AppShell>
  );
}
