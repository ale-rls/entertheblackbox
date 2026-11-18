import { describe, expect, it } from "vitest";
import { LightingBridge } from "./bridge.js";
import { parseBridgeConfig, type ChannelValues } from "./config.js";
import type { LightOutput } from "./eos.js";
import { FRAME_MS, LookPlayer, type Clock } from "./player.js";

const base = {
  eos: { host: "10.0.0.1" },
  fixtures: { a: { channel: 10 } },
  palette: { rot: { red: 100 } },
  looks: { an: { fixtures: { a: { level: 100 } } }, aus: { fixtures: { a: { level: 0 } } }, unentschieden: { fixtures: { a: { level: 50 } } } },
};

function setup(extra: Record<string, unknown> = {}) {
  const config = parseBridgeConfig(JSON.stringify({ ...base, ...extra }));
  const sent: Array<{ channel: number; values: ChannelValues }> = [];
  const output: LightOutput = { name: "test", set: (channel, values) => { sent.push({ channel, values }); return true; }, close: () => {} };
  const timers: Array<{ at: number; fn: () => void; cancelled: boolean }> = [];
  let now = 0;
  const schedule = (fn: () => void, ms: number) => { const timer = { at: now + ms, fn, cancelled: false }; timers.push(timer); return () => { timer.cancelled = true; }; };
  const advance = (ms: number) => {
    now += ms;
    for (const timer of timers.filter((entry) => !entry.cancelled && entry.at <= now)) { timer.cancelled = true; timer.fn(); }
  };
  const lines: string[] = [];
  const bridge = new LightingBridge(config, new LookPlayer(output), (line) => lines.push(line), schedule);
  return { bridge, sent, lines, advance };
}
let sequence = 0;
const event = (rest: Record<string, unknown>) => ({ version: 1, bootId: "boot", sequence: ++sequence, timelineId: "main", sessionId: "s", timestamp: 0, ...rest });

describe("votes with no field winner (finding 1)", () => {
  it("tie, empty and fixed use the scene's `none` look", () => {
    const { bridge, lines } = setup({ results: { wahl: { q1: "an", none: "aus" } } });
    for (const [epoch, winner] of [[1, "tie"], [2, "empty"], [3, "fixed"]] as const) {
      bridge.handle(event({ type: "result", phaseId: "wahl", phaseEpoch: epoch, payload: { winner } }));
      expect(lines.at(-1)).toBe(`vote wahl → ${winner} → look "aus"`);
    }
  });

  it("an entry named after the outcome wins over `none`", () => {
    const { bridge, lines } = setup({ results: { wahl: { tie: "unentschieden", none: "aus" } } });
    bridge.handle(event({ type: "result", phaseId: "wahl", phaseEpoch: 1, payload: { winner: "tie" } }));
    expect(lines.at(-1)).toBe('vote wahl → tie → look "unentschieden"');
    bridge.handle(event({ type: "result", phaseId: "wahl", phaseEpoch: 2, payload: { winner: "empty" } }));
    expect(lines.at(-1)).toBe('vote wahl → empty → look "aus"');
  });

  it("a field without its own look does not fall back to `none`", () => {
    const { bridge, lines } = setup({ results: { wahl: { none: "aus" } } });
    bridge.handle(event({ type: "result", phaseId: "wahl", phaseEpoch: 1, payload: { winner: "q2" } }));
    expect(lines.at(-1)).toBe("vote wahl → q2 · no look");
  });
});

describe("scenes that start later than announced (finding 2)", () => {
  // As the server sends a synchronized-audio video scene: startedAt = now + syncLeadMs (3 s).
  const syncedScene = (phaseEpoch: number, phaseId = "video") =>
    event({ type: "phase", phaseId, phaseEpoch, timestamp: 10_000, payload: { reason: "advance", phase: { startedAt: 13_000 } } });

  it("waits for the scheduled start, for the scene's look and its cues", () => {
    const { bridge, sent, advance } = setup({ scenes: { video: "an" }, cues: { "licht-an": "an" } });
    bridge.handle(syncedScene(1));
    bridge.handle(event({ type: "cue", phaseId: "video", phaseEpoch: 1, timestamp: 10_000, payload: { cue: "licht-an" } }));
    advance(2_999);
    expect(sent).toHaveLength(0);
    advance(1);
    expect(sent).toHaveLength(2);
  });

  it("measures the wait on the server's clock, not the laptop's", () => {
    const { bridge, sent, advance } = setup({ scenes: { video: "an" } });
    bridge.handle(event({ type: "phase", phaseId: "video", phaseEpoch: 1, timestamp: 999_000, payload: { phase: { startedAt: 1_000_500 } } }));
    advance(1_499);
    expect(sent).toHaveLength(0);
    advance(1);
    expect(sent).toHaveLength(1);
  });

  it("a scene skipped before it starts never lights", () => {
    const { bridge, sent, advance, lines } = setup({ scenes: { video: "an", danach: "aus" } });
    bridge.handle(syncedScene(1));
    bridge.handle(event({ type: "phase", phaseId: "danach", phaseEpoch: 2, timestamp: 11_000, payload: { phase: { startedAt: 11_000 } } }));
    advance(5_000);
    expect(sent.map((entry) => entry.values.intens)).toEqual([0]);
    expect(lines.some((line) => line.includes('look "an"'))).toBe(false);
  });

  it("ordinary scenes still light at once", () => {
    const { bridge, sent } = setup({ scenes: { titel: "an" } });
    bridge.handle(event({ type: "phase", phaseId: "titel", phaseEpoch: 1, timestamp: 5_000, payload: { phase: { startedAt: 5_000 } } }));
    expect(sent).toHaveLength(1);
  });
});

