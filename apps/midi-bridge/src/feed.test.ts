import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { EventSource } from "eventsource";
import { afterEach, describe, expect, it } from "vitest";
import { CueFeed, FEED_RETRY_MAX_MS, FEED_RETRY_MIN_MS, feedFetch, type FeedSource } from "./feed.js";

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

describe("cue feed after an HTTP error", () => {
  it("opens a new connection when the server answers 503, and keeps the cues coming", async () => {
    let requests = 0;
    const server: HttpServer = createHttpServer((_request, response) => {
      requests += 1;
      if (requests === 1) { response.writeHead(503).end(); return; }
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write(`data: ${JSON.stringify({ type: "cue", payload: { cue: "musik-start" } })}\n\n`);
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
    expect(JSON.parse(events[0]!)).toMatchObject({ payload: { cue: "musik-start" } });
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
