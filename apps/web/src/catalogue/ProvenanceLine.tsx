import { formatAge, formatInstant } from "../format/date";
import { shortCommit } from "./labels";
import type { Provenance } from "./model";

/** Provenance d'une réponse : commit indexé et dernière lecture réussie du clone (plan 04, C6). */
export function ProvenanceLine({ provenance, now }: { provenance: Provenance; now: Date }) {
  return (
    <p className="sb-catalogue__provenance">
      Index Atlas du commit <span className="sb-mono">{shortCommit(provenance.commit)}</span> · clone lu le{" "}
      <span className="sb-mono">{formatInstant(provenance.read_at)}</span> ({formatAge(provenance.read_at, now)})
    </p>
  );
}
