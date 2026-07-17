// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DisplayToServerMessage, PhaseSnapshotMessage } from "@smartphonecracy/protocol";
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
  vi.restoreAllMocks();
});

async function renderVideo(
  send: (message: DisplayToServerMessage) => void,
  sessionId: string | null = "session-1",
) {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.querySelector("#root")!);
  await act(async () => {
    root?.render(
      <PhaseVideo
        sessionId={sessionId}
        phase={phase}
        phaseEpoch={7}
        src="blob:cached-intro"
        send={send}
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
      detail: "The browser stalled while loading video data",
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
});
