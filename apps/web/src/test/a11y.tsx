import { render } from "@testing-library/react";
import axe from "axe-core";
import type { ReactNode } from "react";
import { expect } from "vitest";

import type { ChartTheme } from "../charts/theme";

export function renderThemed(content: ReactNode, theme: ChartTheme) {
  return render(<div className={`sb-theme-${theme.id}`}>{content}</div>);
}

export async function expectAccessible(container: HTMLElement): Promise<void> {
  const result = await axe.run(container, {
    rules: {
      // jsdom ne calcule pas la mise en page et les styles nécessaires au contraste.
      // Le contrôle color-contrast dans un vrai navigateur relève de l'E2E de la sous-tâche 3.3.
      "color-contrast": { enabled: false },
    },
  });
  expect(result.violations).toEqual([]);
}
