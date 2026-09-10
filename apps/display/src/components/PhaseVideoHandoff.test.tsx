// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PhaseSnapshotMessage } from "@smartphonecracy/protocol";
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
