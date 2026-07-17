// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ServerClock } from "../lib/serverClock.js";
import { IdleAttract } from "./IdleAttract.js";

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

describe("IdleAttract", () => {
  it("rewinds and explicitly restarts playback each time idle remounts", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const render = async () => {
      document.body.innerHTML = '<div id="root"></div>';
      root = createRoot(document.querySelector("#root")!);
      await act(async () => {
        root?.render(<IdleAttract grant={null} qrHidden={false} clock={new ServerClock()} />);
        await Promise.resolve();
      });
      expect(document.querySelector("video")?.currentTime).toBe(0);
      await act(async () => root?.unmount());
      root = null;
    };

    await render();
    await render();

    expect(play).toHaveBeenCalledTimes(2);
  });
});
