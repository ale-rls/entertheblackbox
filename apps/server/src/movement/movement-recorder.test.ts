import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MovementRecorder,
  type MovementBatchFlushed,
  type MovementRecorderOptions,
  type MovementRecordingFinalized,
  type MovementRecordingStarted,
} from "./movement-recorder.js";

function makeRecorder(overrides: Partial<MovementRecorderOptions> = {}) {
  const started: MovementRecordingStarted[] = [];
  const batches: MovementBatchFlushed[] = [];
  const finalized: MovementRecordingFinalized[] = [];
  const recorder = new MovementRecorder({
    showId: "show-1",
    scenarioVersion: "v1",
    installationId: "inst-1",
    roomId: "room-1",
    onRecordingStarted: (event) => started.push(event),
    onBatchFlushed: (event) => batches.push(event),
    onRecordingFinalized: (event) => finalized.push(event),
    ...overrides,
  });
  return { recorder, started, batches, finalized };
}

describe("MovementRecorder", () => {
  afterEach(() => vi.useRealTimers());

  it("starts a recording lazily on the first sample, with t: 0", () => {
    const { recorder, started } = makeRecorder();
    recorder.join("p1", "session-1");
    recorder.recordSample("p1", 0.5, 0.5, 1_000);
    expect(started).toEqual([{
      recordingId: "session-1:p1:1000",
      sessionId: "session-1",
      participantId: "p1",
      showId: "show-1",
      scenarioVersion: "v1",
      installationId: "inst-1",
      roomId: "room-1",
      startedAt: 1_000,
    }]);
    recorder.recordSample("p1", 0.6, 0.6, 1_000);
    expect(started).toHaveLength(1);
  });

  it("accumulates elapsed-ms relative to the recording's own start, not wall-clock or phase time", () => {
    const { recorder, finalized } = makeRecorder({ sampleThreshold: 1_000 });
    recorder.join("p1", "session-1");
    recorder.recordSample("p1", 0.1, 0.1, 5_000);
    recorder.recordSample("p1", 0.2, 0.2, 5_400);
    recorder.recordSample("p1", 0.3, 0.3, 6_100);
    recorder.finalizeSession(6_200);
    expect(finalized).toHaveLength(1);
  });

  it("flushes a batch once the sample-count threshold is hit", () => {
    const { recorder, batches } = makeRecorder({ sampleThreshold: 3, intervalMs: 60_000 });
    recorder.join("p1", "session-1");
    recorder.recordSample("p1", 0, 0, 0);
    recorder.recordSample("p1", 0.1, 0.1, 10);
    expect(batches).toEqual([]);
    recorder.recordSample("p1", 0.2, 0.2, 20);
    expect(batches).toEqual([{
      recordingId: "session-1:p1:0",
      sessionId: "session-1",
      batchIndex: 0,
      recordedAt: 20,
      samples: [{ t: 0, x: 0, y: 0 }, { t: 10, x: 0.1, y: 0.1 }, { t: 20, x: 0.2, y: 0.2 }],
    }]);
    recorder.recordSample("p1", 0.3, 0.3, 30);
    expect(batches).toHaveLength(1);
  });

  it("flushes a batch once the time threshold is hit via tick()", () => {
    const { recorder, batches } = makeRecorder({ sampleThreshold: 1_000, intervalMs: 5_000 });
    recorder.join("p1", "session-1");
    recorder.recordSample("p1", 0.5, 0.5, 1_000);
    recorder.tick(4_000);
    expect(batches).toEqual([]);
    recorder.tick(6_500);
    expect(batches).toEqual([{
      recordingId: "session-1:p1:1000",
      sessionId: "session-1",
      batchIndex: 0,
      recordedAt: 6_500,
      samples: [{ t: 0, x: 0.5, y: 0.5 }],
    }]);
    recorder.tick(6_600);
    expect(batches).toHaveLength(1);
  });

  it("clamps out-of-range coordinates and drops non-finite samples", () => {
    const { recorder, batches } = makeRecorder({ sampleThreshold: 2 });
    recorder.join("p1", "session-1");
    recorder.recordSample("p1", Number.NaN, 0.5, 0);
    recorder.recordSample("p1", -0.2, 1.4, 10);
    recorder.recordSample("p1", 0.3, 0.3, 20);
    expect(batches).toEqual([{
      recordingId: "session-1:p1:10",
      sessionId: "session-1",
      batchIndex: 0,
      recordedAt: 20,
      samples: [{ t: 0, x: 0, y: 1 }, { t: 10, x: 0.3, y: 0.3 }],
    }]);
  });

  it("produces no callbacks at all when a joined participant never sends a sample", () => {
    const { recorder, started, batches, finalized } = makeRecorder();
    recorder.join("p1", "session-1");
    recorder.leave("p1", 5_000);
    expect(started).toEqual([]);
    expect(batches).toEqual([]);
    expect(finalized).toEqual([]);
  });

  it("recordSample is a no-op for a participant that was never joined", () => {
    const { recorder, started, batches } = makeRecorder();
    recorder.recordSample("ghost", 0.5, 0.5, 1_000);
    expect(started).toEqual([]);
    expect(batches).toEqual([]);
  });

  it("leave() flushes the remaining buffer and finalizes as abandoned", () => {
    const { recorder, batches, finalized } = makeRecorder({ sampleThreshold: 1_000 });
    recorder.join("p1", "session-1");
    recorder.recordSample("p1", 0.1, 0.1, 0);
    recorder.recordSample("p1", 0.2, 0.2, 100);
    recorder.leave("p1", 500);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.samples).toHaveLength(2);
    expect(finalized).toEqual([{
      recordingId: "session-1:p1:0",
      endedAt: 500,
      status: "abandoned",
      sampleCount: 2,
    }]);
  });

  it("finalizeSession() flushes and finalizes every open recording as completed, no-op otherwise", () => {
    const { recorder, finalized } = makeRecorder({ sampleThreshold: 1_000 });
    recorder.join("p1", "session-1");
    recorder.join("p2", "session-1");
    recorder.recordSample("p1", 0.1, 0.1, 0);
    // p2 never sends a sample.
    recorder.finalizeSession(1_000);
    expect(finalized).toEqual([{
      recordingId: "session-1:p1:0",
      endedAt: 1_000,
      status: "completed",
      sampleCount: 1,
    }]);
    finalized.length = 0;
    recorder.finalizeSession(2_000);
    expect(finalized).toEqual([]);
  });

  it("a full drop-then-reconnect within the same session produces two independent recordings", () => {
    const { recorder, started, finalized } = makeRecorder();
    recorder.join("p1", "session-1");
    recorder.recordSample("p1", 0.1, 0.1, 1_000);
    recorder.leave("p1", 2_000);
    recorder.join("p1", "session-1");
    recorder.recordSample("p1", 0.2, 0.2, 3_000);
    recorder.leave("p1", 4_000);
    expect(started.map((e) => e.recordingId)).toEqual(["session-1:p1:1000", "session-1:p1:3000"]);
    expect(finalized.map((e) => e.recordingId)).toEqual(["session-1:p1:1000", "session-1:p1:3000"]);
  });

  it("starts its own timer on start() and flushes via the interval; stop() halts it", () => {
    vi.useFakeTimers();
    const { recorder, batches } = makeRecorder({ sampleThreshold: 1_000, intervalMs: 2_000 });
    recorder.start();
    recorder.start();
    recorder.join("p1", "session-1");
    recorder.recordSample("p1", 0.5, 0.5, Date.now());
    expect(batches).toEqual([]);
    vi.advanceTimersByTime(2_500);
    expect(batches).toHaveLength(1);

    recorder.stop();
    recorder.recordSample("p1", 0.6, 0.6, Date.now());
    vi.advanceTimersByTime(3_000);
    expect(batches).toHaveLength(1);
  });
});
