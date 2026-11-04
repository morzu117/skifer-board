/** Icônes en trait, `currentColor`, décoratives : le texte voisin porte le sens (DESIGN-SYSTEM §6). */
interface IconProps {
  size?: number;
}

export function LockIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function WarningIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 3 2 21h20z" />
      <path d="M12 10v5M12 18v.5" />
    </svg>
  );
}

export function InfoIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.5" />
    </svg>
  );
}

/** Marque : trois strates d'ardoise. */
export function BrandMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4" width="18" height="4" rx="1" fill="var(--sb-copper-on-dark)" />
      <rect x="3" y="10" width="18" height="4" rx="1" fill="var(--sb-on-slate)" />
      <rect x="3" y="16" width="18" height="4" rx="1" fill="var(--sb-on-slate-muted)" />
    </svg>
  );
}
