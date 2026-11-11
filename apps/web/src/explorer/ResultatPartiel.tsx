/** Bandeau du résultat partiel (§0.2) : l'Explorateur et les tuiles des dashboards le disent de la même façon. */
export function ResultatPartiel({ dashboard = false }: { dashboard?: boolean }) {
  return <div className="sb-banner sb-banner--warning"><div>{dashboard ? "Résultat partiel : une limite de la source ou du résultat a été atteinte." : "Résultat partiel : limite de la source ou de l'aperçu atteinte. Limites de l'aperçu : 1 000 lignes et 1 048 576 octets ; le serveur ne précise pas laquelle a été atteinte."}</div></div>;
}
