import { createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { LightingBridge } from "./bridge.js";
import { parseBridgeConfig, type ChannelValues } from "./config.js";
import { EosConnection, type LightOutput } from "./eos.js";
import { SlipDecoder, oscAddress } from "./osc.js";
import { FRAME_MS, LookPlayer, type Clock } from "./player.js";

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function until(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("timed out");
    await wait(20);
  }
}
const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

function flakyPlayer() {
  let up = true;
  const sent: Array<{ channel: number; values: ChannelValues; final: boolean }> = [];
  const output: LightOutput = { name: "flaky", set: (channel, values, final) => { if (!up) return false; sent.push({ channel, values, final }); return true; }, close: () => {} };
  let now = 0;
  let tick: (() => void) | null = null;
  const clock: Clock = { now: () => now, every: (_ms, fn) => { tick = fn; return () => { tick = null; }; } };
  const advance = (ms: number) => { for (let left = ms; left > 0; left -= FRAME_MS) { now += Math.min(FRAME_MS, left); tick?.(); } };
  return { player: new LookPlayer(output, clock), sent, advance, setUp: (value: boolean) => { up = value; } };
}

describe("the desk comes back after a drop (Astra 1)", () => {
  it("a fade cut off by the drop jumps to its end on reconnect", () => {
    const { player, sent, advance, setUp } = flakyPlayer();
    player.play(new Map([[10, { intens: 0, red: 100 }]]), 0);
    player.play(new Map([[10, { intens: 100 }]]), 2);
    advance(800); // part way up
    setUp(false);
    player.forget(); // what main does when the connection drops
    setUp(true);
    sent.length = 0;
    expect(player.resync()).toBe(1);
    expect(sent).toEqual([{ channel: 10, values: { intens: 100, red: 100 }, final: true }]);
  });

  it("a look played while the desk was unreachable goes out on reconnect", () => {
    const { player, sent, setUp } = flakyPlayer();
    player.play(new Map([[10, { intens: 100 }], [11, { intens: 100 }]]), 0);
    setUp(false);
    player.play(new Map([[10, { intens: 0 }]]), 0); // lost
    player.forget();
    setUp(true);
    sent.length = 0;
    player.resync();
    expect(sent).toEqual([
      { channel: 10, values: { intens: 0 }, final: true },
      { channel: 11, values: { intens: 100 }, final: true },
    ]);
  });

  it("sends nothing when the desk already has everything", () => {
    const { player, sent, advance } = flakyPlayer();
    player.play(new Map([[10, { intens: 0 }]]), 0);
    player.play(new Map([[10, { intens: 100 }]]), 1);
    advance(1_100);
    sent.length = 0;
    expect(player.resync()).toBe(0);
    expect(sent).toEqual([]);
  });

  it("leaves values a running fade is still moving to the fade", () => {
    const { player, sent, advance, setUp } = flakyPlayer();
    player.play(new Map([[10, { intens: 0 }]]), 0);
    player.play(new Map([[10, { intens: 100, red: 50 }]]), 2); // red is unknown: snaps; intens fades
    setUp(false);
    player.play(new Map([[11, { blue: 100 }]]), 0); // a snap on another lamp is lost …
    setUp(true);
    // … wait: a new look stops the fade, so start one again with the desk up.
    player.play(new Map([[10, { intens: 0 }]]), 2);
    advance(FRAME_MS);
    sent.length = 0;
    player.resync();
    expect(sent).toEqual([{ channel: 11, values: { blue: 100 }, final: true }]);
  });
});

/** A stand-in Eos desk: records the OSC addresses it receives. */
async function fakeDesk() {
  const received: string[] = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    const decoder = new SlipDecoder();
    socket.on("data", (chunk) => { for (const frame of decoder.push(chunk)) received.push(oscAddress(frame)); });
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  cleanups.push(() => new Promise<void>((done) => { for (const socket of sockets) socket.destroy(); server.close(() => done()); }));
  return {
    port: (server.address() as { port: number }).port, received,
  };
}

