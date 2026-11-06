import { afterEach, describe, expect, it, vi } from "vitest";
import type { CursorsMessage } from "@entertheblackbox/protocol";
import { CURSOR_TICK_INTERVAL_MS, CursorPipeline } from "./cursor-pipeline.js";

describe("CursorPipeline", () => {
  afterEach(() => vi.useRealTimers());

  it("stores only the latest sequenced, finite, clamped position", () => {
    const batches: unknown[] = [];
    const pipeline = new CursorPipeline({ sendCursors: (message) => batches.push(message), sendPresence: () => {} });
    pipeline.join("p1", "#abc");
    expect(pipeline.recordInput("p1", 1, -0.2, 1.4)).toBe(true);
    expect(pipeline.recordInput("p1", 1, 0.2, 0.2)).toBe(false);
    expect(pipeline.recordInput("p1", 0, 0.3, 0.3)).toBe(false);
    expect(pipeline.recordInput("p1", 2, Number.NaN, 0.3)).toBe(false);
    expect(pipeline.recordInput("missing", 2, 0.3, 0.3)).toBe(false);
    pipeline.tick();
    expect(batches).toEqual([{ t: "cursors", v: 2, tick: 0, cursors: [
      { clientId: "p1", color: "#abc", x: 0, y: 1 },
    ] }]);
  });

  it("emits presence only when membership changes", () => {
    const counts: number[] = [];
    const pipeline = new CursorPipeline({ sendCursors: () => {}, sendPresence: (message) => counts.push(message.count) });
    pipeline.join("p1", "red");
    pipeline.join("p1", "blue");
    pipeline.join("p2", "green");
    pipeline.leave("missing");
    pipeline.leave("p1");
    expect(counts).toEqual([1, 2, 1]);
  });

  it("suppresses empty and unchanged ticks, then emits changed state", () => {
    vi.useFakeTimers();
    const batches: Array<{ tick: number; cursors: Array<{ x: number; y: number }> }> = [];
    const pipeline = new CursorPipeline({
      sendCursors: (message) => batches.push({ tick: message.tick, cursors: message.cursors }),
      sendPresence: () => {},
    });
    pipeline.start();
    pipeline.start();
    vi.advanceTimersByTime(CURSOR_TICK_INTERVAL_MS * 3);
    expect(batches).toEqual([]);

    pipeline.join("p1", "red");
    vi.advanceTimersByTime(CURSOR_TICK_INTERVAL_MS);
    vi.advanceTimersByTime(CURSOR_TICK_INTERVAL_MS * 2);
    expect(batches).toEqual([{ tick: 0, cursors: [{ clientId: "p1", color: "red", x: 0.5, y: 0.5 }] }]);

    expect(pipeline.recordInput("p1", 1, 0.5, 0.5)).toBe(true);
    vi.advanceTimersByTime(CURSOR_TICK_INTERVAL_MS);
    expect(batches).toHaveLength(1);

    expect(pipeline.recordInput("p1", 2, 0.75, 0.25)).toBe(true);
    vi.advanceTimersByTime(CURSOR_TICK_INTERVAL_MS);
    pipeline.stop();
    vi.advanceTimersByTime(CURSOR_TICK_INTERVAL_MS);
    expect(batches).toEqual([
      { tick: 0, cursors: [{ clientId: "p1", color: "red", x: 0.5, y: 0.5 }] },
      { tick: 1, cursors: [{ clientId: "p1", color: "red", x: 0.75, y: 0.25 }] },
    ]);
  });

  it("emits one empty snapshot when the final cursor leaves", () => {
    const batches: unknown[] = [];
    const pipeline = new CursorPipeline({ sendCursors: (message) => batches.push(message), sendPresence: () => {} });
    pipeline.join("p1", "red");
    pipeline.tick();
    pipeline.leave("p1");
    pipeline.tick();
    pipeline.tick();
    expect(batches).toEqual([
      { t: "cursors", v: 2, tick: 0, cursors: [{ clientId: "p1", color: "red", x: 0.5, y: 0.5 }] },
      { t: "cursors", v: 2, tick: 1, cursors: [] },
    ]);
  });

  it("defers dirty state until a cursor recipient is available", () => {
    const ticks: number[] = [];
    let canSend = false;
    const pipeline = new CursorPipeline({
      sendCursors: (message) => ticks.push(message.tick),
      sendPresence: () => {},
      canSendCursors: () => canSend,
    });
    pipeline.join("p1", "red");
    pipeline.tick();
    expect(ticks).toEqual([]);
    canSend = true;
    pipeline.tick();
    expect(ticks).toEqual([0]);

    canSend = false;
    pipeline.requestSnapshot();
    pipeline.tick();
    canSend = true;
    pipeline.tick();
    expect(ticks).toEqual([0, 1]);
  });

  it("merges ghost cursors into the broadcast without affecting live/presence tracking", () => {
    const batches: unknown[] = [];
    const counts: number[] = [];
    const pipeline = new CursorPipeline({
      sendCursors: (message) => batches.push(message),
      sendPresence: (message) => counts.push(message.count),
    });
    pipeline.join("p1", "red");
    pipeline.setGhostCursors([{ clientId: "ghost:rec-1", x: 0.1, y: 0.9, color: "blue", ghost: true }]);
    pipeline.tick();
    expect(batches).toEqual([{ t: "cursors", v: 2, tick: 0, cursors: [
      { clientId: "p1", color: "red", x: 0.5, y: 0.5 },
      { clientId: "ghost:rec-1", color: "blue", x: 0.1, y: 0.9, ghost: true },
    ] }]);
    // Ghosts are not live participants -- presence only reflects joins/leaves.
    expect(counts).toEqual([1]);

    pipeline.setGhostCursors([]);
    pipeline.tick();
    expect(batches).toHaveLength(2);
    expect((batches[1] as { cursors: unknown[] }).cursors).toEqual([{ clientId: "p1", color: "red", x: 0.5, y: 0.5 }]);
  });
});

describe("curtain-light entry stages", () => {
  it("hides cursors and ghosts until entry, pulses on touch, and resumes after reconnect", () => {
    const batches: CursorsMessage[] = [];
    const pipeline = new CursorPipeline({ sendCursors: (m) => batches.push(m), sendPresence: () => {} });
    pipeline.join("a", "#fff");
    pipeline.join("b", "#000");
    pipeline.setGhostCursors([{ clientId: "ghost:1", x: 0.1, y: 0.1, color: "#f0f", ghost: true }]);
    pipeline.setEntryStage(true);
    pipeline.tick();
    expect(batches.every((batch) => batch.cursors.length === 0)).toBe(true);

    pipeline.enter("a", 0.4, 0.5);
    pipeline.tick();
    expect(batches.at(-1)!.cursors).toEqual([{ clientId: "a", color: "#fff", x: 0.4, y: 0.5, pulse: 1 }]);
    pipeline.pulse("a");
    pipeline.tick();
    expect(batches.at(-1)!.cursors[0]!.pulse).toBe(2);

    pipeline.place("a", 0.2, 0.3);
    pipeline.leave("a");
    pipeline.join("a", "#fff");
    expect(pipeline.isEntered("a")).toBe(true);
    expect(pipeline.position("a")).toEqual({ x: 0.2, y: 0.3 });
    expect(pipeline.isEntered("b")).toBe(false);

    pipeline.setEntryStage(false);
    pipeline.tick();
    expect(batches.at(-1)!.cursors.map((c) => c.clientId).sort()).toEqual(["a", "b", "ghost:1"]);
  });
});