describe("waiting looks that became obsolete (second review)", () => {
  const synced = (timelineId: string, phaseId: string, phaseEpoch: number) =>
    event({ type: "phase", timelineId, phaseId, phaseEpoch, timestamp: 10_000, payload: { phase: { startedAt: 13_000 } } });
  const snapshot = (timelines: Array<Record<string, unknown>>) => ({ ...event({}), type: "snapshot", timelines });

  it("a reconnect that finds the show back at idle drops the look still waiting", () => {
    const { bridge, sent, advance } = setup({ scenes: { video: "an" } });
    bridge.handle(synced("main", "video", 1));
    // Connection drops; the show ends meanwhile; the reconnect snapshot reports idle.
    bridge.handle(snapshot([{ timelineId: "main", phaseId: "idle", phaseEpoch: 2, payload: {} }]));
    advance(5_000);
    expect(sent).toHaveLength(0);
  });

  it("a reconnect with no show running drops it too", () => {
    const { bridge, sent, advance } = setup({ scenes: { video: "an" } });
    bridge.handle(synced("main", "video", 1));
    bridge.handle(snapshot([]));
    advance(5_000);
    expect(sent).toHaveLength(0);
  });

  it("a reconnect while the same scene is still pre-rolling keeps it", () => {
    const { bridge, sent, advance } = setup({ scenes: { video: "an" } });
    bridge.handle(synced("main", "video", 1));
    bridge.handle(snapshot([{ timelineId: "main", phaseId: "video", phaseEpoch: 1, payload: {} }]));
    advance(3_000);
    expect(sent.map((entry) => entry.values.intens)).toEqual([100]);
  });

  // The server's group-branch flow: main enters the branch scene (epoch 5), each group gets its own timeline
  // (named by group ID) with epochs from the same counter, and main moves on to the reunion scene (epoch 8).
  const groupPreRollsLightCue = (bridge: LightingBridge) => {
    bridge.handle(event({ type: "phase", timelineId: "main", phaseId: "verzweigung", phaseEpoch: 5, timestamp: 9_000, payload: { phase: { startedAt: 9_000 } } }));
    bridge.handle(synced("gruppe-a", "gruppe-video", 7));
    bridge.handle(event({ type: "cue", timelineId: "gruppe-a", phaseId: "gruppe-video", phaseEpoch: 7, timestamp: 10_000, payload: { cue: "licht-an" } }));
  };
  const reunion = () => event({ type: "phase", timelineId: "main", phaseId: "reunion", phaseEpoch: 8, timestamp: 11_000, payload: { reason: "admin-force-reunion", phase: { startedAt: 11_000 } } });

  it("a forced group reunion during pre-roll drops the group's waiting cue (no reset is sent)", () => {
    const { bridge, sent, advance } = setup({ scenes: { reunion: "aus" }, cues: { "licht-an": "an" } });
    groupPreRollsLightCue(bridge);
    // adminForceReunion: only the reunion scene on main. The group timeline just stops.
    bridge.handle(reunion());
    advance(5_000);
    expect(sent.map((entry) => entry.values.intens)).toEqual([0]);
  });

  it("groups finishing on their own (reset on main, then the reunion) also drop it", () => {
    const { bridge, sent, advance } = setup({ scenes: { reunion: "aus" }, cues: { "licht-an": "an" } });
    groupPreRollsLightCue(bridge);
    bridge.handle(event({ type: "reset", timelineId: "main", phaseId: "reunion", phaseEpoch: 8, timestamp: 11_000, payload: { reason: "group-branch-complete" } }));
    bridge.handle(reunion());
    advance(5_000);
    expect(sent.map((entry) => entry.values.intens)).toEqual([0]);
  });

  it("a reconnect after a missed forced reunion ignores the group scene the feed still lists", () => {
    const { bridge, sent, advance } = setup({ cues: { "licht-an": "an" } });
    groupPreRollsLightCue(bridge);
    // Disconnected through the reunion: the snapshot still holds gruppe-a's last scene (epoch 7), main is at 8.
    bridge.handle(snapshot([
      { timelineId: "main", phaseId: "reunion", phaseEpoch: 8, payload: {} },
      { timelineId: "gruppe-a", phaseId: "gruppe-video", phaseEpoch: 7, payload: {} },
    ]));
    advance(5_000);
    expect(sent).toHaveLength(0);
  });

  it("a reconnect while the groups are still running keeps the group's waiting cue", () => {
    const { bridge, sent, advance } = setup({ cues: { "licht-an": "an" } });
    groupPreRollsLightCue(bridge);
    bridge.handle(snapshot([
      { timelineId: "main", phaseId: "verzweigung", phaseEpoch: 5, payload: {} },
      { timelineId: "gruppe-a", phaseId: "gruppe-video", phaseEpoch: 7, payload: {} },
    ]));
    advance(3_000);
    expect(sent.map((entry) => entry.values.intens)).toEqual([100]);
  });

  it("retires only the matching scene and leaves siblings with the same group ID scheduled", () => {
    const { bridge, sent, advance } = setup({ scenes: { sibling: "an", nested: "aus", revisited: "unentschieden" } });
    bridge.handle(synced("c", "sibling", 2));
    bridge.handle({ ...synced("c", "nested", 3), timelineKey: "a/c" });
    bridge.handle(event({ type: "retire", timelineId: "c", timelineKey: "a/c", phaseEpoch: 3 }));
    advance(3_000);
    expect(sent.map(entry => entry.values.intens)).toEqual([100]);

    bridge.handle({ ...synced("c", "revisited", 4), timelineKey: "a/c" });
    bridge.handle(event({ type: "retire", timelineId: "c", timelineKey: "a/c", phaseEpoch: 3 }));
    advance(3_000);
    expect(sent.map(entry => entry.values.intens)).toEqual([100, 50]);
  });

  it("a reunion does not count as the show ending", () => {
    const { bridge, lines } = setup({ showEnd: "aus" });
    bridge.handle(event({ type: "reset", timelineId: "main", phaseId: "reunion", phaseEpoch: 3, payload: {} }));
    expect(lines.some((line) => line.includes("show end"))).toBe(false);
  });
});