describe("a desk that stops reading (Astra 5)", () => {
  it("skips light changes instead of queueing them, then sends the current look once it catches up", async () => {
    const desk = await fakeDesk();
    const lines: string[] = [];
    let player: LookPlayer | null = null;
    const eos = new EosConnection({ host: "127.0.0.1", port: desk.port, user: 0 }, (line) => lines.push(line), {
      onCaughtUp: () => { player?.resync(); }, retryMs: 50,
    });
    cleanups.push(() => eos.close());
    player = new LookPlayer(eos);
    eos.connect();
    await until(() => eos.isConnected && desk.received.includes("/eos/user"));

    // Simulate a full send buffer instead of really filling one: macOS soaks up tens of MB of kernel memory
    // before Node reports backpressure, and filling it for real in a test can take the whole machine down.
    const socket = (eos as unknown as { socket: Socket }).socket;
    let full = true;
    Object.defineProperty(socket, "writableNeedDrain", { get: () => full, configurable: true });

    expect(eos.set(99, { intens: 1 })).toBe(false);
    expect(lines.some((line) => line.includes("not keeping up"))).toBe(true);
    player.play(new Map([[10, { intens: 42 }]]), 0); // skipped while the desk is behind
    expect(eos.set(10, { intens: 1 })).toBe(false); // still refusing: nothing piles up
    await wait(100);
    expect(desk.received).not.toContain("/eos/chan/10");
    expect(desk.received).not.toContain("/eos/chan/99");

    full = false;
    socket.emit("drain"); // the desk took the backlog
    await until(() => desk.received.includes("/eos/chan/10"));
    expect(lines.some((line) => line.includes("caught up"))).toBe(true);
    // Only the resync reached channel 10: the skipped frame and the refused set never queued.
    expect(desk.received.filter((address) => address === "/eos/chan/10")).toHaveLength(1);
  });
});

const base = {
  eos: { host: "10.0.0.1" },
  fixtures: { a: { channel: 10 } },
  looks: { an: { fixtures: { a: { level: 100 } } }, aus: { fixtures: { a: { level: 0 } } } },
  scenes: { video: "an" },
};
let sequence = 0;
const event = (rest: Record<string, unknown>) => ({ version: 1, bootId: "boot", sequence: ++sequence, timelineId: "main", sessionId: "s", ...rest });

/** Laptop time and server time share a base here, so "arrives at" equals the server time plus transit. */
function timedBridge(extra: Record<string, unknown> = {}) {
  const sent: number[] = [];
  const output: LightOutput = { name: "test", set: (_channel, values) => { if (values.intens !== undefined) sent.push(values.intens); return true; }, close: () => {} };
  const timers: Array<{ at: number; fn: () => void; cancelled: boolean }> = [];
  let now = 0;
  const schedule = (fn: () => void, ms: number) => { const timer = { at: now + ms, fn, cancelled: false }; timers.push(timer); return () => { timer.cancelled = true; }; };
  const advanceTo = (time: number) => {
    now = time;
    for (const timer of timers.filter((entry) => !entry.cancelled && entry.at <= now)) { timer.cancelled = true; timer.fn(); }
  };
  const lines: string[] = [];
  const bridge = new LightingBridge(parseBridgeConfig(JSON.stringify({ ...base, ...extra })), new LookPlayer(output), (line) => lines.push(line), schedule, () => now);
  const arrive = (at: number, rest: Record<string, unknown>) => { advanceTo(at); bridge.handle(event(rest)); };
  return { bridge, sent, lines, advanceTo, arrive };
}
const synced = (timestamp: number, phaseEpoch = 2) => ({ type: "phase", phaseId: "video", phaseEpoch, timestamp, payload: { phase: { startedAt: timestamp + 3_000 } } });

