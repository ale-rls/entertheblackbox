// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PolygonEditor } from "./PolygonEditor.js";

const zones = [
  { id: "alpha", label: "Alpha", points: [{ x: 0, y: 0 }, { x: 0.4, y: 0 }, { x: 0.4, y: 1 }, { x: 0, y: 1 }] },
  { id: "beta", label: "Beta", points: [{ x: 0.6, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0.6, y: 1 }] },
];

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

async function renderEditor(onChange = vi.fn()) {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.querySelector("#root")!);
  await act(async () => root?.render(<PolygonEditor zones={zones} onChange={onChange} />));
  const svg = document.querySelector<SVGSVGElement>(".polygon-editor-canvas")!;
  vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200, x: 0, y: 0, toJSON: () => ({}) });
  return { svg, onChange };
}

function pointer(target: Element, type: string, clientX: number, clientY: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    clientX: { value: clientX },
    clientY: { value: clientY },
    pointerId: { value: 1 },
  });
  target.dispatchEvent(event);
}

describe("PolygonEditor", () => {
  it("shows every authored zone and draggable handles for the selected polygon", async () => {
    await renderEditor();
    expect(document.querySelectorAll(".polygon-editor-zone")).toHaveLength(2);
    expect(document.querySelectorAll(".polygon-editor-handle")).toHaveLength(4);

    await act(async () => { Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "Beta")?.click(); });
    expect(document.querySelector('[data-zone-id="beta"]')?.classList.contains("is-selected")).toBe(true);
    expect(document.querySelectorAll(".polygon-editor-handle")).toHaveLength(4);
  });

  it("redraws a selected polygon from clicked points without saving an incomplete shape", async () => {
    const onChange = vi.fn();
    const { svg } = await renderEditor(onChange);
    const button = (text: string) => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent === text)!;

    await act(async () => { button("Redraw selected zone").click(); });
    expect(button("Save polygon").disabled).toBe(true);
    await act(async () => { pointer(svg, "pointerdown", 20, 20); });
    await act(async () => { pointer(svg, "pointerdown", 180, 20); });
    expect(onChange).not.toHaveBeenCalled();
    expect(button("Save polygon").disabled).toBe(true);

    await act(async () => { pointer(svg, "pointerdown", 100, 180); });
    expect(button("Save polygon").disabled).toBe(false);
    await act(async () => { button("Save polygon").click(); });

    expect(onChange).toHaveBeenCalledWith([
      { ...zones[0], points: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.5, y: 0.9 }] },
      zones[1],
    ]);
  });
});
