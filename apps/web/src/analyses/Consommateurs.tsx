import { routeHash } from "../shell/route";
import { Reading } from "../spaces/AdminParts";
import type { Fetch } from "../spaces/api";
import { useOutcome } from "../ui/useOutcome";
import { fetchConsumers } from "./client";
import { Unavailable } from "./Failure";
import type { Consumer } from "./refusal";

/** Seuls les identifiants autorisés par le serveur sont présentés : les autres restent un décompte. */
export function ListeConsommateurs({ space, consumers, others }: { space: string; consumers: readonly Consumer[]; others: number }) {
  return <div>
    {consumers.length === 0 && others === 0 ? <p>Aucun consommateur.</p> : null}
    {consumers.length === 0 ? null : <ul aria-label="Dashboards consommateurs">{consumers.map((consumer) => <li key={consumer.id}><a href={routeHash({ page: "dashboard", space, id: consumer.id })}>Dashboard {consumer.id}</a></li>)}</ul>}
    {others === 0 ? null : <p>Autres dépendants que vous ne voyez pas : {others}.</p>}
  </div>;
}

export function OngletConsommateurs({ space, id, fetcher }: { space: string; id: string; fetcher: Fetch }) {
  const result = useOutcome(`${space}:${id}:consommateurs`, (signal) => fetchConsumers(space, id, signal, fetcher));
  if (result.status === "loading") return <Reading>Lecture des consommateurs…</Reading>;
  if (result.status !== "ok") return <Unavailable outcome={result} title="Consommateurs indisponibles" local="Les consommateurs ne sont pas disponibles en mode local." />;
  return <ListeConsommateurs space={space} consumers={result.value.consumers} others={result.value.others} />;
}
