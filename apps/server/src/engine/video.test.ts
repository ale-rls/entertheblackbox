import { describe, expect, it } from "vitest";
import { VideoPhaseHandler } from "./video.js";

const identity = { sessionId: "session-1", phaseId: "intro", phaseEpoch: 4 };

describe("VideoPhaseHandler", () => {
  it("ends exactly at the expected duration, once", () => {
    const video = new VideoPhaseHandler();
    const endAt = video.begin(identity, 10_000, 1_000);
    expect(endAt).toBe(11_000);
    expect(video.consumeEnded(endAt - 1)).toBeNull();
    expect(video.consumeEnded(endAt)).toEqual(identity);
    expect(video.consumeEnded(endAt + 1)).toBeNull();
  });

  it("cancels an obsolete phase", () => {
    const video = new VideoPhaseHandler();
    video.begin(identity, 10_000, 1_000);
    video.cancel();
    expect(video.consumeEnded(99_000)).toBeNull();
  });
});
