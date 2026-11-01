import type { ReactNode } from "react";

import type { Identity } from "./IdentityPill";
import type { Environment, SectionId } from "./sections";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import "./shell.css";

interface AppShellProps {
  workspace: string | null;
  available: ReadonlySet<SectionId>;
  active?: SectionId | undefined;
  onNavigate: (section: SectionId) => void;
  breadcrumb: readonly string[];
  environment: Environment;
  onEnvironmentChange: (environment: Environment) => void;
  identity: Identity | null;
  children: ReactNode;
}

/** Coque des pages de gestion : navigation latérale, barre supérieure, contenu (RULES §4). */
export function AppShell({ workspace, available, active, onNavigate, breadcrumb, environment, onEnvironmentChange, identity, children }: AppShellProps) {
  return (
    <div className="sb-shell">
      <Sidebar available={available} onNavigate={onNavigate} workspace={workspace} active={active} />
      <div className="sb-shell__main">
        <TopBar breadcrumb={breadcrumb} environment={environment} onEnvironmentChange={onEnvironmentChange} identity={identity} />
        <main className="sb-shell__content">{children}</main>
      </div>
    </div>
  );
}
