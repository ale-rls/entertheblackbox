// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ServerClock } from "../lib/serverClock.js";
import { IdleAttract } from "./IdleAttract.js";

let root: Root | null = null;

function installVideoFrameCallbacks() {
  let nextId = 1;
  const callbacks = new Map<number, { video: HTMLVideoElement; callback: VideoFrameRequestCallback }>();
  const request = function (this: HTMLVideoElement, callback: VideoFrameRequestCallback) {
    const id = nextId++;
    callbacks.set(id, { video: this, callback });
    return id;
  };
  const cancel = (id: number) => { callbacks.delete(id); };
  Object.defineProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback", {
    configurable: true,
    value: request,
  });
  Object.defineProperty(HTMLVideoElement.prototype, "cancelVideoFrameCallback", {
    configurable: true,
    value: cancel,
  });
  return {
    fire(video: HTMLVideoElement) {
      const entry = [...callbacks.entries()].find(([, value]) => value.video === video);
      if (entry === undefined) throw new Error("No pending video-frame callback");
      callbacks.delete(entry[0]);
      entry[1].callback(performance.now(), { mediaTime: video.currentTime } as VideoFrameCallbackMetadata);
    },
  };
}

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
  it("uses the advert hold clip as A in the bundled lobby playlist", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.querySelector("#root")!);
    await act(async () => {
      root?.render(<IdleAttract grant={null} qrHidden={false} clock={new ServerClock()} />);
      await Promise.resolve();
    });
    const src = document.querySelector(".idle-attract-video-active")?.getAttribute("src") ?? "";
    expect(src).toContain("1.0_25_c_advert.mp4");
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
      expect(document.querySelector<HTMLVideoElement>(".idle-attract-video-active")?.currentTime).toBe(0);
      await act(async () => root?.unmount());
      root = null;
    };

    await render();
    await render();

    expect(play).toHaveBeenCalledTimes(2);
  });

  it("plays the hold clip every other time in an A-B-A-C rhythm", async () => {
    const frames = installVideoFrameCallbacks();
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
        />,
      );
      await Promise.resolve();
    });
    expect(document.querySelector(".idle-attract-video-active")?.getAttribute("src")).toBe("one.mp4");
    expect(document.querySelector<HTMLVideoElement>(".idle-attract-video-active")?.loop).toBe(false);

    await act(async () => {
      const active = document.querySelector<HTMLVideoElement>(".idle-attract-video-active")!;
      active.dispatchEvent(new Event("ended"));
      await Promise.resolve();
    });
    // The first clip remains visible until the browser presents a decoded
    // frame from the already-mounted standby element.
    expect(document.querySelector(".idle-attract-video-active")?.getAttribute("src")).toBe("one.mp4");
    const second = [...document.querySelectorAll<HTMLVideoElement>(".idle-attract-video")]
      .find((video) => video.getAttribute("src") === "two.mp4")!;
    await act(async () => {
      second.dispatchEvent(new Event("playing"));
      frames.fire(second);
      await Promise.resolve();
    });
    expect(document.querySelector(".idle-attract-video-active")?.getAttribute("src")).toBe("two.mp4");

    await act(async () => {
      second.dispatchEvent(new Event("ended"));
      await Promise.resolve();
    });
    const first = [...document.querySelectorAll<HTMLVideoElement>(".idle-attract-video")]
      .find((video) => video.getAttribute("src") === "one.mp4")!;
    await act(async () => {
      first.dispatchEvent(new Event("playing"));
      frames.fire(first);
      await Promise.resolve();
    });
    expect(document.querySelector(".idle-attract-video-active")?.getAttribute("src")).toBe("one.mp4");

    await act(async () => {
      first.dispatchEvent(new Event("ended"));
      await Promise.resolve();
    });
    const third = [...document.querySelectorAll<HTMLVideoElement>(".idle-attract-video")]
      .find((video) => video.getAttribute("src") === "three.mp4")!;
    await act(async () => {
      third.dispatchEvent(new Event("playing"));
      frames.fire(third);
      await Promise.resolve();
    });
    expect(document.querySelector(".idle-attract-video-active")?.getAttribute("src")).toBe("three.mp4");
  });
});
