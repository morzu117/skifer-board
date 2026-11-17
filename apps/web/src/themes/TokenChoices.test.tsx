import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { TOKEN_CATALOG } from "./catalog";
import { TokenChoices } from "./TokenChoices";

it("propose les tokens admissibles avec contraste et pastille du choix", async () => {
  const onChange = vi.fn();
  const { container } = render(<TokenChoices catalog={TOKEN_CATALOG} base="skifer-clair" role="mark" label="Série" value="blue" onChange={onChange} />);
  const select = screen.getByRole("combobox", { name: "Série" });
  expect(within(select).queryByRole("option", { name: /^surface ·/ })).not.toBeInTheDocument();
  expect(select).toHaveValue("blue");
  expect(within(select).getByRole("option", { name: /^blue · \d+,\d:1/ })).toBeInTheDocument();
  expect(container.querySelector(".sb-themes__swatch")).toHaveAttribute("style", expect.stringContaining("var(--sb-"));
  await userEvent.selectOptions(select, "ink");
  expect(onChange).toHaveBeenCalledWith("ink");
});
it("signale le choix devenu inadmissible sans le proposer", () => {
  const view = render(<TokenChoices catalog={TOKEN_CATALOG} base="skifer-clair" role="mark" label="Série" value="surface" onChange={vi.fn()} />);
  expect(screen.getByRole("option", { name: /Choix inadmissible : surface/ })).toBeDisabled();
  view.rerender(<TokenChoices catalog={TOKEN_CATALOG} base="skifer-clair" role="mark" label="Série" value="inconnu" onChange={vi.fn()} />);
  expect(screen.getByRole("option", { name: /Choix inadmissible : inconnu/ })).toBeDisabled();
});
