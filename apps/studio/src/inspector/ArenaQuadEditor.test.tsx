// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ArenaQuadEditor, DEFAULT_ARENA_QUAD } from "./ArenaQuadEditor.js";

let root: Root | null = null;

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function pointer(target: Element, type: string, clientX: number, clientY: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    clientX: { value: clientX },
    clientY: { value: clientY },
    pointerId: { value: 1 },
  });
  target.dispatchEvent(event);
}

type EditorField = Parameters<typeof ArenaQuadEditor>[0]["field"];

async function renderEditor(onChange = vi.fn(), field: EditorField = {
  type: "four-quadrant",
  xAxis: { minLabel: "left", maxLabel: "right" },
  yAxis: { minLabel: "top", maxLabel: "bottom" },
}) {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.querySelector("#root")!);
  await act(async () => root?.render(<ArenaQuadEditor
    arena={DEFAULT_ARENA_QUAD}
    field={field}
    media={{ kind: "image", src: "/media/PLATE-A_master.png" }}
    onChange={onChange}
  />));
  const svg = document.querySelector<SVGSVGElement>(".arena-quad-canvas")!;
  vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200, x: 0, y: 0, toJSON: () => ({}) });
  return { svg, onChange };
}

describe("ArenaQuadEditor", () => {
  it("shows the exact media frame, quad outline, split lines, and four corner handles", async () => {
    await renderEditor();

    expect(document.querySelector(".polygon-editor-media-image")?.getAttribute("src")).toBe("/media/PLATE-A_master.png");
    const outlinePoints = document.querySelector(".arena-editor-outline")?.getAttribute("points")
      ?.split(" ").map((pair) => pair.split(",").map((n) => Math.round(Number(n) * 1000) / 1000));
    expect(outlinePoints).toEqual([[14, 52], [86, 52], [94, 97], [6, 97]]);
    expect(document.querySelectorAll(".arena-editor-divider")).toHaveLength(2);
    expect(document.querySelectorAll(".arena-editor-handle")).toHaveLength(4);
  });

  it("drags a single corner without moving the others", async () => {
    const onChange = vi.fn();
    const { svg } = await renderEditor(onChange);
    const topRight = document.querySelector('[data-arena-handle="top-right"]')!;

    await act(async () => { pointer(topRight, "pointerdown", 172, 104); });
    await act(async () => { pointer(svg, "pointermove", 180, 90); });

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      corners: [
        DEFAULT_ARENA_QUAD.corners[0],
        { x: 0.9, y: 0.45 },
        DEFAULT_ARENA_QUAD.corners[2],
        DEFAULT_ARENA_QUAD.corners[3],
      ],
    }));
  });

  it("shows the horizontal track for an X spectrum", async () => {
    await renderEditor(vi.fn(), { type: "two-quadrant", axis: "x", labels: { minLabel: "left", maxLabel: "right" } });
    const axis = document.querySelector(".arena-editor-axis")!;
    expect(axis.getAttribute("x1")).toBe("10");
    expect(Number(axis.getAttribute("x2"))).toBeCloseTo(90);
    expect(axis.getAttribute("y1")).toBe("74.5");
    expect(axis.getAttribute("y2")).toBe("74.5");
    expect(document.querySelectorAll(".arena-editor-divider")).toHaveLength(0);
  });

  it("moves every corner together when dragging the shape body", async () => {
    const onChange = vi.fn();
    const { svg } = await renderEditor(onChange);
    const fill = document.querySelector(".arena-editor-fill")!;

    await act(async () => { pointer(fill, "pointerdown", 100, 100); });
    await act(async () => { pointer(svg, "pointermove", 110, 90); });

    const call = onChange.mock.calls.at(-1)![0] as typeof DEFAULT_ARENA_QUAD;
    const round4 = (value: number) => Math.round(value * 10_000) / 10_000;
    expect(call.corners.map((c, i) => round4(c.x - DEFAULT_ARENA_QUAD.corners[i]!.x))).toEqual([0.05, 0.05, 0.05, 0.05]);
    expect(call.corners.map((c, i) => round4(c.y - DEFAULT_ARENA_QUAD.corners[i]!.y))).toEqual([-0.05, -0.05, -0.05, -0.05]);
  });

  it("restores the default trapezoid", async () => {
    const onChange = vi.fn();
    await renderEditor(onChange);

    const reset = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Reset to default trapezoid")!;
    await act(async () => { reset.click(); });
    expect(onChange).toHaveBeenLastCalledWith(DEFAULT_ARENA_QUAD);
  });
});
