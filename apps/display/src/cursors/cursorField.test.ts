import { describe, expect, it } from "vitest";
import {
  PROTOCOL_VERSION,
  type CursorsMessage,
  type ServerToClientMessage,
} from "@smartphonecracy/protocol";
import { CursorField, RENDER_DELAY_MS } from "./cursorField.js";
import { displayReducer, initialDisplayState, type DisplayState } from "../state/store.js";

const batch = (tick: number, cursors: Array<[string, number, number]>): CursorsMessage => ({
  t: "cursors",
  v: PROTOCOL_VERSION,
  tick,
  cursors: cursors.map(([clientId, x, y]) => ({ clientId, x, y, color: "#fff" })),
});

describe("CursorField", () => {
  it("interpolates between the last two ticks at render-delay time", () => {
    const field = new CursorField();
    field.ingest(batch(1, [["a", 0.0, 0.0]]), 1000);
    field.ingest(batch(2, [["a", 1.0, 1.0]]), 1050);
    // renderTime = 1125 - 100 = 1025 -> halfway between samples
    const [a] = field.renderAt(1125);
    expect(a!.x).toBeCloseTo(0.5);
    expect(a!.y).toBeCloseTo(0.5);
  });

  it("holds the latest position once render time passes it", () => {
    const field = new CursorField();
    field.ingest(batch(1, [["a", 0.2, 0.2]]), 1000);
    field.ingest(batch(2, [["a", 0.8, 0.8]]), 1050);
    const [a] = field.renderAt(1050 + RENDER_DELAY_MS + 500);
    expect(a!.x).toBe(0.8);
  });

  it("drops cursors absent from a full batch and ignores stale ticks", () => {
    const field = new CursorField();
    field.ingest(batch(5, [["a", 0.1, 0.1], ["b", 0.2, 0.2]]), 1000);
    field.ingest(batch(6, [["a", 0.1, 0.1]]), 1040);
    expect(field.size).toBe(1);
    field.ingest(batch(4, [["a", 0.9, 0.9], ["b", 0.2, 0.2]]), 1080); // stale
    expect(field.size).toBe(1);
    const [a] = field.renderAt(5000);
    expect(a!.x).toBe(0.1);
  });

  it("ignores batches while frozen", () => {
    const field = new CursorField();
    field.ingest(batch(1, [["a", 0.3, 0.3]]), 1000);
    field.setFrozen(true);
    field.ingest(batch(2, [["a", 0.9, 0.9]]), 1050);
    const [a] = field.renderAt(5000);
    expect(a!.x).toBe(0.3);
  });

  it("clears positions and accepts fresh ticks for a new session", () => {
    const field = new CursorField();
    field.ingest(batch(8, [["a", 0.3, 0.3]]), 1000);
    field.setFrozen(true);

    field.clear();

    expect(field.size).toBe(0);
    expect(field.isFrozen).toBe(false);
    field.ingest(batch(1, [["b", 0.8, 0.8]]), 1100);
    expect(field.renderAt(5000).map(({ clientId }) => clientId)).toEqual(["b"]);
  });
});

const apply = (state: DisplayState, message: ServerToClientMessage) =>
  displayReducer(state, { type: "server-message", message });

const questionField = {
  type: "four-quadrant",
  xAxis: { minLabel: "a", maxLabel: "b" },
  yAxis: { minLabel: "c", maxLabel: "d" },
} as const;

const questionState = (): DisplayState =>
  apply(initialDisplayState, {
    t: "snapshot",
    v: PROTOCOL_VERSION,
    sessionId: "s1",
    phaseEpoch: 4,
    serverTime: 0,
    phase: {
      kind: "position-question",
      id: "q1",
      text: "t",
      field: questionField,
      durationMs: 60_000,
      freezeMs: 3_000,
      connectionStaleAfterMs: 30_000,
      showLiveCounts: true,
      next: { type: "fixed", target: "idle" },
      scenarioVersion: "dev",
      startedAt: 0,
      deadlineAt: 60_000,
    },
  });

describe("question status/resolution state", () => {
  it("stores live counts only from the current epoch", () => {
    let s = questionState();
    s = apply(s, {
      t: "question_status",
      v: PROTOCOL_VERSION,
      sessionId: "s1",
      phaseEpoch: 4,
      connectedCount: 3,
      positionedCount: 2,
      field: questionField,
      quadrantCounts: { q1: 2, q2: 0, q3: 0, q4: 0 },
    });
    expect(s.liveCounts).toEqual({ q1: 2, q2: 0, q3: 0, q4: 0 });
    expect(s.liveField).toEqual(questionField);
    const stale = apply(s, {
      t: "question_status",
      v: PROTOCOL_VERSION,
      sessionId: "s1",
      phaseEpoch: 3,
      connectedCount: 9,
      positionedCount: 9,
      field: questionField,
      quadrantCounts: { q1: 9, q2: 9, q3: 9, q4: 9 },
    });
    expect(stale.liveCounts).toEqual({ q1: 2, q2: 0, q3: 0, q4: 0 });
  });

  it("clears liveCounts when the server omits them (showLiveCounts off)", () => {
    let s = questionState();
    s = apply(s, {
      t: "question_status",
      v: PROTOCOL_VERSION,
      sessionId: "s1",
      phaseEpoch: 4,
      connectedCount: 3,
      positionedCount: 2,
      field: questionField,
      quadrantCounts: { q1: 1, q2: 0, q3: 0, q4: 0 },
    });
    s = apply(s, {
      t: "question_status",
      v: PROTOCOL_VERSION,
      sessionId: "s1",
      phaseEpoch: 4,
      connectedCount: 3,
      positionedCount: 3,
      field: questionField,
    });
    expect(s.liveCounts).toBeNull();
    expect(s.liveField).toBeNull();
  });

  it("stores resolution for the current epoch and clears it on the next phase", () => {
    let s = questionState();
    s = apply(s, {
      t: "question_resolved",
      v: PROTOCOL_VERSION,
      sessionId: "s1",
      phaseEpoch: 4,
      field: questionField,
      quadrantCounts: { q1: 3, q2: 1, q3: 0, q4: 0 },
      winner: "q1",
      resolvedTarget: "video-2",
      freezeUntil: 63_000,
    });
    expect(s.resolution?.winner).toBe("q1");
    s = apply(s, {
      t: "phase",
      v: PROTOCOL_VERSION,
      sessionId: "s1",
      phaseEpoch: 5,
      serverTime: 0,
      phase: {
        kind: "video",
        id: "video-2",
        src: "v2.mp4",
        expectedDurationMs: 5_000,
        next: "idle",
        scenarioVersion: "dev",
        startedAt: 0,
        deadlineAt: null,
      },
    });
    expect(s.resolution).toBeNull();
    expect(s.liveCounts).toBeNull();
  });
});
