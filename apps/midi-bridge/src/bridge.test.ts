import { describe, expect, it } from "vitest";
import { CueBridge } from "./bridge.js";
import { describeAction, midiBytes, parseBridgeConfig } from "./config.js";

const config = parseBridgeConfig(JSON.stringify({
  cues: { "musik-T1-start": [{ note: 60 }], "puls-hoch": [{ cc: 20, value: 100, channel: 2 }] },
  scenes: { "T1-titel": [{ note: 61, velocity: 90, durationMs: 50 }, { program: 3 }] },
  showEnd: [{ cc: 120, value: 127 }],
}));

const setup = () => {
  const sent: number[][] = [];
  const lines: string[] = [];
  const pending: Array<{ fn: () => void; ms: number }> = [];
  let now = 0;
  const bridge = new CueBridge(config, { name: "test", send: (bytes) => sent.push(bytes) }, (line) => lines.push(line), (fn, ms) => pending.push({ fn, ms }), () => now);
  const flush = () => { for (const item of pending.splice(0)) item.fn(); };
  const setNow = (ms: number) => { now = ms; };
  return { bridge, sent, lines, pending, flush, setNow };
};
const event = (sequence: number, rest: Record<string, unknown>) => ({ version: 1, bootId: "boot-1", sequence, timelineId: "main", sessionId: "s", timestamp: 0, ...rest });

describe("mapping file", () => {
  it("applies defaults and rejects mistakes with a readable path", () => {
    expect(config.output).toBe("IAC");
    expect(config.channel).toBe(1);
    expect(() => parseBridgeConfig("{")).toThrow("not valid JSON");
    expect(() => parseBridgeConfig(JSON.stringify({ cues: { x: [{ note: 200 }] } }))).toThrow("cues.x.0");
    expect(() => parseBridgeConfig(JSON.stringify({ cues: { x: [{ note: 60, value: 1 }] } }))).toThrow("invalid");
    expect(() => parseBridgeConfig(JSON.stringify({ cues: { x: [] } }))).toThrow("cues.x");
  });

  it("builds MIDI bytes with 1-based channels", () => {
    expect(midiBytes({ note: 60 }, 1)).toEqual({ now: [0x90, 60, 127], off: { bytes: [0x80, 60, 0], afterMs: 100 } });
    expect(midiBytes({ note: 61, velocity: 90, channel: 16, durationMs: 50 }, 1)).toEqual({ now: [0x9f, 61, 90], off: { bytes: [0x8f, 61, 0], afterMs: 50 } });
    expect(midiBytes({ cc: 20, value: 100 }, 2)).toEqual({ now: [0xb1, 20, 100] });
    expect(midiBytes({ program: 3 }, 1)).toEqual({ now: [0xc0, 3] });
    expect(describeAction({ cc: 20, value: 100 }, 2)).toBe("CC 20=100 ch2");
  });
});

