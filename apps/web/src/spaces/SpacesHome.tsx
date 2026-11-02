import { routeHash } from "../shell/route";
import { Badge } from "../ui/Badge";
import { Banner } from "../ui/Banner";
import { Card } from "../ui/Card";
import type { SpaceOutcome } from "./api";
import { roleLabel, type Space, type SpaceList as Listed } from "./model";
import "./spaces.css";

interface SpacesHomeProps {
  /** Liste lue par la coque, relue à chaque navigation. */
  listed: { status: "loading" } | SpaceOutcome<Listed>;
}

/**
 * Accueil : les espaces de la personne, avec son rôle et le rattachement Atlas (écrans §1.1).
 * La liste est relue à chaque navigation : un rôle retiré disparaît sans reconnexion (plan 08, E4).
 */
export function SpacesHome({ listed: result }: SpacesHomeProps) {
  const platformAdmin = result.status === "ok" && result.value.platformAdmin;
  return (
    <>
      <div className="sb-page-head">
        <div>
          <h1 className="sb-page-head__title">Vos espaces</h1>
          <p className="sb-page-head__lead">Un rôle dans un espace ne donne aucun droit sur les données : elles restent évaluées pour vous.</p>
        </div>
        {platformAdmin ? (
          // La création arrive avec l'écran d'administration (plan 08, 8.4).
          <button type="button" className="sb-button sb-button--primary" disabled>
            Créer un espace · à venir
          </button>
        ) : null}
      </div>
      {result.status === "loading" ? (
        <p role="status" aria-busy="true">
          Lecture des espaces…
        </p>
      ) : result.status === "ok" ? (
        <SpaceList spaces={result.value.spaces} />
      ) : (
        <Banner tone="danger">
          Espaces indisponibles : {result.status === "error" ? result.message : "réponse inattendue du serveur."} Aucune donnée n'est affichée.
        </Banner>
      )}
      <p className="sb-spaces__demo">
        <a href={routeHash({ page: "prototype" })}>Prototype graphique</a>, hors espace, sur des données de démonstration.
      </p>
    </>
  );
}

function SpaceList({ spaces }: { spaces: readonly Space[] }) {
  if (spaces.length === 0) {
    return (
      <Card title="Aucun espace">
        <p className="sb-spaces__empty">Vous n'êtes membre d'aucun espace. Un administrateur de l'espace ou de la plateforme peut vous y ajouter.</p>
      </Card>
    );
  }
  return (
    <ul className="sb-spaces" aria-label="Espaces">
      {spaces.map((space) => (
        <li key={space.id} className="sb-spaces__item">
          <a className="sb-spaces__name" href={routeHash({ page: "catalogue", space: space.id })}>
            {space.name}
          </a>
          <Badge tone="neutral">{roleLabel(space.role)}</Badge>
          <span className="sb-spaces__meta">
            Atlas : {space.atlas} · <span className="sb-spaces__id">{space.id}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
