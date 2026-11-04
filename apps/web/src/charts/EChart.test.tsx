import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { FakeResizeObserver } from "../test/setup";
import { EChart, type ChartHandle } from "./EChart";
import type { ChartOption } from "./echarts";
import { chartOf, clickItem } from "./testing";

const bars = (values: number[]): ChartOption => ({
  xAxis: { type: "category", data: values.map((_, index) => `c${index}`) },
  yAxis: { type: "value" },
  series: [{ type: "bar", data: values }],
});

describe("EChart", () => {
  it("rend un SVG étiqueté et applique chaque nouvelle option", () => {
    const { rerender } = render(<EChart option={bars([1, 2])} label="Deux barres" height={200} />);
    const element = screen.getByRole("img", { name: "Deux barres" });
    expect(element.querySelector("svg")).not.toBeNull();
    rerender(<EChart option={bars([1, 2, 3])} label="Trois barres" height={240} />);
    const option = chartOf(element).getOption() as { series: { data: number[] }[] };
    expect(option.series[0]?.data).toEqual([1, 2, 3]);
    expect(element).toHaveStyle({ height: "240px" });
  });

  it("relaie les clics avec le dernier gestionnaire", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<EChart option={bars([1, 2])} label="g" height={200} onItemClick={first} />);
    rerender(<EChart option={bars([1, 2])} label="g" height={200} onItemClick={second} />);
    const element = screen.getByRole("img");
    clickItem(element, { name: "c1", dataIndex: 1, seriesIndex: 0 });
    clickItem(element, { name: "c0", dataIndex: 0 });
    expect(first).not.toHaveBeenCalled();
    expect(second.mock.calls).toEqual([[{ seriesIndex: 0, dataIndex: 1, name: "c1" }], [{ seriesIndex: 0, dataIndex: 0, name: "c0" }]]);
  });

  it("ignore un clic sans gestionnaire", () => {
    render(<EChart option={bars([1])} label="g" height={200} />);
    expect(() => {
      clickItem(screen.getByRole("img"), { name: "c0", dataIndex: 0 });
    }).not.toThrow();
  });

  it("suit la taille du conteneur et libère l'instance", () => {
    const { unmount } = render(<EChart option={bars([1])} label="g" height={200} />);
    const element = screen.getByRole("img");
    const resize = vi.spyOn(chartOf(element), "resize");
    FakeResizeObserver.instances.at(-1)?.trigger();
    expect(resize).toHaveBeenCalled();
    unmount();
    expect(() => chartOf(element)).toThrow("Aucun graphique");
  });

  it("télécharge l'image, puis plus rien une fois le graphique détruit", () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const handle = createRef<ChartHandle>();
    const { unmount } = render(<EChart ref={handle} option={bars([1, 2])} label="g" height={200} />);
    const current = handle.current as ChartHandle;
    expect(current.downloadImage("g.svg", "#FFFFFF")).toBe(true);
    const link = click.mock.contexts[0] as HTMLAnchorElement;
    expect(link.download).toBe("g.svg");
    expect(link.href).toMatch(/^data:image\/svg\+xml/);
    unmount();
    expect(current.downloadImage("g.svg", "#FFFFFF")).toBe(false);
    current.focusItem(0);
    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
  });

  it("met un élément en avant", () => {
    const handle = createRef<ChartHandle>();
    render(<EChart ref={handle} option={bars([1, 2])} label="g" height={200} />);
    const dispatch = vi.spyOn(chartOf(screen.getByRole("img")), "dispatchAction");
    handle.current?.focusItem(1);
    expect(dispatch).toHaveBeenCalledWith({ type: "showTip", seriesIndex: 0, dataIndex: 1 });
    handle.current?.focusItem(null);
    expect(dispatch).toHaveBeenLastCalledWith({ type: "hideTip" });
  });
});