describe("CueBridge", () => {
  it("does not replay anything on connect, then fires scene and cue mappings live", () => {
    const { bridge, sent, lines, pending, flush } = setup();
    bridge.handle({ version: 1, bootId: "boot-1", sequence: 7, type: "snapshot", timestamp: 0, timelines: [event(7, { type: "phase", phaseId: "T1-titel", phaseEpoch: 3 })] });
    expect(sent).toEqual([]);
    expect(lines[0]).toContain("current scene main: T1-titel");

    bridge.handle(event(8, { type: "phase", phaseId: "T1-titel", phaseEpoch: 4, payload: { reason: "advance" } }));
    expect(sent).toEqual([[0x90, 61, 90], [0xc0, 3]]);
    expect(pending.map((item) => item.ms)).toEqual([50]);
    flush();
    expect(sent.at(-1)).toEqual([0x80, 61, 0]);

    bridge.handle(event(9, { type: "cue", phaseId: "T1-titel", phaseEpoch: 4, payload: { cue: "puls-hoch" } }));
    expect(sent.at(-1)).toEqual([0xb1, 20, 100]);
  });

  it("ignores repeated events and repeated phase epochs, and logs unmapped cues", () => {
    const { bridge, sent, lines } = setup();
    bridge.handle(event(1, { type: "cue", phaseId: "a", phaseEpoch: 1, payload: { cue: "musik-T1-start" } }));
    bridge.handle(event(1, { type: "cue", phaseId: "a", phaseEpoch: 1, payload: { cue: "musik-T1-start" } }));
    expect(sent).toEqual([[0x90, 60, 127]]);

    bridge.handle(event(2, { type: "phase", phaseId: "T1-titel", phaseEpoch: 5 }));
    bridge.handle(event(3, { type: "phase", phaseId: "T1-titel", phaseEpoch: 5 }));
    expect(sent.filter((bytes) => bytes[0] === 0x90 && bytes[1] === 61)).toHaveLength(1);

    bridge.handle(event(4, { type: "cue", payload: { cue: "unknown" } }));
    expect(lines.at(-1)).toContain('cue "unknown" · not in the mapping file');
  });

  it("starts afresh after a server restart (new bootId)", () => {
    const { bridge, sent } = setup();
    bridge.handle(event(50, { type: "cue", payload: { cue: "musik-T1-start" } }));
    bridge.handle({ ...event(1, { type: "cue", payload: { cue: "musik-T1-start" } }), bootId: "boot-2" });
    expect(sent).toHaveLength(2);
  });

  it("sends the show-end mapping when the show returns to idle, not when group paths reunite", () => {
    const { bridge, sent } = setup();
    bridge.handle(event(1, { type: "reset", phaseId: "reunion", payload: { reason: "group-branch-complete" } }));
    expect(sent).toEqual([]);
    bridge.handle(event(2, { type: "reset", phaseId: "idle", payload: { reason: "admin-idle" } }));
    expect(sent).toEqual([[0xb0, 120, 127]]);
  });

  it("fires group-path scenes on their own timeline", () => {
    const { bridge, sent } = setup();
    bridge.handle(event(1, { type: "phase", timelineId: "main", phaseId: "split", phaseEpoch: 2 }));
    bridge.handle(event(2, { type: "phase", timelineId: "ki", phaseId: "T1-titel", phaseEpoch: 2 }));
    expect(sent[0]).toEqual([0x90, 61, 90]);
  });

  it("waits out a synchronized pre-roll before starting a scene's music", () => {
    const { bridge, sent, pending, setNow } = setup();
    const phase = (sequence: number, epoch: number, timestamp: number, startedAt: number) =>
      ({ ...event(sequence, { type: "phase", phaseId: "T1-titel", phaseEpoch: epoch, payload: { phase: { startedAt } } }), timestamp });
    // Announced 3 s before the video starts; arrives on time.
    setNow(10_000);
    bridge.handle(phase(1, 4, 10_000, 13_000));
    bridge.handle({ ...event(2, { type: "cue", phaseId: "T1-titel", phaseEpoch: 4, payload: { cue: "musik-T1-start" } }), timestamp: 10_000 });
    expect(sent).toEqual([]);
    expect(pending.map((item) => item.ms)).toEqual([3_000, 3_000]);
    for (const item of pending.splice(0)) item.fn();
    expect(sent.slice(0, 2)).toEqual([[0x90, 61, 90], [0xc0, 3]]);
    expect(sent).toContainEqual([0x90, 60, 127]);

    // The next scene arrives 1 s later than usual: its wait shrinks by that second.
    sent.length = 0; pending.length = 0;
    setNow(21_000);
    bridge.handle(phase(3, 5, 20_000, 23_000));
    expect(pending.map((item) => item.ms)).toEqual([2_000]);

    // Skipped during the pre-roll: the next scene's start drops the waiting one.
    bridge.handle(phase(4, 6, 20_500, 20_500));
    const waiting = pending.shift()!;
    sent.length = 0;
    waiting.fn();
    expect(sent.filter((bytes) => bytes[1] === 61 && bytes[0] === 0x90)).toHaveLength(0);
  });

  it("drops music waiting for a pre-roll when its group timeline is retired", () => {
    const { bridge, sent, pending, setNow } = setup();
    setNow(10_000);
    bridge.handle({ ...event(1, { type: "phase", timelineId: "a", timelineKey: "a/a", phaseId: "T1-titel", phaseEpoch: 7, payload: { phase: { startedAt: 13_000 } } }), timestamp: 10_000 });
    expect(pending.map((item) => item.ms)).toEqual([3_000]);
    bridge.handle({ ...event(2, { type: "retire", timelineId: "a", timelineKey: "a/a", phaseId: "T1-titel", phaseEpoch: 7 }), timestamp: 10_500 });
    pending.shift()!.fn();
    expect(sent).toEqual([]);
  });

  it("drops music waiting for a pre-roll when a reconnect shows its group scene has ended", () => {
    const { bridge, sent, pending, setNow } = setup();
    setNow(10_000);
    bridge.handle({ ...event(1, { type: "phase", timelineId: "a", timelineKey: "a/a", phaseId: "T1-titel", phaseEpoch: 7, payload: { phase: { startedAt: 13_000 } } }), timestamp: 10_000 });
    bridge.handle({ ...event(2, { type: "phase", timelineId: "b", timelineKey: "b/b", phaseId: "other", phaseEpoch: 8, payload: { phase: { startedAt: 10_000 } } }), timestamp: 10_000 });
    expect(pending.map((item) => item.ms)).toEqual([3_000]);
    // The feed drops while the operator forces the reunion; the reconnect only shows the shared scene.
    setNow(11_000);
    bridge.handle({ ...event(9, { type: "snapshot", timelines: [{ timelineId: "main", phaseId: "reunion", phaseEpoch: 9 }] }), timestamp: 11_000 });
    pending.shift()!.fn();
    expect(sent).toEqual([]);
  });

  it("keeps music waiting for a pre-roll when a reconnect shows its scene is still current", () => {
    const { bridge, sent, pending, setNow } = setup();
    setNow(10_000);
    bridge.handle({ ...event(1, { type: "phase", timelineId: "main", phaseId: "T1-titel", phaseEpoch: 4, payload: { phase: { startedAt: 13_000 } } }), timestamp: 10_000 });
    setNow(11_000);
    bridge.handle({ ...event(2, { type: "snapshot", timelines: [{ timelineId: "main", phaseId: "T1-titel", phaseEpoch: 4 }] }), timestamp: 11_000 });
    pending.shift()!.fn();
    expect(sent).toContainEqual([0x90, 61, 90]);
  });

  it("sends a single entry for testing in Ableton, and picks up an edited mapping", () => {
    const { bridge, sent } = setup();
    expect(bridge.test("musik-T1-start")).toBe(true);
    expect(bridge.test("showEnd")).toBe(true);
    expect(bridge.test("nope")).toBe(false);
    expect(sent).toEqual([[0x90, 60, 127], [0xb0, 120, 127]]);
    bridge.setConfig(parseBridgeConfig(JSON.stringify({ cues: { neu: [{ note: 1 }] } })));
    expect(bridge.test("neu")).toBe(true);
  });
});
