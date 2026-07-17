import { describe, expect, it, vi } from "vitest";
import type { PhaseSnapshotMessage } from "@smartphonecracy/protocol";
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

describe("PhaseVideo", () => {
  it("reports the current video identity when playback ends", () => {
    const send = vi.fn();
    const element = PhaseVideo({
      sessionId: "session-1",
      phase,
      phaseEpoch: 7,
      src: "blob:cached-intro",
      send,
    });

    element.props.onEnded();

    expect(send).toHaveBeenCalledWith({
      t: "video_ended",
      v: 2,
      sessionId: "session-1",
      phaseId: "intro",
      phaseEpoch: 7,
      mediaId: "media/intro.mp4",
    });
  });

  it("does not send an invalid completion before a session is known", () => {
    const send = vi.fn();
    const element = PhaseVideo({
      sessionId: null,
      phase,
      phaseEpoch: 7,
      src: "blob:cached-intro",
      send,
    });

    element.props.onEnded();

    expect(send).not.toHaveBeenCalled();
  });
});
