import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LightingBridge } from "./bridge.js";
import { lookTargets, parseBridgeConfig, resolveColor, type ChannelValues } from "./config.js";
import type { LightOutput } from "./eos.js";
import { oscAddress, oscMessage, slipEncode, SlipDecoder } from "./osc.js";
import { FRAME_MS, LookPlayer, type Clock } from "./player.js";

const config = parseBridgeConfig(JSON.stringify({
  eos: { host: "10.0.0.1" },
  fixtures: { a: { channel: 10 }, b: { channel: 11, setup: { "intensity mspeed": -3 } } },
  palette: { rot: { red: 100 }, gelb: { red: 100, green: 55, amber: 100 }, grau: "#808080" },
  looks: {
    aus: { fade: 0, fixtures: { "*": { level: 0 } } },
    rot: { fade: 1, fixtures: { "*": { color: "rot", level: 100 } } },
    nurA: { fade: 1, fixtures: { "*": { level: 10 }, a: { level: 100 } } },
    gelbB: { fixtures: { b: { color: "gelb" } } },
  },
  cues: { "licht-rot": "rot" },
  scenes: { "T1-titel": "aus" },
  results: { "T1-wahl": { q1: "nurA", none: "rot" } },
  showEnd: "aus",
}));

/** A clock the test moves by hand. */
function fakeClock() {
  let now = 0;
  let tick: (() => void) | null = null;
  const clock: Clock = { now: () => now, every: (_ms, fn) => { tick = fn; return () => { tick = null; }; } };
  const advance = (ms: number) => { for (let left = ms; left > 0; left -= FRAME_MS) { now += Math.min(FRAME_MS, left); tick?.(); } };
  return { clock, advance };
}

function setup() {
  const sent: Array<{ channel: number; values: ChannelValues; final: boolean }> = [];
  const output: LightOutput = { name: "test", set: (channel, values, final) => { sent.push({ channel, values, final }); return true; }, close: () => {} };
  const { clock, advance } = fakeClock();
  const player = new LookPlayer(output, clock);
  const lines: string[] = [];
  const bridge = new LightingBridge(config, player, (line) => lines.push(line));
  const finals = () => sent.filter((entry) => entry.final);
  return { sent, finals, player, bridge, lines, advance };
}
const event = (sequence: number, rest: Record<string, unknown>) => ({ version: 1, bootId: "boot-1", sequence, timelineId: "main", sessionId: "s", timestamp: 0, ...rest });

describe("lighting file", () => {
  it("rejects broken JSON, bad values and dangling names with a readable path", () => {
    expect(() => parseBridgeConfig("{")).toThrow("not valid JSON");
    expect(() => parseBridgeConfig(JSON.stringify({ eos: { host: "x" }, fixtures: {}, palette: { rot: { red: 150 } } }))).toThrow("palette.rot");
    expect(() => parseBridgeConfig(JSON.stringify({ eos: { host: "x" }, fixtures: {}, cues: { c: "fehlt" } }))).toThrow('cues.c: no look named "fehlt"');
    expect(() => parseBridgeConfig(JSON.stringify({ eos: { host: "x" }, fixtures: {}, looks: { l: { fixtures: { z: { level: 1 } } } } }))).toThrow('no fixture named "z"');
    expect(() => parseBridgeConfig(JSON.stringify({ eos: { host: "x" }, fixtures: { a: { channel: 1 } }, looks: { l: { fixtures: { a: { color: "lila" } } } } }))).toThrow('"lila" is not in the palette');
  });

  it("fills defaults", () => {
    expect(config.eos).toEqual({ host: "10.0.0.1", port: 3037, user: 0 });
    expect(config.looks.gelbB!.fade).toBe(0);
  });

  it("parses the shipped example", () => {
    const example = parseBridgeConfig(readFileSync(new URL("../lighting.example.json", import.meta.url), "utf8"));
    expect(Object.keys(example.fixtures)).toHaveLength(4);
  });

  it("resolves palette names, emitter objects and hex", () => {
    expect(resolveColor(config, "gelb")).toEqual({ red: 100, green: 55, blue: 0, amber: 100, mint: 0 });
    expect(resolveColor(config, "grau")).toEqual({ red: 50.2, green: 50.2, blue: 50.2, amber: 0, mint: 0 });
    expect(resolveColor(config, "#ff0000")).toEqual({ red: 100, green: 0, blue: 0, amber: 0, mint: 0 });
  });

  it("applies '*' first, then named fixtures; leaves unspecified values alone", () => {
    expect(lookTargets(config, config.looks.nurA!)).toEqual(new Map([[10, { intens: 100 }], [11, { intens: 10 }]]));
    expect(lookTargets(config, config.looks.gelbB!)).toEqual(new Map([[11, { red: 100, green: 55, blue: 0, amber: 100, mint: 0 }]]));
  });
});

