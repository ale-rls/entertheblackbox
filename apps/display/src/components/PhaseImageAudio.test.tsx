// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DisplayToServerMessage, PhaseSnapshotMessage } from "@smartphonecracy/protocol";
import { PhaseImageAudio } from "./PhaseImageAudio.js";

const phase: Extract<PhaseSnapshotMessage, { kind: "video" }> & { audioSrc: string } = {
  kind: "video",
  id: "image-intro",
  src: "portrait.png",
  audioSrc: "voice.mp3",
  expectedDurationMs: 12_000,
  next: "idle",
  scenarioVersion: "show-1",
  startedAt: 1_000,
  deadlineAt: 15_000,
};

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

async function renderPair(send: (message: DisplayToServerMessage) => void, soundEnabled = false) {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.querySelector("#root")!);
  await act(async () => {
    root?.render(<PhaseImageAudio sessionId="session-1" phase={phase} phaseEpoch={3} imageSrc="blob:image" audioSrc="blob:audio" soundEnabled={soundEnabled} send={send} />);
    await Promise.resolve();
  });
  return { image: document.querySelector("img")!, audio: document.querySelector("audio")! };
}

describe("PhaseImageAudio", () => {
  it("holds the still image while MP3 playback drives phase completion", async () => {
    const send = vi.fn();
    const { image, audio } = await renderPair(send);
    expect(image.getAttribute("src")).toBe("blob:image");
    expect(audio.getAttribute("src")).toBe("blob:audio");
    expect(audio.muted).toBe(true);

    audio.dispatchEvent(new Event("ended"));
    expect(send).toHaveBeenCalledWith({
      t: "video_ended",
      v: 2,
      sessionId: "session-1",
      phaseId: "image-intro",
      phaseEpoch: 3,
      mediaId: "portrait.png",
    });
  });

  it("plays the MP3 audibly after sound has been unlocked", async () => {
    const { audio } = await renderPair(vi.fn(), true);
    expect(audio.muted).toBe(false);
  });
});
