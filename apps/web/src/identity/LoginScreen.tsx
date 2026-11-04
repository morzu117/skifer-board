import { Banner } from "../ui/Banner";
import { LOGIN_REASON_LABELS, type LoginReason } from "./model";
import "./identity.css";

interface LoginScreenProps {
  /** Route de connexion du serveur ; la navigation est pleine page, vers le fournisseur. */
  loginUrl: string;
  reason: LoginReason | null;
}

/**
 * Écran affiché sans session : aucune donnée, aucune navigation, seulement la connexion
 * (plan 06, I6). La raison d'un échec ou d'une session expirée est dite en texte.
 */
export function LoginScreen({ loginUrl, reason }: LoginScreenProps) {
  return (
    <main className="sb-login">
      <section className="sb-login__card" aria-labelledby="sb-login-title">
        <h1 id="sb-login-title" className="sb-login__title">
          Connexion requise
        </h1>
        <p className="sb-login__text">
          Skifer Board affiche des données évaluées pour la personne connectée. Connectez-vous avec le compte de votre organisation.
        </p>
        {reason === null ? null : <Banner tone={reason === "session_expired" ? "warning" : "danger"}>{LOGIN_REASON_LABELS[reason]}</Banner>}
        <a className="sb-button sb-button--primary sb-login__action" href={loginUrl}>
          Se connecter
        </a>
      </section>
    </main>
  );
}
