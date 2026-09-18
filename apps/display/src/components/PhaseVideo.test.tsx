// @vitest-environment jsdom
import { ServerClock } from "@entertheblackbox/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DisplayToServerMessage, PhaseSnapshotMessage } from "@entertheblackbox/protocol";
import { PhaseVideo } from "./PhaseVideo.js";

const phase: Extract<PhaseSnapshotMessage, { kind: "video" }> = {
  kind: "video",
  id: "intro",
  src: "media/intro.mp4",
  expectedDurationMs: 15_042,
  next: "question",
  scenarioVersion: "show-1",
  startedAt: 1_000,
  deadlineAt: 21_042,
};

let root: Root | null = null;

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

async function renderVideo(
  send: (message: DisplayToServerMessage) => void,
  sessionId: string | null = "session-1",
  soundEnabled = false,
  videoPhase = phase,
  extraAudioSrc?: string,
  clock?: ServerClock,
) {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.querySelector("#root")!);
  await act(async () => {
    root?.render(
      <PhaseVideo
        sessionId={sessionId}
        phase={videoPhase}
        phaseEpoch={7}
        src="blob:cached-intro"
        {...(extraAudioSrc === undefined ? {} : { extraAudioSrc })}
        soundEnabled={soundEnabled}
        send={send}
        {...(clock ? { clock } : {})}
      />,
    );
    await Promise.resolve();
  });
  return document.querySelector("video")!;
}

describe("PhaseVideo", () => {
  it("reports completion and playback diagnostics from the same video element", async () => {
    const send = vi.fn();
    const video = await renderVideo(send);

    expect(video.muted).toBe(true);

    video.dispatchEvent(new Event("stalled"));
    video.dispatchEvent(new Event("ended"));

    expect(send).toHaveBeenNthCalledWith(1, {
      t: "display_playback_status",
      v: 2,
      sessionId: "session-1",
      phaseId: "intro",
      phaseEpoch: 7,
      mediaId: "media/intro.mp4",
      status: "stalled",
      detail: "The browser stalled while loading media data",
    });
    expect(send).toHaveBeenNthCalledWith(2, {
      t: "video_ended",
      v: 2,
      sessionId: "session-1",
      phaseId: "intro",
      phaseEpoch: 7,
      mediaId: "media/intro.mp4",
    });
  });

  it("does not send invalid completion or diagnostics before a session is known", async () => {
    const send = vi.fn();
    const video = await renderVideo(send, null);

    video.dispatchEvent(new Event("stalled"));
    video.dispatchEvent(new Event("ended"));

    expect(send).not.toHaveBeenCalled();
  });

  it("unmutes scenario video after the display sound control is enabled", async () => {
    const video = await renderVideo(vi.fn(), "session-1", true);

    expect(video.muted).toBe(false);
    expect(video.playsInline).toBe(true);
  });

  it("plays an optional audio track alongside the video without letting it end the phase", async () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const send = vi.fn();
    const video = await renderVideo(send, "session-1", true, phase, "blob:cached-soundtrack");
    const audio = document.querySelector("audio")!;

    expect(audio.src).toContain("blob:cached-soundtrack");
    expect(audio.muted).toBe(false);
    expect(audio.getAttribute("aria-label")).toBe("Extra video audio track");

    audio.dispatchEvent(new Event("ended"));
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ t: "video_ended" }));

    video.dispatchEvent(new Event("ended"));
    expect(pause).toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ t: "video_ended", phaseId: "intro" }));
  });

  it("holds the final video frame for the configured visual tail", async () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const video = await renderVideo(send, "session-1", false, {
      ...phase,
      tailDurationMs: 2_000,
      expectedDurationMs: phase.expectedDurationMs + 2_000,
    });

    video.dispatchEvent(new Event("ended"));
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_999);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ t: "video_ended", phaseId: "intro" }));
  });
});


it("waits for the shared start, mutes all video sound and catches up to the clock", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  const clock = new ServerClock();
  clock.addSample(1000, 1000, 5000);
  const video = await renderVideo(vi.fn(), "session-1", true,
    { ...phase, phoneAudioMode: "synchronized", phoneAudioSrc: "voice.mp3", startedAt: 6000 }, "blob:extra", clock);
  Object.defineProperty(video, "readyState", { value: 4 });
  Object.defineProperty(video, "duration", { value: 15 });
  expect(video.autoplay).toBe(false);
  expect(video.muted).toBe(true);
  expect(document.querySelector("audio")).toBeNull();
  expect(video.play).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(950); });
  expect(video.play).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(video.play).toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(video.currentTime).toBeGreaterThan(0.8);
});


it("lets an outstanding synchronized seek finish before correcting the clock again", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(5000);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  const clock = new ServerClock();
  clock.addSample(5000, 5000, 5000);
  const video = await renderVideo(vi.fn(), "session-1", false,
    { ...phase, phoneAudioMode: "synchronized", phoneAudioSrc: "voice.mp3", startedAt: 1000 }, undefined, clock);
  const seek = vi.fn();
  Object.defineProperties(video, {
    readyState: { value: 2 }, duration: { value: 15 },
    seeking: { configurable: true, value: true },
    currentTime: { get: () => 0, set: seek },
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(seek).not.toHaveBeenCalled();
  Object.defineProperty(video, "seeking", { value: false });
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  expect(seek).toHaveBeenCalledTimes(1);
  expect(seek.mock.calls[0]![0]).toBeCloseTo(4.55);
});
