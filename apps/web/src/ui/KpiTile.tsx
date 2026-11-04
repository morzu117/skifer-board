import type { Tone } from "../format/number";
import { LockIcon } from "./icons";
import "./ui.css";

export type KpiTileProps =
  | {
      state: "value";
      label: string;
      /** Valeur déjà formatée, en police mono. */
      value: string;
      /** Écart signé et sa référence : « +3,1 % contre T2 ». */
      delta?: { text: string; tone: Tone; comparison: string };
      /** Tracé de tendance (chemin SVG), décoratif : la valeur et l'écart portent le sens. */
      trend?: string;
    }
  | {
      state: "denied";
      label: string;
      /** Conduite à tenir : qui contacter. */
      guidance: string;
    };

/** Tuile KPI, ou tuile refusée : jamais de trou silencieux (RULES §6). */
export function KpiTile(props: KpiTileProps) {
  if (props.state === "denied") {
    return (
      <div className="sb-kpi sb-kpi--denied" role="group" aria-label={props.label}>
        <span className="sb-kpi__label">{props.label}</span>
        <span className="sb-kpi__denied">
          <LockIcon size={16} />
          Accès refusé
        </span>
        <span className="sb-kpi__guidance">{props.guidance}</span>
      </div>
    );
  }
  const { label, value, delta, trend } = props;
  return (
    <div className="sb-kpi" role="group" aria-label={label}>
      <span className="sb-kpi__label">{label}</span>
      <span className="sb-kpi__value">{value}</span>
      {delta === undefined ? null : (
        <span className={`sb-kpi__delta sb-kpi__delta--${delta.tone}`}>
          {delta.text} {delta.comparison}
        </span>
      )}
      {trend === undefined ? null : (
        <svg className="sb-kpi__trend" viewBox="0 0 120 32" preserveAspectRatio="none" aria-hidden="true">
          <path d={trend} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </svg>
      )}
    </div>
  );
}
