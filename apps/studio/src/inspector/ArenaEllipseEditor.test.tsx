// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ArenaEllipseEditor, PLATE_A_ARENA_PRESET } from "./ArenaEllipseEditor.js";

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

type EditorField = Parameters<typeof ArenaEllipseEditor>[0]["field"];

async function renderEditor(onChange = vi.fn(), field: EditorField = {
  type: "four-quadrant",
  xAxis: { minLabel: "left", maxLabel: "right" },
  yAxis: { minLabel: "top", maxLabel: "bottom" },
}) {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.querySelector("#root")!);
  await act(async () => root?.render(<ArenaEllipseEditor
    arena={PLATE_A_ARENA_PRESET}
    field={field}
    media={{ kind: "image", src: "/media/PLATE-A_master.png" }}
    onChange={onChange}
  />));
  const svg = document.querySelector<SVGSVGElement>(".arena-ellipse-canvas")!;
  vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200, x: 0, y: 0, toJSON: () => ({}) });
  return { svg, onChange };
}

describe("ArenaEllipseEditor", () => {
  it("shows the exact media frame, ellipse, quadrant split, and calibration handles", async () => {
    await renderEditor();

    expect(document.querySelector(".polygon-editor-media-image")?.getAttribute("src")).toBe("/media/PLATE-A_master.png");
    expect(document.querySelector(".arena-editor-outline")?.getAttribute("cx")).toBe("50");
    expect(document.querySelector(".arena-editor-outline")?.getAttribute("cy")).toBe("73.5");
    expect(document.querySelectorAll(".arena-editor-divider")).toHaveLength(2);
    expect(document.querySelector('[data-arena-handle="split-y"]')?.getAttribute("cy")).toBe("67");
    expect(document.querySelectorAll(".arena-editor-handle")).toHaveLength(4);
  });

  it("moves the perspective centre line independently of the ellipse", async () => {
    const onChange = vi.fn();
    const { svg } = await renderEditor(onChange);
    const split = document.querySelector('[data-arena-handle="split-y"]')!;

    await act(async () => { pointer(split, "pointerdown", 100, 134); });
    await act(async () => { pointer(svg, "pointermove", 100, 126); });

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ centerY: 0.735, splitY: 0.63 }));
  });

  it("shows the selected two-way spectrum axis rather than a perpendicular divider", async () => {
    await renderEditor(vi.fn(), { type: "two-quadrant", axis: "x", variant: "spectrum", labels: { minLabel: "left", maxLabel: "right" } });
    const axis = document.querySelector(".arena-editor-axis")!;
    expect(axis.getAttribute("y1")).toBe("67");
    expect(axis.getAttribute("y2")).toBe("67");
    expect(document.querySelectorAll(".arena-editor-divider")).toHaveLength(0);
  });

  it("shows the perpendicular classification boundary for a hard split", async () => {
    await renderEditor(vi.fn(), { type: "two-quadrant", axis: "x", variant: "split", labels: { minLabel: "left", maxLabel: "right" } });
    const divider = document.querySelector(".arena-editor-divider")!;
    expect(divider.getAttribute("x1")).toBe("50");
    expect(divider.getAttribute("x2")).toBe("50");
    expect(document.querySelector(".arena-editor-axis")).toBeNull();
    expect(document.querySelector(".arena-editor-center")).toBeNull();
  });

  it("resizes the ellipse with edge handles and restores the PLATE-A preset", async () => {
    const onChange = vi.fn();
    const { svg } = await renderEditor(onChange);
    const right = document.querySelector('[data-arena-handle="right"]')!;

    await act(async () => { pointer(right, "pointerdown", 184, 147); });
    await act(async () => { pointer(svg, "pointermove", 190, 147); });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ centerX: 0.515, radiusX: 0.435 }));

    const preset = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Fit PLATE-A arena")!;
    await act(async () => { preset.click(); });
    expect(onChange).toHaveBeenLastCalledWith(PLATE_A_ARENA_PRESET);
  });
});
