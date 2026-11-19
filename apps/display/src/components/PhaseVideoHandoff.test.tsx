// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PhaseSnapshotMessage } from "@entertheblackbox/protocol";
import { PhaseVideoHandoff, type PhaseVideoCandidate } from "./PhaseVideoHandoff.js";

const phase = (id: string, src: string): Extract<PhaseSnapshotMessage, { kind: "video" }> => ({
  kind: "video",
  id,
  src,
  expectedDurationMs: 10_000,
  next: "next",
  scenarioVersion: "show-1",
  startedAt: 1_000,
  deadlineAt: 16_000,
});

const candidate = (id: string, epoch: number): PhaseVideoCandidate => ({
  key: `session-1:${epoch}`,
  sessionId: "session-1",
  phase: phase(id, `${id}.mp4`),
  phaseEpoch: epoch,
  src: `blob:${id}`,
});

let root: Root | null = null;
let callbacks: Map<HTMLVideoElement, VideoFrameRequestCallback>;

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("PhaseVideoHandoff", () => {
  it("holds the outgoing frame until the incoming video presents a frame", async () => {
    callbacks = new Map();
    Object.defineProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback", {
      configurable: true,
      value(this: HTMLVideoElement, callback: VideoFrameRequestCallback) {
        callbacks.set(this, callback);
        return callbacks.size;
      },
    });
    Object.defineProperty(HTMLVideoElement.prototype, "cancelVideoFrameCallback", {
      configurable: true,
      value(this: HTMLVideoElement) { callbacks.delete(this); },
    });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const first = candidate("first", 1);
    const second = candidate("second", 2);
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.querySelector("#root")!);

    const render = async (desiredKey: string | null, value: PhaseVideoCandidate | null) => {
      await act(async () => {
        root?.render(
          <PhaseVideoHandoff
            desiredKey={desiredKey}
            candidate={value}
            soundEnabled={false}
            send={vi.fn()}
          />,
        );
        await Promise.resolve();
      });
    };
    const present = async (video: HTMLVideoElement) => {
      await act(async () => {
        video.dispatchEvent(new Event("playing"));
        callbacks.get(video)?.(performance.now(), { mediaTime: 0 } as VideoFrameCallbackMetadata);
        await Promise.resolve();
      });
    };

    await render(first.key, first);
    const firstVideo = document.querySelector<HTMLVideoElement>('video[src="blob:first"]')!;
    await present(firstVideo);
    expect(document.querySelector(".phase-video-slot-active")?.getAttribute("data-phase-key")).toBe(first.key);

    // The server phase can arrive before its Blob URL. Keep the old frame and
    // pause it instead of exposing the black layer background.
    await render(second.key, null);
    expect(pause).toHaveBeenCalled();
    expect(document.querySelector(".phase-video-slot-active")?.getAttribute("data-phase-key")).toBe(first.key);

    await render(second.key, second);
    const secondVideo = document.querySelector<HTMLVideoElement>('video[src="blob:second"]')!;
    expect(document.querySelector(".phase-video-slot-active")?.getAttribute("data-phase-key")).toBe(first.key);
    await present(secondVideo);
    expect(document.querySelector(".phase-video-slot-active")?.getAttribute("data-phase-key")).toBe(second.key);
    expect(document.querySelector('video[src="blob:first"]')).toBeNull();
  });

  it("holds the last picture through video, still, and video transitions and clears on a media-free cue", async () => {
    callbacks = new Map();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const first = candidate("first", 1);
    const still = { ...candidate("still", 2), audioSrc: "blob:soundtrack" };
    const final = candidate("final", 3);
    const send = vi.fn();
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.querySelector("#root")!);

    const render = async (desiredKey: string | null, value: PhaseVideoCandidate | null) => {
      await act(async () => { root!.render(<PhaseVideoHandoff desiredKey={desiredKey} candidate={value} soundEnabled={false} send={send} />); });
    };
    const activeKey = () => document.querySelector(".phase-video-slot-active")?.getAttribute("data-phase-key");
    const present = async (video: HTMLVideoElement) => {
      await act(async () => {
        video.dispatchEvent(new Event("playing"));
        callbacks.get(video)?.(performance.now(), { mediaTime: 0 } as VideoFrameCallbackMetadata);
      });
    };

    await render(first.key, first);
    const firstVideo = document.querySelector("video")!;
    await present(firstVideo);
    expect(activeKey()).toBe(first.key);

    await render(still.key, null);
    expect(activeKey()).toBe(first.key);
    await render(still.key, still);
    expect(activeKey()).toBe(first.key);
    const image = document.querySelector("img")!;
    const audio = document.querySelector("audio")!;
    expect(audio.autoplay).toBe(true);
    await act(async () => { image.dispatchEvent(new Event("load")); });
    expect(activeKey()).toBe(still.key);

    await render(final.key, final);
    expect(activeKey()).toBe(still.key);
    expect(audio.autoplay).toBe(false);
    expect(pause.mock.contexts).toContain(audio);

    const pendingVideo = document.querySelector("video")!;
    await act(async () => { pendingVideo.dispatchEvent(new Event("playing")); });
    const staleCallback = callbacks.get(pendingVideo)!;

    await render(null, null);
    expect(activeKey()).toBeUndefined();
    await act(async () => { staleCallback(performance.now(), { mediaTime: 0 } as VideoFrameCallbackMetadata); });
    expect(document.querySelector("video, img, audio")).toBeNull();
  });

  it("keeps a still visible while the next still loads and stops the old soundtrack", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const send = vi.fn();
    const first = { ...candidate("first-still", 1), audioSrc: "blob:audio-first" };
    const second = { ...candidate("second-still", 2), audioSrc: "blob:audio-second" };
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.querySelector("#root")!);
    const render = async (value: PhaseVideoCandidate) => {
      await act(async () => { root!.render(<PhaseVideoHandoff desiredKey={value.key} candidate={value} soundEnabled={false} send={send} />); });
    };

    await render(first);
    const firstImage = document.querySelector("img")!;
    const firstAudio = document.querySelector("audio")!;
    await act(async () => { firstImage.dispatchEvent(new Event("load")); });
    await render(second);
    expect(document.querySelector(".phase-video-slot-active img")).toBe(firstImage);
    expect(firstAudio.autoplay).toBe(false);
    expect(pause.mock.contexts).toContain(firstAudio);
    const secondImage = document.querySelector<HTMLImageElement>('img[src="blob:second-still"]')!;
    await act(async () => { secondImage.dispatchEvent(new Event("load")); });
    expect(document.querySelector(".phase-video-slot-active img")).toBe(secondImage);
    expect(firstImage.isConnected).toBe(false);
  });

  it("updates a prepared slot when its extra audio changes", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const value = {
      ...candidate("question", 2),
      src: "blob:shared-loop",
      extraAudioSrc: "blob:question-1",
    };
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.querySelector("#root")!);

    await act(async () => {
      root?.render(
        <PhaseVideoHandoff
          desiredKey={value.key}
          candidate={value}
          soundEnabled={false}
          send={vi.fn()}
        />,
      );
      await Promise.resolve();
    });
    expect(document.querySelector("audio")?.getAttribute("src")).toBe("blob:question-1");

    await act(async () => {
      root?.render(
        <PhaseVideoHandoff
          desiredKey={value.key}
          candidate={{ ...value, extraAudioSrc: "blob:question-2" }}
          soundEnabled={false}
          send={vi.fn()}
        />,
      );
      await Promise.resolve();
    });
    expect(document.querySelector("audio")?.getAttribute("src")).toBe("blob:question-2");
  });
});


it("reveals a decoded playing video when the compositor callback never arrives", async () => {
  vi.useFakeTimers();
  Object.defineProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback", { configurable: true, value: vi.fn(() => 1) });
  Object.defineProperty(HTMLVideoElement.prototype, "cancelVideoFrameCallback", { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  const value = candidate("hidden", 3);
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.querySelector("#root")!);
  await act(async () => { root!.render(<PhaseVideoHandoff desiredKey={value.key} candidate={value} soundEnabled={false} send={vi.fn()} />); });
  const video = document.querySelector("video")!;
  Object.defineProperties(video, {
    readyState: { configurable: true, value: 1 },
    videoWidth: { configurable: true, value: 640 },
    videoHeight: { configurable: true, value: 360 },
    paused: { configurable: true, value: false },
  });
  await act(async () => { video.dispatchEvent(new Event("playing")); });
  expect(document.querySelector(".phase-video-slot-active")).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(document.querySelector(".phase-video-slot-active")).toBeNull();
  Object.defineProperty(video, "readyState", { configurable: true, value: 2 });
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(document.querySelector(".phase-video-slot-active")?.getAttribute("data-phase-key")).toBe(value.key);
  expect(video.cancelVideoFrameCallback).toHaveBeenCalledWith(1);
});
