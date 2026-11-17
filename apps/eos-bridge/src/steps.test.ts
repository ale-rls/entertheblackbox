import { describe, expect, it } from "vitest";
import { LightingBridge } from "./bridge.js";
import { parseBridgeConfig } from "./config.js";
import type { LightOutput } from "./eos.js";
import { LookPlayer } from "./player.js";

/** Timed steps within a scene: looks at set times from the scene's start, as monitor cues are. */
const base = {
  eos: { host: "10.0.0.1" },
  fixtures: { a: { channel: 10 } },
  looks: {
    l10: { fixtures: { a: { level: 10 } } }, l20: { fixtures: { a: { level: 20 } } },
    l30: { fixtures: { a: { level: 30 } } }, l40: { fixtures: { a: { level: 40 } } },
  },
  scenes: {
    runde: [{ at: 0, look: "l10" }, { at: 25, look: "l30" }, { at: 10, look: "l20" }], // any order in the file
    danach: "l40",
  },
};

let sequence = 0;
const event = (rest: Record<string, unknown>) => ({ version: 1, bootId: "boot", sequence: ++sequence, timelineId: "main", sessionId: "s", ...rest });
const scene = (phaseId: string, phaseEpoch: number, timestamp: number, startedAt = timestamp) =>
  ({ type: "phase", phaseId, phaseEpoch, timestamp, payload: { phase: { startedAt } } });

/** Laptop time and server time share a base here, so "arrives at" equals the server time plus transit. */
function timedBridge() {
  const sent: number[] = [];
  const output: LightOutput = { name: "test", set: (_channel, values) => { if (values.intens !== undefined) sent.push(values.intens); return true; }, close: () => {} };
  const timers: Array<{ at: number; fn: () => void; cancelled: boolean }> = [];
  let now = 0;
  const schedule = (fn: () => void, ms: number) => { const timer = { at: now + ms, fn, cancelled: false }; timers.push(timer); return () => { timer.cancelled = true; }; };
  const advanceTo = (time: number) => {
    for (const timer of timers.filter((entry) => !entry.cancelled && entry.at <= time).sort((a, b) => a.at - b.at)) {
      now = timer.at;
      timer.cancelled = true;
      timer.fn();
    }
    now = time;
  };
  const lines: string[] = [];
  const bridge = new LightingBridge(parseBridgeConfig(JSON.stringify(base)), new LookPlayer(output), (line) => lines.push(line), schedule, () => now);
  const arrive = (at: number, rest: Record<string, unknown>) => { advanceTo(at); bridge.handle(event(rest)); };
  return { bridge, sent, lines, advanceTo, arrive };
}

describe("timed steps within a scene", () => {
  it("plays each step at its time from the scene's start", () => {
    const { sent, advanceTo, arrive } = timedBridge();
    arrive(1_000, scene("runde", 1, 1_000));
    expect(sent).toEqual([10]);
    advanceTo(10_999);
    expect(sent).toEqual([10]);
    advanceTo(11_000);
    expect(sent).toEqual([10, 20]);
    advanceTo(26_000);
    expect(sent).toEqual([10, 20, 30]);
  });

  it("counts from a synchronized scene's real start, not from its announcement", () => {
    const { sent, advanceTo, arrive } = timedBridge();
    arrive(1_000, scene("runde", 1, 1_000, 4_000)); // starts 3 s after it is announced
    advanceTo(3_999);
    expect(sent).toEqual([]);
    advanceTo(4_000);
    expect(sent).toEqual([10]);
    advanceTo(14_000);
    expect(sent).toEqual([10, 20]);
  });

  it("the next scene drops the steps still to come", () => {
    const { sent, advanceTo, arrive } = timedBridge();
    arrive(1_000, scene("runde", 1, 1_000));
    advanceTo(12_000);
    arrive(15_000, scene("danach", 2, 15_000));
    advanceTo(60_000);
    expect(sent).toEqual([10, 20, 40]);
  });

  it("a scene announced late plays only the step it should be at, then keeps time", () => {
    const { sent, advanceTo, arrive } = timedBridge();
    arrive(1_000, scene("danach", 1, 1_000)); // sets the usual transit (0 ms)
    arrive(14_000, scene("runde", 2, 2_000)); // the server sent it 12 s into the scene, at once
    expect(sent).toEqual([40, 20]); // the 0 s step is long past: only the 10 s one plays
    advanceTo(26_999);
    expect(sent).toEqual([40, 20]);
    advanceTo(27_000); // 25 s after the scene's start
    expect(sent).toEqual([40, 20, 30]);
  });

  it("a bridge started in the middle of the scene runs the steps still ahead and replays none", () => {
    const { sent, advanceTo, arrive } = timedBridge(); // e.g. the laptop restarted the bridge 15 s into the scene
    arrive(16_000, { type: "snapshot", timestamp: 16_000,
      timelines: [{ timelineId: "main", phaseId: "runde", phaseEpoch: 1, payload: { phase: { startedAt: 1_000 } } }] });
    expect(sent).toEqual([]); // nothing replayed
    advanceTo(25_999);
    expect(sent).toEqual([]);
    advanceTo(26_000);
    expect(sent).toEqual([30]);
  });

  it("a reconnect that missed nothing does not schedule the steps twice", () => {
    const { sent, advanceTo, arrive } = timedBridge();
    arrive(1_000, scene("runde", 1, 1_000));
    arrive(5_000, { type: "snapshot", timestamp: 5_000,
      timelines: [{ timelineId: "main", phaseId: "runde", phaseEpoch: 1, payload: { phase: { startedAt: 1_000 } } }] });
    advanceTo(30_000);
    expect(sent).toEqual([10, 20, 30]);
  });

  it("the end of the show drops them", () => {
    const { sent, advanceTo, arrive } = timedBridge();
    arrive(1_000, scene("runde", 1, 1_000));
    arrive(5_000, { type: "reset", phaseId: "idle", phaseEpoch: 2, timestamp: 5_000 });
    advanceTo(30_000);
    expect(sent).toEqual([10]);
  });

  it("steps are checked when the file is read", () => {
    expect(() => parseBridgeConfig(JSON.stringify({ ...base, scenes: { runde: [{ at: 0, look: "l10" }, { at: 5, look: "fehlt" }] } })))
      .toThrow('scenes.runde[1]: no look named "fehlt"');
    expect(() => parseBridgeConfig(JSON.stringify({ ...base, scenes: { runde: [{ at: -1, look: "l10" }] } }))).toThrow("scenes.runde");
    expect(() => parseBridgeConfig(JSON.stringify({ ...base, scenes: { runde: [] } }))).toThrow("scenes.runde");
  });
});
