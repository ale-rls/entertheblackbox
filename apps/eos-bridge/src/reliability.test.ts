import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventSource } from "eventsource";
import { afterEach, describe, expect, it } from "vitest";
import type { ChannelValues } from "./config.js";
import { EosConnection, type LightOutput } from "./eos.js";
import { CueFeed, FEED_RETRY_MAX_MS, FEED_RETRY_MIN_MS, feedFetch, type FeedSource } from "./feed.js";
import { SlipDecoder, oscAddress } from "./osc.js";
import { FRAME_MS, LookPlayer, type Clock } from "./player.js";
import { watchFile } from "./watch.js";

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function until(condition: () => boolean, timeoutMs = 4_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("timed out");
    await wait(20);
  }
}
const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

describe("cue feed after an HTTP error (review finding 1)", () => {
  it("opens a new connection when the server answers 503, and keeps the cues coming", async () => {
    let requests = 0;
    const server: HttpServer = createHttpServer((_request, response) => {
      requests += 1;
      if (requests === 1) { response.writeHead(503).end(); return; }
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write(`data: ${JSON.stringify({ type: "cue", payload: { cue: "licht-aus" } })}\n\n`);
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    cleanups.push(() => new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); }));
    const port = (server.address() as { port: number }).port;

    const events: string[] = [];
    const lines: string[] = [];
    const feed = new CueFeed(new URL(`http://127.0.0.1:${port}/api/cues`), (url) => new EventSource(url) as unknown as FeedSource, (data) => events.push(data), (line) => lines.push(line), () => {});
    cleanups.push(() => feed.stop());
    feed.start();
    await until(() => events.length > 0, FEED_RETRY_MIN_MS + 3_000);
    expect(requests).toBe(2);
    expect(JSON.parse(events[0]!)).toMatchObject({ payload: { cue: "licht-aus" } });
    expect(lines.some((line) => line.includes("HTTP 503"))).toBe(true);
  });

  it("backs off 1 s, 2 s, 4 s … up to 30 s, starts over after a good connection, and stops on 401", () => {
    const sources: Array<FeedSource & { readyState: number }> = [];
    const delays: number[] = [];
    const pending: Array<() => void> = [];
    let unauthorized = false;
    const feed = new CueFeed(
      new URL("http://show.example/api/cues"),
      () => { const source = { readyState: 0, onopen: null, onerror: null, onmessage: null, close() { this.readyState = 2; } }; sources.push(source); return source; },
      () => {}, () => {}, () => { unauthorized = true; }, () => 0,
      (fn, ms) => { delays.push(ms); pending.push(fn); return 0 as unknown as ReturnType<typeof setTimeout>; },
    );
    feed.start();
    const failClosed = (code: number) => { const source = sources.at(-1)!; source.readyState = 2; source.onerror?.({ code }); pending.shift()?.(); };
    for (let i = 0; i < 7; i += 1) failClosed(502);
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, FEED_RETRY_MAX_MS, FEED_RETRY_MAX_MS]);
    expect(sources).toHaveLength(8);

    // A plain network drop: EventSource keeps retrying itself (still CONNECTING), so no extra connection.
    sources.at(-1)!.onerror?.({});
    expect(sources).toHaveLength(8);

    sources.at(-1)!.onopen?.();
    failClosed(503);
    expect(delays.at(-1)).toBe(1_000);

    sources.at(-1)!.readyState = 2;
    sources.at(-1)!.onerror?.({ code: 401 });
    expect(unauthorized).toBe(true);
    expect(pending).toHaveLength(0);
  });
});

