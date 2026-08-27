import { describe, expect, it, vi } from "vitest";
import type { MediaManifest } from "@smartphonecracy/scenario";
import { MediaStore, type MediaSyncStatus } from "./mediaStore.js";

/** Minimal in-memory CacheStorage double. */
function fakeCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      match: async (key: string | Request) => {
        const k = typeof key === "string" ? key : new URL(key.url).pathname;
        const hit = store.get(k);
        return hit ? hit.clone() : undefined;
      },
      put: async (key: string | Request, response: Response) => {
        const k = typeof key === "string" ? key : new URL(key.url).pathname;
        store.set(k, response);
      },
      delete: async (key: string | Request) => {
        const k = typeof key === "string" ? key : new URL(key.url).pathname;
        return store.delete(k);
      },
      keys: async () =>
        [...store.keys()].map((k) => new Request(`http://local${k}`)),
    };
  };
  return { caches: { open } as unknown as CacheStorage, stores };
}

const manifest: MediaManifest = {
  files: [
    { src: "a.mp4", bytes: 3, hash: "hash-a" },
    { src: "b.mp4", bytes: 5, hash: "hash-b" },
  ],
};

const bodies: Record<string, string> = { "a.mp4": "AAA", "b.mp4": "BBBBB" };

const fakeFetch = (overrides: Partial<Record<string, () => Response>> = {}) =>
  (async (input: RequestInfo | URL) => {
    const src = String(input).replace("/media/", "");
    const override = overrides[src];
    if (override) return override();
    const body = bodies[src];
    if (body === undefined) return new Response(null, { status: 404 });
    return new Response(new TextEncoder().encode(body));
  }) as typeof fetch;

const fakeDigest = async (data: ArrayBuffer) =>
  `hash-${new TextDecoder().decode(data)[0]!.toLowerCase()}`;

const makeStore = (opts: {
  caches: CacheStorage;
  fetchFn?: typeof fetch;
  statuses?: MediaSyncStatus[];
}) =>
  new MediaStore({
    caches: opts.caches,
    fetchFn: opts.fetchFn ?? fakeFetch(),
    digest: fakeDigest,
    createObjectUrl: (blob) => `blob:${blob.size}`,
    revokeObjectUrl: vi.fn(),
    onStatus: (s) => opts.statuses?.push(s),
    sleep: async () => {},
  });