describe("LookPlayer", () => {
  it("snaps values it has never sent, then fades from what it sent", () => {
    const { sent, finals, bridge, advance } = setup();
    bridge.test("aus");
    expect(sent).toEqual([{ channel: 10, values: { intens: 0 }, final: true }, { channel: 11, values: { intens: 0 }, final: true }]);
    sent.length = 0;

    bridge.test("rot"); // intensity fades from 0; colours were never sent, so they snap
    expect(sent.slice(0, 2).map((entry) => entry.values)).toEqual([{ red: 100, green: 0, blue: 0, amber: 0, mint: 0 }, { red: 100, green: 0, blue: 0, amber: 0, mint: 0 }]);
    advance(500);
    const halfway = sent.filter((entry) => entry.channel === 10 && !entry.final).at(-1)!;
    expect(halfway.values.intens).toBeGreaterThan(40);
    expect(halfway.values.intens).toBeLessThan(60);
    advance(600);
    expect(finals().filter((entry) => entry.values.intens !== undefined).map((entry) => entry.values)).toEqual([{ intens: 100 }, { intens: 100 }]);
  });

  it("a new look interrupts a fade from where it got to", () => {
    const { sent, bridge, player, advance } = setup();
    bridge.test("aus");
    bridge.test("rot");
    advance(500);
    sent.length = 0;
    bridge.test("nurA");
    advance(FRAME_MS);
    const first = sent.find((entry) => entry.channel === 11)!;
    expect(first.values.intens).toBeGreaterThan(40); // started near 50, not from 100
    advance(1_100);
    expect(player.fading).toBe(false);
  });

  it("only sends what changed between frames", () => {
    const { sent, bridge, advance } = setup();
    bridge.test("aus");
    bridge.test("rot");
    advance(1_100);
    for (const entry of sent.filter((item) => !item.final)) expect(Object.keys(entry.values).every((key) => key === "intens" || entry.values[key as "red"] !== undefined)).toBe(true);
    expect(sent.filter((entry) => !entry.final).every((entry) => !("blue" in entry.values))).toBe(true);
  });
});

describe("LightingBridge", () => {
  it("never replays on connect, then fires scenes, cues, votes and show end once", () => {
    const { bridge, lines, finals } = setup();
    bridge.handle({ ...event(5, {}), type: "snapshot", timelines: [{ timelineId: "main", phaseId: "T1-titel", phaseEpoch: 3, payload: {} }] });
    bridge.handle(event(6, { type: "phase", phaseId: "T1-titel", phaseEpoch: 3 }));
    expect(finals()).toHaveLength(0);

    bridge.handle(event(7, { type: "phase", phaseId: "T1-titel", phaseEpoch: 4 }));
    expect(lines.at(-1)).toBe('scene T1-titel → look "aus"');
    bridge.handle(event(8, { type: "cue", phaseId: "T1-titel", phaseEpoch: 4, payload: { cue: "licht-rot" } }));
    expect(lines.at(-1)).toBe('cue "licht-rot" → look "rot" (1 s fade)');
    bridge.handle(event(8, { type: "cue", phaseId: "T1-titel", phaseEpoch: 4, payload: { cue: "licht-rot" } }));
    expect(lines.filter((line) => line.startsWith('cue "licht-rot"'))).toHaveLength(1);

    bridge.handle(event(9, { type: "result", phaseId: "T1-wahl", phaseEpoch: 5, payload: { winner: "q1" } }));
    expect(lines.at(-1)).toBe('vote T1-wahl → q1 → look "nurA" (1 s fade)');
    bridge.handle(event(10, { type: "result", phaseId: "T1-wahl", phaseEpoch: 5, payload: { winner: "q1" } }));
    expect(lines.filter((line) => line.startsWith("vote T1-wahl → q1 →"))).toHaveLength(1);
    bridge.handle(event(11, { type: "result", phaseId: "T1-wahl", phaseEpoch: 6, payload: { winner: null } }));
    expect(lines.at(-1)).toBe('vote T1-wahl → none → look "rot" (1 s fade)');

    bridge.handle(event(12, { type: "cue", phaseId: "x", phaseEpoch: 7, payload: { cue: "unbekannt" } }));
    expect(lines.at(-1)).toBe('cue "unbekannt" · not in the lighting file');
    bridge.handle(event(13, { type: "reset", phaseId: "T1-gruppe", phaseEpoch: 8 }));
    expect(lines.at(-1)).not.toBe("show ended");
    bridge.handle(event(14, { type: "reset", phaseId: "idle", phaseEpoch: 9 }));
    expect(lines.slice(-2)).toEqual(["show ended", 'show end → look "aus"']);
  });

  it("does not replay a vote result the snapshot already carried", () => {
    const { bridge, lines } = setup();
    bridge.handle({ ...event(1, {}), type: "snapshot", timelines: [{ timelineId: "main", phaseId: "T1-wahl", phaseEpoch: 2, payload: { result: { winner: "q1" } } }] });
    bridge.handle(event(2, { type: "result", phaseId: "T1-wahl", phaseEpoch: 2, payload: { winner: "q1" } }));
    expect(lines.some((line) => line.startsWith("vote"))).toBe(false);
  });

  it("tests a look by its name or by the cue or scene that triggers it", () => {
    const { bridge } = setup();
    expect(bridge.test("rot")).toBe(true);
    expect(bridge.test("licht-rot")).toBe(true);
    expect(bridge.test("T1-titel")).toBe(true);
    expect(bridge.test("showEnd")).toBe(true);
    expect(bridge.test("nope")).toBe(false);
  });
});

describe("OSC over SLIP", () => {
  it("encodes Eos messages and survives escaping and split chunks", () => {
    const message = oscMessage("/eos/chan/10", { float: 50 });
    expect(message.toString("hex")).toBe(`${Buffer.from("/eos/chan/10\0\0\0\0").toString("hex")}${Buffer.from(",f\0\0").toString("hex")}42480000`);
    expect(oscMessage("/eos/user", 0).subarray(12, 16).toString()).toBe(",i\0\0");

    const tricky = Buffer.from([0x2f, 0xc0, 0xdb, 0x00]);
    const framed = Buffer.concat([slipEncode(oscMessage("/eos/out/ping", "x")), slipEncode(tricky)]);
    const decoder = new SlipDecoder();
    const frames = [...decoder.push(framed.subarray(0, 7)), ...decoder.push(framed.subarray(7))];
    expect(frames).toHaveLength(2);
    expect(oscAddress(frames[0]!)).toBe("/eos/out/ping");
    expect(frames[1]).toEqual(tricky);
  });
});
