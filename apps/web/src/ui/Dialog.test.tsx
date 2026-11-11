import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it, vi } from "vitest";

import { expectAccessible } from "../test/a11y";
import { Dialog } from "./Dialog";

function Host({ onClose, marked }: { onClose?: () => void; marked?: boolean }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => { setOpen(true); }}>Ouvrir</button>
    {open ? <Dialog title="Titre" onClose={() => { onClose?.(); setOpen(false); }}>
      <input aria-label="Premier" />
      <input aria-label="Marqué" data-autofocus={marked === true ? "" : undefined} />
      <button type="button">Dernier</button>
    </Dialog> : null}
  </>;
}

it("est un dialogue modal nommé, accessible, où le focus entre sur le premier contrôle", async () => {
  const { container } = render(<Host />);
  await userEvent.click(screen.getByRole("button", { name: "Ouvrir" }));
  const dialog = screen.getByRole("dialog", { name: "Titre" });
  expect(dialog).toHaveAttribute("aria-modal", "true");
  expect(screen.getByRole("textbox", { name: "Premier" })).toHaveFocus();
  await expectAccessible(container);
});

it("donne le focus à l'élément marqué `data-autofocus`", async () => {
  render(<Host marked />);
  await userEvent.click(screen.getByRole("button", { name: "Ouvrir" }));
  expect(screen.getByRole("textbox", { name: "Marqué" })).toHaveFocus();
});

it("boucle Tab et Maj+Tab dans la boîte, sans en sortir", async () => {
  render(<Host />);
  await userEvent.click(screen.getByRole("button", { name: "Ouvrir" }));
  await userEvent.tab({ shift: true });
  expect(screen.getByRole("button", { name: "Dernier" })).toHaveFocus();
  await userEvent.tab();
  expect(screen.getByRole("textbox", { name: "Premier" })).toHaveFocus();
  await userEvent.tab();
  expect(screen.getByRole("textbox", { name: "Marqué" })).toHaveFocus();
});

it("se ferme sur Échap et rend le focus à l'élément qui l'a ouvert", async () => {
  const closed = vi.fn();
  render(<Host onClose={closed} />);
  const opener = screen.getByRole("button", { name: "Ouvrir" });
  await userEvent.click(opener);
  await userEvent.keyboard("{Escape}");
  expect(closed).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
});

it("sans contrôle, garde le focus sur la boîte et ne le laisse pas partir", async () => {
  render(<Dialog title="Vide" onClose={() => undefined}><p>Rien à faire.</p></Dialog>);
  const dialog = screen.getByRole("dialog", { name: "Vide" });
  expect(dialog).toHaveFocus();
  await userEvent.tab();
  expect(dialog).toHaveFocus();
});

it("ne rend le focus qu'à un élément HTML : l'ouvreur d'un autre genre n'en reçoit pas", () => {
  const { container } = render(<Host />);
  const opener = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  opener.setAttribute("tabindex", "0");
  container.append(opener);
  opener.focus();
  expect(document.activeElement).toBe(opener);
  const { unmount } = render(<Dialog title="Autre" onClose={() => undefined}><button type="button">Ok</button></Dialog>);
  expect(screen.getByRole("button", { name: "Ok" })).toHaveFocus();
  unmount();
  expect(document.activeElement).not.toBe(opener);
});
