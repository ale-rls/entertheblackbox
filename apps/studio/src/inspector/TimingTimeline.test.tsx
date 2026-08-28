// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TimingTimeline } from "./TimingTimeline.js";
import { formatTimelineTime } from "./timing.js";

let root: Root | null = null;

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("TimingTimeline", () => {
  it("formats millisecond offsets as compact ruler labels", () => {
    expect(formatTimelineTime(-12_000)).toBe("−12.0s");
    expect(formatTimelineTime(250)).toBe("250 ms");
    expect(formatTimelineTime(65_000)).toBe("1:05.0");
  });

  it("previews slider movement locally and commits once on release", async () => {
    const changed = vi.fn();
    function Harness() {
      const [value, setValue] = useState(1_000);
      return <TimingTimeline label="Vote" min={0} max={10_000} markers={[{ id: "show", label: "Show question", runtime: "showAtMs", value, onChange: (next) => { changed(next); setValue(next); } }]} />;
    }
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.querySelector("#root")!);
    await act(async () => root?.render(<Harness />));
    const slider = document.querySelector<HTMLInputElement>('input[aria-label="Show question timeline slider"]')!;

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(slider, "2400");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(changed).not.toHaveBeenCalled();
    expect(document.querySelector("output")?.textContent).toBe("2.4s");

    await act(async () => { slider.dispatchEvent(new Event("pointerup", { bubbles: true })); });
    expect(changed).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenCalledWith(2_400);
  });
});
