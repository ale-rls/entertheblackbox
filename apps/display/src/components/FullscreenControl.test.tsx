// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { FullscreenControl } from "./FullscreenControl.js";

let root: Root | null = null;

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

async function renderControl() {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.querySelector("#root")!);
  await act(async () => root?.render(<FullscreenControl />));
  return document.querySelector<HTMLButtonElement>(".fullscreen-control")!;
}

describe("FullscreenControl", () => {
  it("enters fullscreen, hides the control there, and returns after an external exit", async () => {
    let fullscreenElement: Element | null = null;
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fullscreenElement,
    });
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      configurable: true,
      value: vi.fn(async () => {
        fullscreenElement = document.documentElement;
        document.dispatchEvent(new Event("fullscreenchange"));
      }),
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: vi.fn(async () => {
        fullscreenElement = null;
        document.dispatchEvent(new Event("fullscreenchange"));
      }),
    });

    const button = await renderControl();
    expect(button.textContent).toBe("Enter fullscreen");

    await act(async () => button.click());
    expect(document.documentElement.requestFullscreen).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".fullscreen-control")).toBeNull();
    expect(document.exitFullscreen).not.toHaveBeenCalled();

    await act(async () => {
      fullscreenElement = null;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(document.querySelector(".fullscreen-control")?.textContent).toBe("Enter fullscreen");
  });

  it("shows a useful status when the browser blocks fullscreen", async () => {
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      configurable: true,
      value: vi.fn().mockRejectedValue(new Error("denied")),
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: vi.fn(),
    });

    const button = await renderControl();
    await act(async () => button.click());

    expect(document.querySelector('[role="status"]')?.textContent)
      .toBe("Fullscreen was blocked by the browser.");
  });
});
