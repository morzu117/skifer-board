import { describe, it } from "vitest";
import { THEMES } from "../charts/theme";
import { expectAccessible, renderThemed } from "../test/a11y";
import { BrandMark, InfoIcon, LockIcon, WarningIcon } from "./icons";

describe.each(THEMES)("Accessibilité des icônes · $label", (theme) => {
  it.each([BrandMark, InfoIcon, LockIcon, WarningIcon])("icône décorative %s sans violation", async (Icon) => {
    const { container } = renderThemed(<button type="button"><Icon />Informations</button>, theme);
    await expectAccessible(container);
  });
});
