import { useState } from "react";

import { formatInstant } from "../format/date";
import { formatNumber } from "../format/number";
import { Badge } from "../ui/Badge";
import { Banner } from "../ui/Banner";
import { useOutcome } from "../ui/useOutcome";
import { fetchDiff, fetchVersions, type DiffOutcome, type Fetch, type Outcome } from "./api";
import { changeValue, PROBLEM_LABELS, SEVERITY_LABELS, shortCommit, versionLabel } from "./labels";
import { DIFF_SEVERITIES, type DiffPage, type DocumentKind, type VersionsPage } from "./model";

interface VersionsSectionProps {
  space: string;
  id: string;
  kind: DocumentKind;
  fetcher: Fetch;
}

/** Versions taguées d'une définition et, pour un KPI, l'écart avec la dernière (plan 05). */
export function VersionsSection({ space, id, kind, fetcher }: VersionsSectionProps) {
  const result = useOutcome<Outcome<VersionsPage>>(`versions:${space}:${id}`, (signal) => fetchVersions(space, id, signal, fetcher));
  // L'écart ouvert appartient à un document : il ne survit pas à un changement d'`id`.
  const [opened, setOpened] = useState<{ id: string; version: number } | null>(null);
  const open = opened?.id === id ? opened.version : null;

  if (result.status !== "ok") {
    return (
      <section className="sb-catalogue__section" aria-labelledby="fiche-versions">
        <h3 id="fiche-versions">Versions</h3>
        {result.status === "loading" && <p role="status">Lecture des versions dans le clone…</p>}
        {result.status === "unavailable" && (
          <Banner tone="warning">
            Historique indisponible : {PROBLEM_LABELS[result.problem]}. Les versions ne sont lues que dans un clone relu.
            <span className="sb-catalogue__detail">{result.detail}</span>
          </Banner>
        )}
        {result.status === "not_found" && <Banner tone="warning">La définition n'est plus dans l'index Atlas : son historique n'est pas lisible.</Banner>}
        {result.status === "error" && <Banner tone="danger">L'historique n'a pas pu être lu. {result.message}</Banner>}
      </section>
    );
  }

  const page = result.value;
  const latest = page.versions.at(-1);
  const current = page.current_version;
  const currentTagged = page.versions.some((version) => version.version === current);
  const newestFirst = [...page.versions].reverse();
  return (
    <section className="sb-catalogue__section" aria-labelledby="fiche-versions">
      <h3 id="fiche-versions">Versions · {formatNumber(page.versions.length)}</h3>
      {current !== null && !currentTagged && (
        <p>
          La version courante <span className="sb-mono">{versionLabel(current)}</span> n'est pas taguée dans Atlas
          {kind === "kpi" ? " : aucun écart n'est proposé avec elle." : "."}
        </p>
      )}
      {latest === undefined ? (
        <p className="sb-catalogue__muted">Aucune version taguée dans Atlas.</p>
      ) : (
        <ol className="sb-catalogue__items sb-catalogue__versions">
          {newestFirst.map((version) => {
            const comparable = kind === "kpi" && version.version !== latest.version;
            const panel = `fiche-ecart-${String(version.version)}`;
            return (
              <li key={version.version}>
                <span className="sb-mono">{versionLabel(version.version)}</span>
                {version.version === current && (
                  <>
                    {" "}
                    <Badge tone="success">Courante</Badge>
                  </>
                )}{" "}
                · {version.message}
                <span className="sb-catalogue__muted sb-catalogue__meta">
                  {version.author} · {formatInstant(version.date)} · commit {shortCommit(version.commit)}
                </span>
                {comparable && (
                  <>
                    <button
                      type="button"
                      className="sb-button sb-catalogue__compare"
                      aria-expanded={open === version.version}
                      aria-controls={open === version.version ? panel : undefined}
                      onClick={() => {
                        setOpened(open === version.version ? null : { id, version: version.version });
                      }}
                    >
                      Écart avec la {versionLabel(latest.version)}
                    </button>
                    {open === version.version && (
                      <div id={panel}>
                        <DiffView space={space} id={id} base={version.version} other={latest.version} fetcher={fetcher} />
                      </div>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <p className="sb-catalogue__provenance">
        Versions lues dans le clone au commit <span className="sb-mono">{shortCommit(page.provenance.commit)}</span>, le{" "}
        <span className="sb-mono">{formatInstant(page.provenance.read_at)}</span>.
      </p>
    </section>
  );
}

interface DiffViewProps {
  space: string;
  id: string;
  base: number;
  other: number;
  fetcher: Fetch;
}

function DiffView({ space, id, base, other, fetcher }: DiffViewProps) {
  const result = useOutcome<DiffOutcome>(`diff:${space}:${id}:${String(base)}:${String(other)}`, (signal) => fetchDiff(space, id, base, other, signal, fetcher));
  switch (result.status) {
    case "loading":
      return <p role="status">Calcul de l'écart par Atlas…</p>;
    case "refused":
      return <Banner tone="warning">Écart indisponible : {result.detail}</Banner>;
    case "unavailable":
      return (
        <Banner tone="warning">
          Historique indisponible : {PROBLEM_LABELS[result.problem]}.<span className="sb-catalogue__detail">{result.detail}</span>
        </Banner>
      );
    case "not_found":
      return <Banner tone="warning">La définition n'est plus dans l'index Atlas.</Banner>;
    case "error":
      return <Banner tone="danger">L'écart n'a pas pu être lu. {result.message}</Banner>;
    case "ok":
      return <DiffReport page={result.value} />;
  }
}

function DiffReport({ page }: { page: DiffPage }) {
  const { diff } = page;
  const pair = `la ${versionLabel(diff.base.version)} et la ${versionLabel(diff.other.version)}`;
  return (
    <div className="sb-catalogue__diff">
      {diff.identical ? (
        <p>Aucun écart : {pair} ont la même définition.</p>
      ) : (
        <>
          <p>
            {diff.differences.length === 1 ? "1 écart" : `${formatNumber(diff.differences.length)} écarts`} entre {pair} ·{" "}
            {DIFF_SEVERITIES.toReversed()
              .map((severity) => `${SEVERITY_LABELS[severity].label} ${formatNumber(diff.by_severity[severity])}`)
              .join(" · ")}
          </p>
          <ul className="sb-catalogue__items">
            {diff.differences.map((difference, index) => (
              <li key={`${difference.base_node ?? ""}-${difference.other_node ?? ""}-${String(index)}`}>
                <Badge tone={SEVERITY_LABELS[difference.severity].tone}>{SEVERITY_LABELS[difference.severity].label}</Badge> {difference.message}
                {difference.changes.length > 0 && (
                  <ul className="sb-catalogue__changes">
                    {difference.changes.map((change) => (
                      <li key={change.field}>
                        <span className="sb-mono">{change.field}</span> : <span className="sb-mono">{changeValue(change.before)}</span> →{" "}
                        <span className="sb-mono">{changeValue(change.after)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="sb-catalogue__muted sb-catalogue__hash">
        Empreintes Atlas : {versionLabel(diff.base.version)} <span className="sb-mono">{diff.base.fingerprint}</span> ·{" "}
        {versionLabel(diff.other.version)} <span className="sb-mono">{diff.other.fingerprint}</span>
      </p>
    </div>
  );
}
