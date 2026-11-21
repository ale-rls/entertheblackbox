// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ServerClock } from "@entertheblackbox/shared";
import { LoopHandoff, type LoopTarget } from "./LoopVideo.js";

const clock = { ready: true, now: () => 10_000 } as unknown as ServerClock;
const loop: LoopTarget = { src: "closed.mp4", url: "blob:closed.mp4", anchorAt: 9_000 };
let root: Root | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.useRealTimers();
});

async function render(target: LoopTarget | null, fadeOutMs: number) {
  await act(async () => root!.render(<LoopHandoff target={target} pending={false} hold={false} revealAllowed clock={clock} fadeOutMs={fadeOutMs} />));
}

async function showLoop() {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.querySelector("#root")!);
  await render(loop, 500);
  const video = document.querySelector<HTMLVideoElement>("video.phase-loop-video")!;
  Object.defineProperties(video, {
    readyState: { configurable: true, value: 2 },
    videoWidth: { configurable: true, value: 64 },
    paused: { configurable: true, value: false },
  });
  await act(async () => { video.dispatchEvent(new Event("loadeddata")); });
  expect(video.classList.contains("phase-loop-video-active")).toBe(true);
  return video;
}

describe("LoopHandoff", () => {
  it("dissolves a leaving loop into the picture underneath, then removes it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const video = await showLoop();
    await render(null, 500);
    expect(document.querySelector("video.phase-loop-video")).toBe(video);
    expect(video.style.opacity).toBe("0");
    expect(video.style.transition).toBe("opacity 500ms linear");
    await act(async () => { vi.advanceTimersByTime(499); });
    expect(document.querySelector("video.phase-loop-video")).toBe(video);
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(document.querySelector("video.phase-loop-video")).toBeNull();
  });

  it("cuts a leaving loop at once without a dissolve", async () => {
    await showLoop();
    await render(null, 0);
    expect(document.querySelector("video.phase-loop-video")).toBeNull();
  });

  it("brings a dissolving loop back if the scene wants it again", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const video = await showLoop();
    await render(null, 500);
    await render(loop, 500);
    await act(async () => { vi.advanceTimersByTime(1_000); });
    expect(document.querySelector("video.phase-loop-video")).toBe(video);
    expect(video.style.opacity).toBe("");
  });
});
