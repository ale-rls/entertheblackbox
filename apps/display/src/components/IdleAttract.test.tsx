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
  it("uses only the three current 1.0 attract clips in the bundled lobby playlist", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.querySelector("#root")!);
    await act(async () => {
      root?.render(<IdleAttract grant={null} qrHidden={false} clock={new ServerClock()} random={() => 0} />);
      await Promise.resolve();
    });
    const src = document.querySelector("video")?.getAttribute("src") ?? "";
    expect(src).toContain("1.0_25_a_breath.mp4");
    expect(src).not.toContain("idle-attract.mp4");
  });

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

  it("plays multiple clips back to back without an immediate repeat", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.querySelector("#root")!);

    await act(async () => {
      root?.render(
        <IdleAttract
          grant={null}
          qrHidden={false}
          clock={new ServerClock()}
          videoUrls={["one.mp4", "two.mp4", "three.mp4"]}
          random={() => 0}
        />,
      );
      await Promise.resolve();
    });
    expect(document.querySelector("video")?.getAttribute("src")).toBe("one.mp4");
    expect(document.querySelector("video")?.loop).toBe(false);

    await act(async () => {
      document.querySelector("video")?.dispatchEvent(new Event("ended"));
      await Promise.resolve();
    });
    expect(document.querySelector("video")?.getAttribute("src")).toBe("two.mp4");

    await act(async () => {
      document.querySelector("video")?.dispatchEvent(new Event("ended"));
      await Promise.resolve();
    });
    expect(document.querySelector("video")?.getAttribute("src")).toBe("one.mp4");
  });
});