describe("a synchronized scene announced late (Astra 2)", () => {
  it("waits only as long as is left until the scheduled start", () => {
    const { sent, advanceTo, arrive } = timedBridge();
    arrive(1_000, { type: "phase", phaseId: "titel", phaseEpoch: 1, timestamp: 1_000, payload: {} }); // arrives at once
    arrive(11_000, synced(10_000)); // held up for a second on the way
    advanceTo(12_999);
    expect(sent).toEqual([]);
    advanceTo(13_000); // the video's start, not 14 000
    expect(sent).toEqual([100]);
  });

  it("an announcement that arrives after the start lights at once", () => {
    const { sent, arrive } = timedBridge();
    arrive(1_000, { type: "phase", phaseId: "titel", phaseEpoch: 1, timestamp: 1_000, payload: {} });
    arrive(14_500, synced(10_000));
    expect(sent).toEqual([100]);
  });

  it("a slower route after a reconnect is not mistaken for a late event", () => {
    const { sent, advanceTo, arrive } = timedBridge();
    arrive(1_000, { type: "phase", phaseId: "titel", phaseEpoch: 1, timestamp: 1_000, payload: {} });
    arrive(5_500, { type: "snapshot", timestamp: 5_000, timelines: [{ timelineId: "main", phaseId: "titel", phaseEpoch: 1, payload: {} }] });
    arrive(10_500, synced(10_000)); // same 500 ms as the snapshot: on time for this connection
    advanceTo(13_499);
    expect(sent).toEqual([]);
    advanceTo(13_500);
    expect(sent).toEqual([100]);
  });
});

describe("saving the lighting file while a look waits (Astra 3)", () => {
  it("plays the look as it was when the scene was announced", () => {
    const { bridge, sent, lines, advanceTo, arrive } = timedBridge();
    arrive(10_000, synced(10_000));
    // Saved during the 3 s wait: "an" renamed to "hell", the scene now points at it.
    bridge.setConfig(parseBridgeConfig(JSON.stringify({ ...base, looks: { hell: { fixtures: { a: { level: 90 } } }, aus: base.looks.aus }, scenes: { video: "hell" } })));
    advanceTo(13_000);
    expect(sent).toEqual([100]);
    expect(lines.some((line) => line.includes("is missing"))).toBe(false);
  });
});

describe("fixture setup (Astra 4)", () => {
  it.each(["red", "Intens", "intensity", "mint"])("refuses %s, which the looks drive", (param) => {
    expect(() => parseBridgeConfig(JSON.stringify({ ...base, fixtures: { a: { channel: 10, setup: { [param]: 0 } } } }))).toThrow("set by the looks");
  });

  it("accepts parameters the looks do not drive", () => {
    expect(parseBridgeConfig(JSON.stringify({ ...base, fixtures: { a: { channel: 10, setup: { "intensity mspeed": -3 } } } })).fixtures.a!.setup).toEqual({ "intensity mspeed": -3 });
  });

  it("a save that leaves the setup unchanged sends nothing to the desk", async () => {
    const desk = await fakeDesk();
    const setup = [{ channel: 10, params: { "intensity mspeed": -3 } }];
    const eos = new EosConnection({ host: "127.0.0.1", port: desk.port, user: 0 }, () => {}, { setup, retryMs: 50 });
    cleanups.push(() => eos.close());
    eos.connect();
    const address = "/eos/chan/10/param/intensity mspeed";
    await until(() => desk.received.includes(address));
    eos.configure({ host: "127.0.0.1", port: desk.port, user: 0 }, [{ channel: 10, params: { "intensity mspeed": -3 } }]);
    await wait(150);
    expect(desk.received.filter((entry) => entry === address)).toHaveLength(1);
    eos.configure({ host: "127.0.0.1", port: desk.port, user: 0 }, [{ channel: 10, params: { "intensity mspeed": -7 } }]);
    await until(() => desk.received.filter((entry) => entry === address).length === 2);
  });
});
