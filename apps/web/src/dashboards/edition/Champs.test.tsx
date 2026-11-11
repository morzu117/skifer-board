import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { Choice, CommitField } from "./Champs";

it("un champ multiligne sans borne ni aide valide à la sortie et suit la valeur du document", async () => {
  const onCommit = vi.fn();
  const { rerender } = render(<CommitField label="Note" value="a" multiline onCommit={onCommit} />);
  const box = screen.getByRole("textbox", { name: "Note" });
  expect(box).not.toHaveAttribute("maxlength");
  await userEvent.type(box, "b");
  expect(onCommit).not.toHaveBeenCalled();
  await userEvent.tab();
  expect(onCommit).toHaveBeenCalledExactlyOnceWith("ab");
  rerender(<CommitField label="Note" value="z" multiline onCommit={onCommit} />);
  expect(box).toHaveValue("z");
});

it("un champ multiligne avec aide la relie au champ, et désactivé il ne se modifie pas", () => {
  render(<CommitField label="Note" value="" multiline hint="Aide." disabled onCommit={() => undefined} />);
  expect(screen.getByRole("textbox", { name: /^Note/ })).toHaveAccessibleDescription("Aide.");
  expect(screen.getByRole("textbox", { name: /^Note/ })).toBeDisabled();
});

it("un champ d'une ligne valide sur Entrée seulement si le texte a changé", async () => {
  const onCommit = vi.fn();
  render(<CommitField label="Nom" value="x" maxLength={5} onCommit={onCommit} />);
  const input = screen.getByRole("textbox", { name: "Nom" });
  expect(input).toHaveAttribute("maxlength", "5");
  await userEvent.type(input, "{Enter}");
  expect(onCommit).not.toHaveBeenCalled();
  await userEvent.type(input, "y{Enter}");
  expect(onCommit).toHaveBeenCalledExactlyOnceWith("xy");
});

it("une liste à valeurs fermées dit sa note et envoie la valeur choisie", async () => {
  const onChange = vi.fn();
  render(<Choice label="Choix" value="a" options={[{ value: "a", label: "A" }, { value: "b", label: "B" }]} note="Note." onChange={onChange} />);
  await userEvent.selectOptions(screen.getByRole("combobox", { name: /^Choix/ }), "b");
  expect(onChange).toHaveBeenCalledExactlyOnceWith("b");
  expect(screen.getByText("Note.")).toBeInTheDocument();
});