describe("MediaStore.sync", () => {
  it("downloads missing files, verifies them, and reaches ready", async () => {
    const { caches, stores } = fakeCaches();
    const statuses: MediaSyncStatus[] = [];
    const store = makeStore({ caches, statuses });
    await expect(store.sync(manifest)).resolves.toBe(true);
    expect(statuses.at(-1)).toEqual({ state: "ready" });
    const cached = stores.get("smartphonecracy-media-v1")!;
    expect(cached.has("/media-cache/hash-a")).toBe(true);
    expect(cached.has("/media-cache/hash-b")).toBe(true);
  });

  it("preserves image and MP3 content types in Cache Storage", async () => {
    const { caches, stores } = fakeCaches();
    const mixed: MediaManifest = { files: [
      { src: "portrait.jpg", bytes: 1, hash: "hash-i" },
      { src: "voice.mp3", bytes: 1, hash: "hash-a" },
    ] };
    const fetchFn = (async (input: RequestInfo | URL) => new Response(new TextEncoder().encode(String(input).includes("portrait") ? "I" : "A"))) as typeof fetch;
    await makeStore({ caches, fetchFn }).sync(mixed);
    const cached = stores.get("smartphonecracy-media-v1")!;
    expect(cached.get("/media-cache/hash-i")?.headers.get("content-type")).toBe("image/jpeg");
    expect(cached.get("/media-cache/hash-a")?.headers.get("content-type")).toBe("audio/mpeg");
  });

  it("downloads with cache: no-store so an immutable-cached corrupt response cannot poison retries", async () => {
    const { caches } = fakeCaches();
    const fetchSpy = vi.fn(fakeFetch());
    const store = makeStore({ caches, fetchFn: fetchSpy as typeof fetch });
    await store.sync(manifest);
    expect(fetchSpy).toHaveBeenCalled();
    for (const [, init] of fetchSpy.mock.calls) {
      expect(init).toEqual({ cache: "no-store" });
    }
  });

  it("skips files already cached with the right size", async () => {
    const { caches } = fakeCaches();
    const store = makeStore({ caches });
    await store.sync(manifest);
    const fetchSpy = vi.fn(fakeFetch());
    const second = new MediaStore({
      caches,
      fetchFn: fetchSpy as typeof fetch,
      digest: fakeDigest,
      sleep: async () => {},
    });
    await second.sync(manifest);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("retries on size mismatch and stays out of ready", async () => {
    const { caches } = fakeCaches();
    const statuses: MediaSyncStatus[] = [];
    let calls = 0;
    const flaky = (async (input: RequestInfo | URL) => {
      const src = String(input).replace("/media/", "");
      if (src === "a.mp4" && calls++ === 0) {
        return new Response(new TextEncoder().encode("AA")); // truncated
      }
      return fakeFetch()(input);
    }) as typeof fetch;
    const store = makeStore({ caches, fetchFn: flaky, statuses });
    await expect(store.sync(manifest)).resolves.toBe(true);
    expect(statuses.some((s) => s.state === "retrying")).toBe(true);
    expect(statuses.at(-1)).toEqual({ state: "ready" });
  });

  it("retries on hash mismatch", async () => {
    const { caches } = fakeCaches();
    const statuses: MediaSyncStatus[] = [];
    let calls = 0;
    const corrupted = (async (input: RequestInfo | URL) => {
      const src = String(input).replace("/media/", "");
      if (src === "a.mp4" && calls++ === 0) {
        return new Response(new TextEncoder().encode("XAA")); // wrong content, right size
      }
      return fakeFetch()(input);
    }) as typeof fetch;
    const store = makeStore({ caches, fetchFn: corrupted, statuses });
    await expect(store.sync(manifest)).resolves.toBe(true);
    const retry = statuses.find((s) => s.state === "retrying");
    expect(retry && "lastError" in retry && retry.lastError).toContain("hash mismatch");
  });

  it("re-hashes cached entries and redownloads corrupted ones", async () => {
    const { caches, stores } = fakeCaches();
    await makeStore({ caches }).sync(manifest);
    // Corrupt the cached copy of a.mp4: right length, wrong content.
    stores
      .get("smartphonecracy-media-v1")!
      .set(
        "/media-cache/hash-a",
        new Response(new TextEncoder().encode("XXX"), {
          headers: { "content-length": "3" },
        }),
      );
    const fetchSpy = vi.fn(fakeFetch());
    const second = new MediaStore({
      caches,
      fetchFn: fetchSpy as typeof fetch,
      digest: fakeDigest,
      sleep: async () => {},
    });
    await expect(second.sync(manifest)).resolves.toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // only the corrupted file
    expect(String(fetchSpy.mock.calls[0]![0])).toContain("a.mp4");
  });

  it("removes cache entries dropped from the manifest", async () => {
    const { caches, stores } = fakeCaches();
    const store = makeStore({ caches });
    await store.sync(manifest);
    const shrunk: MediaManifest = { files: [manifest.files[0]!] };
    await makeStore({ caches }).sync(shrunk);
    const cached = stores.get("smartphonecracy-media-v1")!;
    expect(cached.has("/media-cache/hash-a")).toBe(true);
    expect(cached.has("/media-cache/hash-b")).toBe(false);
  });
});

describe("Blob URL lifecycle", () => {
  it("creates URLs from cache and revokes outside the keep set", async () => {
    const { caches } = fakeCaches();
    const revoke = vi.fn();
    const store = new MediaStore({
      caches,
      fetchFn: fakeFetch(),
      digest: fakeDigest,
      createObjectUrl: (blob) => `blob:${blob.size}`,
      revokeObjectUrl: revoke,
      sleep: async () => {},
    });
    await store.sync(manifest);
    const a = await store.getBlobUrl("a.mp4");
    const b = await store.getBlobUrl("b.mp4");
    expect(a).toBe("blob:3");
    expect(b).toBe("blob:5");
    expect(await store.getBlobUrl("a.mp4")).toBe(a); // memoized
    store.retainOnly(new Set(["b.mp4"]));
    expect(revoke).toHaveBeenCalledWith("blob:3");
    expect(store.activeBlobCount).toBe(1);
  });

  it("revokes all Blob URLs on stop()", async () => {
    const { caches } = fakeCaches();
    const revoke = vi.fn();
    const store = new MediaStore({
      caches,
      fetchFn: fakeFetch(),
      digest: fakeDigest,
      createObjectUrl: (blob) => `blob:${blob.size}`,
      revokeObjectUrl: revoke,
      sleep: async () => {},
    });
    await store.sync(manifest);
    await store.getBlobUrl("a.mp4");
    await store.getBlobUrl("b.mp4");
    store.stop();
    expect(revoke).toHaveBeenCalledTimes(2);
    expect(store.activeBlobCount).toBe(0);
  });

  it("returns null for unknown or uncached media", async () => {
    const { caches } = fakeCaches();
    const store = makeStore({ caches });
    await store.sync(manifest);
    expect(await store.getBlobUrl("ghost.mp4")).toBeNull();
  });
});

describe("chunked large-file downloads", () => {
  const bigBody = "BBBBBBBBBBBB"; // 12 bytes, first char matches fakeDigest's "hash-b" scheme
  const bigManifest: MediaManifest = {
    files: [{ src: "big.mp4", bytes: 12, hash: "hash-b" }],
  };

  const rangeAwareFetch = (body: string) =>
    (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const bytes = new TextEncoder().encode(body);
      const rangeHeader = (init?.headers as Record<string, string> | undefined)?.range;
      if (rangeHeader === undefined) return new Response(bytes);
      const match = /^bytes=(\d+)-(\d+)$/.exec(rangeHeader);
      if (!match) return new Response(null, { status: 416 });
      const start = Number(match[1]);
      const end = Number(match[2]);
      return new Response(bytes.slice(start, end + 1), { status: 206 });
    }) as typeof fetch;

  it("downloads a file at/above the threshold as sequential Range requests and reassembles it", async () => {
    const { caches, stores } = fakeCaches();
    const fetchSpy = vi.fn(rangeAwareFetch(bigBody));
    const store = new MediaStore({
      caches,
      fetchFn: fetchSpy as typeof fetch,
      digest: fakeDigest,
      sleep: async () => {},
      chunkThresholdBytes: 12,
      chunkBytes: 4,
    });
    await expect(store.sync(bigManifest)).resolves.toBe(true);
    expect(fetchSpy.mock.calls.map(([, init]) => (init as RequestInit).headers)).toEqual([
      { range: "bytes=0-3" },
      { range: "bytes=4-7" },
      { range: "bytes=8-11" },
    ]);
    const cached = stores.get("smartphonecracy-media-v1")!.get("/media-cache/hash-b");
    expect(await cached?.text()).toBe(bigBody);
  });

  it("stays below the chunk threshold using a single unranged GET, unchanged from before", async () => {
    const { caches } = fakeCaches();
    const fetchSpy = vi.fn(fakeFetch());
    const store = makeStore({ caches, fetchFn: fetchSpy as typeof fetch });
    await store.sync(manifest); // a.mp4/b.mp4 are 3/5 bytes, well under any real threshold
    for (const [, init] of fetchSpy.mock.calls) {
      expect(init).toEqual({ cache: "no-store" }); // no range header
    }
  });

  it("recovers from a dropped chunk via the outer retry loop, not restarting other files", async () => {
    const { caches } = fakeCaches();
    let firstAttemptAtSecondChunk = true;
    const flaky = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const rangeHeader = (init?.headers as Record<string, string> | undefined)?.range;
      if (rangeHeader === "bytes=4-7" && firstAttemptAtSecondChunk) {
        firstAttemptAtSecondChunk = false;
        throw new Error("connection reset");
      }
      return rangeAwareFetch(bigBody)(input, init);
    }) as typeof fetch;
    const statuses: MediaSyncStatus[] = [];
    const store = new MediaStore({
      caches,
      fetchFn: flaky,
      digest: fakeDigest,
      onStatus: (s) => statuses.push(s),
      sleep: async () => {},
      chunkThresholdBytes: 12,
      chunkBytes: 4,
    });
    await expect(store.sync(bigManifest)).resolves.toBe(true);
    expect(statuses.some((s) => s.state === "retrying")).toBe(true);
    expect(statuses.at(-1)).toEqual({ state: "ready" });
  });
});
