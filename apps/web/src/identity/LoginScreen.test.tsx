import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { LoginScreen } from "./LoginScreen";
import { LOGIN_ERRORS, LOGIN_REASON_LABELS } from "./model";

it("présente un h1 et le lien reçu, sans bandeau en l'absence de raison", () => {
  const { container } = render(<LoginScreen loginUrl="/auth/login?retour=board" reason={null} />);
  expect(screen.getByRole("heading", { level: 1, name: "Connexion requise" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Se connecter" })).toHaveAttribute("href", "/auth/login?retour=board");
  expect(container.querySelector(".sb-banner")).toBeNull();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
it.each([...LOGIN_ERRORS, "unknown", "session_expired"] as const)("affiche le libellé de %s et le ton approprié", (raison) => {
  render(<LoginScreen loginUrl="/auth/login" reason={raison} />);
  const avertissement = raison === "session_expired";
  const bandeau = screen.getByRole(avertissement ? "status" : "alert");
  expect(bandeau).toHaveTextContent(LOGIN_REASON_LABELS[raison]);
  expect(bandeau).toHaveClass(`sb-banner--${avertissement ? "warning" : "danger"}`);
});