describe("cue feed behind a proxy that compresses with br/zstd (#368)", () => {
  it("asks for an uncompressed stream with the token, so the feed opens", async () => {
    const seen: Array<{ authorization?: string | undefined; encoding?: string | undefined }> = [];
    const server: HttpServer = createHttpServer((request, response) => {
      seen.push({ authorization: request.headers.authorization, encoding: request.headers["accept-encoding"] });
      // Like the production proxy: when the client accepts br or zstd, nothing comes back at all.
      if (/\b(br|zstd)\b/.test(request.headers["accept-encoding"] ?? "")) return;
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write(`data: ${JSON.stringify({ type: "snapshot" })}\n\n`);
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    cleanups.push(() => new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); }));
    const port = (server.address() as { port: number }).port;

    const events: string[] = [];
    const feed = new CueFeed(
      new URL(`http://127.0.0.1:${port}/api/cues`),
      (url) => new EventSource(url, { fetch: feedFetch("secret") }) as unknown as FeedSource,
      (data) => events.push(data), () => {}, () => {},
    );
    cleanups.push(() => feed.stop());
    feed.start();
    await until(() => events.length > 0);
    expect(seen[0]).toEqual({ authorization: "Bearer secret", encoding: "identity" });
  });
});

describe("lighting file saved atomically (review finding 2)", () => {
  it("keeps reloading after the file is replaced by a rename, save after save", async () => {
    const dir = mkdtempSync(join(tmpdir(), "eos-bridge-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, "lighting.json");
    writeFileSync(file, "{}");
    let reloads = 0;
    const stop = watchFile(file, () => { reloads += 1; }, 50);
    cleanups.push(stop);
    await wait(100);

    // Same as an editor's atomic save: write a temp file, rename it over the original.
    const atomicSave = (content: string) => { writeFileSync(`${file}.tmp`, content); renameSync(`${file}.tmp`, file); };
    atomicSave('{"level": 20}');
    await until(() => reloads >= 1);
    const afterFirst = reloads;
    atomicSave('{"level": 30}');
    await until(() => reloads > afterFirst);

    // Other files in the folder don't trigger a reload.
    const before = reloads;
    writeFileSync(join(dir, "notes.txt"), "x");
    await wait(300);
    expect(reloads).toBe(before);
  });
});

describe("fades after the desk was unreachable (review finding 3)", () => {
  function setup() {
    let up = true;
    const sent: Array<{ channel: number; values: ChannelValues; final: boolean }> = [];
    const output: LightOutput = { name: "flaky", set: (channel, values, final) => { if (!up) return false; sent.push({ channel, values, final }); return true; }, close: () => {} };
    let now = 0;
    let tick: (() => void) | null = null;
    const clock: Clock = { now: () => now, every: (_ms, fn) => { tick = fn; return () => { tick = null; }; } };
    const advance = (ms: number) => { for (let left = ms; left > 0; left -= FRAME_MS) { now += Math.min(FRAME_MS, left); tick?.(); } };
    return { player: new LookPlayer(output, clock), sent, advance, setUp: (value: boolean) => { up = value; } };
  }

  it("does not fade from a blackout the desk never received", () => {
    const { player, sent, advance, setUp } = setup();
    player.play(new Map([[10, { intens: 100 }]]), 0);
    setUp(false);
    player.play(new Map([[10, { intens: 0 }]]), 0); // missed: the desk stays at 100
    setUp(true);
    sent.length = 0;
    player.play(new Map([[10, { intens: 100 }]]), 2);
    advance(FRAME_MS);
    // Snaps to 100 (the value is unknown again) instead of fading up from an imaginary 0.
    expect(sent[0]).toEqual({ channel: 10, values: { intens: 100 }, final: true });
    expect(sent.some((entry) => (entry.values.intens ?? 100) < 100)).toBe(false);
  });

  it("frames dropped mid-fade make that channel unknown", () => {
    const { player, sent, advance, setUp } = setup();
    player.play(new Map([[10, { intens: 0 }]]), 0);
    player.play(new Map([[10, { intens: 100 }]]), 1);
    advance(300);
    setUp(false);
    advance(800); // the rest of the fade and its final frame are lost
    setUp(true);
    sent.length = 0;
    player.play(new Map([[10, { intens: 50 }]]), 1);
    expect(sent[0]).toEqual({ channel: 10, values: { intens: 50 }, final: true });
  });

  it("forget() makes the next look snap", () => {
    const { player, sent } = setup();
    player.play(new Map([[10, { intens: 0 }]]), 0);
    player.forget();
    sent.length = 0;
    player.play(new Map([[10, { intens: 80 }]]), 3);
    expect(sent[0]).toEqual({ channel: 10, values: { intens: 80 }, final: true });
  });
});

/** A stand-in Eos desk: records the OSC addresses each connection sends. */
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
  return { port: (server.address() as { port: number }).port, received, sockets };
}

describe("desk connection", () => {
  it("reports a lost connection and refuses to send while down (review finding 3)", async () => {
    const desk = await fakeDesk();
    const changes: boolean[] = [];
    const eos = new EosConnection({ host: "127.0.0.1", port: desk.port, user: 0 }, () => {}, { onConnectionChange: (up) => changes.push(up), retryMs: 50 });
    cleanups.push(() => eos.close());
    eos.connect();
    await until(() => eos.isConnected);
    expect(eos.set(10, { intens: 50 })).toBe(true);
    for (const socket of desk.sockets) socket.destroy();
    await until(() => !eos.isConnected);
    expect(eos.set(10, { intens: 60 })).toBe(false);
    await until(() => eos.isConnected); // reconnects by itself
    expect(changes).toEqual([true, false, true]);
  });

  it("moves to a new address, port or user when the lighting file changes (review finding 4)", async () => {
    const first = await fakeDesk();
    const second = await fakeDesk();
    const lines: string[] = [];
    const changes: boolean[] = [];
    const eos = new EosConnection({ host: "127.0.0.1", port: first.port, user: 0 }, (line) => lines.push(line), { onConnectionChange: (up) => changes.push(up), retryMs: 50 });
    cleanups.push(() => eos.close());
    eos.connect();
    await until(() => first.received.includes("/eos/user"));

    expect(eos.retarget({ host: "127.0.0.1", port: first.port, user: 0 })).toBe(false); // unchanged: stays put
    expect(eos.retarget({ host: "127.0.0.1", port: second.port, user: 2 })).toBe(true);
    await until(() => second.received.includes("/eos/user") && eos.isConnected);
    await until(() => first.sockets.size === 0);
    eos.set(10, { red: 100 });
    await until(() => second.received.includes("/eos/chan/10/param/red"));
    expect(first.received).not.toContain("/eos/chan/10/param/red");
    expect(eos.name).toBe(`Eos 127.0.0.1:${second.port}`);
    expect(changes).toEqual([true, false, true]);
    expect(lines.some((line) => line.includes("desk settings changed"))).toBe(true);
  });

  it("a reload that switches desks sends the new fixture setup only to the new desk", async () => {
    const first = await fakeDesk();
    const second = await fakeDesk();
    const eos = new EosConnection({ host: "127.0.0.1", port: first.port, user: 0 }, () => {}, {
      setup: [{ channel: 10, params: { "intensity mspeed": -3 } }],
      retryMs: 50,
    });
    cleanups.push(() => eos.close());
    eos.connect();
    await until(() => first.received.includes("/eos/chan/10/param/intensity mspeed"));

    const moved = eos.configure({ host: "127.0.0.1", port: second.port, user: 0 }, [{ channel: 20, params: { "intensity mspeed": -7 } }]);
    expect(moved).toBe(true);
    await until(() => second.received.includes("/eos/chan/20/param/intensity mspeed"));
    await wait(100);
    expect(first.received).not.toContain("/eos/chan/20/param/intensity mspeed");
    expect(second.received).not.toContain("/eos/chan/10/param/intensity mspeed");

    // Same desk, new setup: it goes straight out on the open connection.
    expect(eos.configure({ host: "127.0.0.1", port: second.port, user: 0 }, [{ channel: 30, params: { "intensity mspeed": -3 } }])).toBe(false);
    await until(() => second.received.includes("/eos/chan/30/param/intensity mspeed"));
  });
});