describe("system clock changes during a fade (finding 3)", () => {
  it("never sends a value outside the fade's range when time runs backwards", () => {
    const sent: ChannelValues[] = [];
    const output: LightOutput = { name: "test", set: (_channel, values) => { sent.push(values); return true; }, close: () => {} };
    let now = 1_000_000;
    let tick: (() => void) | null = null;
    const clock: Clock = { now: () => now, every: (_ms, fn) => { tick = fn; return () => { tick = null; }; } };
    const player = new LookPlayer(output, clock);
    player.play(new Map([[10, { intens: 0 }]]), 0);
    player.play(new Map([[10, { intens: 100 }]]), 2);
    now += 500; tick!();
    now -= 60_000; tick!(); // the clock is set back a minute
    now += FRAME_MS; tick!();
    for (const values of sent) {
      if (values.intens !== undefined) {
        expect(values.intens).toBeGreaterThanOrEqual(0);
        expect(values.intens).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe("names that only exist on JavaScript objects (finding 4)", () => {
  it.each([
    ["a cue pointing at look \"constructor\"", { cues: { x: "constructor" } }, 'no look named "constructor"'],
    ["a scene pointing at look \"toString\"", { scenes: { x: "toString" } }, 'no look named "toString"'],
    ["a look using colour \"constructor\"", { looks: { l: { fixtures: { a: { color: "constructor" } } } } }, '"constructor" is not in the palette'],
    ["a look using fixture \"hasOwnProperty\"", { looks: { l: { fixtures: { hasOwnProperty: { level: 1 } } } } }, 'no fixture named "hasOwnProperty"'],
    ["a name \"__proto__\"", { palette: JSON.parse('{"__proto__": {"red": 1}}') }, "reserved"],
  ])("refuses %s", (_label, extra, message) => {
    const json = JSON.stringify({ ...base, ...extra }).replace('"palette":{}', '"palette":{"__proto__":{"red":1}}');
    expect(() => parseBridgeConfig(json)).toThrow(message);
  });

  it("does not treat inherited names as looks, cues or scenes when testing", () => {
    const { bridge } = setup();
    expect(bridge.test("constructor")).toBe(false);
    expect(bridge.test("toString")).toBe(false);
  });
});

describe("Eos user number (finding 5)", () => {
  it("accepts the largest OSC integer and refuses anything larger", () => {
    expect(parseBridgeConfig(JSON.stringify({ ...base, eos: { host: "x", user: 2_147_483_647 } })).eos.user).toBe(2_147_483_647);
    expect(() => parseBridgeConfig(JSON.stringify({ ...base, eos: { host: "x", user: 2_147_483_648 } }))).toThrow("eos.user");
  });
});
