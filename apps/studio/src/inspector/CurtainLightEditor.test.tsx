// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CurtainSharedEditor, CurtainStageEditor } from "./CurtainLightEditor.js";
import type { Phase } from "./model.js";

let root: Root | null = null;

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no canvas; the preview simply does not animate.
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

async function mount(element: React.ReactElement) {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.querySelector("#root")!);
  await act(async () => root?.render(element));
}

const phase = {
  kind: "position-question", id: "vote", text: "Q?", durationMs: 1000, freezeMs: 0, connectionStaleAfterMs: 1000, showLiveCounts: false,
  field: { type: "two-quadrant", axis: "x", variant: "split", labels: { minLabel: "No", maxLabel: "Yes" } },
  next: { type: "fixed", target: "idle" },
  answerColors: { min: "#123456" },
} as unknown as Extract<Phase, { kind: "position-question" }>;

describe("CurtainStageEditor", () => {
  it("edits answer colours and resets them to system defaults", async () => {
    const onChange = vi.fn();
    await mount(<CurtainStageEditor phase={phase} scenario={{ curtainLight: { src: "c.mp4" } }} onChange={onChange} />);
    const swatches = [...document.querySelectorAll<HTMLInputElement>('input[type="color"]')];
    expect(swatches.map((input) => input.getAttribute("aria-label"))).toEqual(["Colour for No", "Colour for Yes"]);
    expect(swatches[0]!.value).toBe("#123456");
    const reset = [...document.querySelectorAll("button")].find((button) => button.textContent === "Reset colours to system defaults")!;
    await act(async () => reset.click());
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ answerColors: undefined }));
  });

  it("tunes the neutral gap for rehearsal", async () => {
    const onChange = vi.fn();
    await mount(<CurtainStageEditor phase={phase} scenario={{}} onChange={onChange} />);
    const gap = document.querySelector<HTMLInputElement>('input[aria-label="Neutral gap"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(gap, "0.12");
      gap.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange.mock.calls.at(-1)![0].field.neutralGap).toBe(0.12);
  });
});

describe("CurtainSharedEditor", () => {
  it("picks the curtain video from the media library", async () => {
    const onChange = vi.fn();
    await mount(<CurtainSharedEditor config={undefined} mediaSources={["a.mp3", "curtain.mp4"]} onChange={onChange} />);
    const select = document.querySelector<HTMLSelectElement>("select")!;
    expect([...select.options].map((option) => option.value)).toEqual(["", "curtain.mp4"]);
    await act(async () => {
      select.value = "curtain.mp4";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith({ src: "curtain.mp4" });
  });
});
