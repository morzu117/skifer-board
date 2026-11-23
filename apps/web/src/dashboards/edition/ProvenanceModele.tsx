import { fetchPageTemplateRevision } from "../../page-templates/client";
import type { Fetch } from "../../spaces/api";
import { useOutcome } from "../../ui/useOutcome";

/** La provenance est informative : seule la révision épinglée peut fournir son nom. */
export function ProvenanceModele({ space, identity, id, revision, fetcher }: { space: string; identity: string; id: string; revision: number; fetcher: Fetch }) {
  const result = useOutcome(`${space}:${identity}:${id}:${String(revision)}:provenance`, (signal) => fetchPageTemplateRevision(space, id, revision, signal, fetcher));
  return <p className="sb-editor__note">Issu du modèle {result.status === "ok" ? result.value.pageTemplate.name : <span className="sb-mono">{id}</span>} · r{revision}</p>;
}
