import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

/**
 * jsdom n'a pas de canvas ; ECharts s'en sert pour mesurer le texte, même en rendu SVG. Un
 * contexte de mesure approché suffit : les tests portent sur la structure, pas sur les pixels.
 */
HTMLCanvasElement.prototype.getContext = function getContext() {
  return {
    font: "",
    measureText: (text: string) => ({ width: text.length * 6 }),
  } as unknown as CanvasRenderingContext2D;
} as unknown as typeof HTMLCanvasElement.prototype.getContext;

/** jsdom ne calcule pas de mise en page : une largeur fixe permet à ECharts de dessiner. */
Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 640 });

/** `ResizeObserver` absent de jsdom : un double qui permet de déclencher un redimensionnement. */
export class FakeResizeObserver {
  static readonly instances: FakeResizeObserver[] = [];
  readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  trigger(): void {
    this.callback([], this);
  }
}
globalThis.ResizeObserver = FakeResizeObserver;
