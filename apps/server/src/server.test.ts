import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { ConfigError, buildServer, listenWithCleanup, loadConfig, type ServerRuntime } from "./index.js";

const runtimes: ServerRuntime[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(async ({ app }) => {
    if (app.server.listening) await app.close();
  }));
});

async function fixture(invalidScenario = false) {
  const root = await mkdtemp(join(tmpdir(), "smartphonecracy-server-"));
  const content = join(root, "content");
  const media = join(content, "media");
  await mkdir(media, { recursive: true });
  await writeFile(join(media, "intro.mp4"), "video");
  await writeFile(join(media, "outro.mp4"), "outro");
  const scenario = {
    version: "test-1",
    entryPhaseId: "intro",
    cyclesAllowed: false,
    operatorNotes: "scenario-internal-marker",
    phases: [
      { kind: "idle", id: "idle" },
      {
        kind: "video",
        id: "intro",
        src: "intro.mp4",
        expectedDurationMs: 1000,
        next: invalidScenario ? "missing" : "question",
        allowSkip: true,
        sourceCredential: "video-internal-marker",
      },
      {
        kind: "position-question",
        id: "question",
        text: "Private question marker",
        durationMs: 10_000,
        freezeMs: 500,
        connectionStaleAfterMs: 30_000,
        showLiveCounts: true,
        field: {
          type: "two-quadrant",
          axis: "x",
          labels: { minLabel: "No", maxLabel: "Yes" },
        },
        next: { type: "fixed", target: "outro" },
      },
      { kind: "video", id: "outro", src: "outro.mp4", expectedDurationMs: 2000, next: "idle" },
    ],
  };
  await writeFile(join(content, "scenario.json"), JSON.stringify(scenario));
  await writeFile(
    join(content, "media-manifest.json"),
    JSON.stringify({
      files: [
        { src: "intro.mp4", bytes: 5, hash: "test" },
        { src: "outro.mp4", bytes: 5, hash: "test-outro" },
      ],
    }),
  );
  for (const role of ["display", "phone", "admin"]) {
    const dist = join(root, role, "dist");
    await mkdir(dist, { recursive: true });
    await writeFile(join(dist, "index.html"), `<h1>${role}</h1>`);
  }
  const config = loadConfig({
    NODE_ENV: "test",
    PORT: "3001",
    SCENARIO_PATH: "content/scenario.json",
    MEDIA_MANIFEST_PATH: "content/media-manifest.json",
    MEDIA_DIR: "content/media",
    DISPLAY_DIST_DIR: "display/dist",
    PHONE_DIST_DIR: "phone/dist",
    ADMIN_DIST_DIR: "admin/dist",
  }, root);
  return config;
}

describe("configuration", () => {
  it("resolves paths from the supplied root and rejects invalid values", async () => {
    const config = await fixture();
    expect(config.scenarioPath).toMatch(/content\/scenario\.json$/);
    expect(config.adminRateLimit).toEqual({
      maxAuthenticatedRequests: 600,
      maxAuthenticationFailures: 30,
      windowMs: 60_000,
    });
    expect(() => loadConfig({ PORT: "70000" })).toThrow(ConfigError);
    expect(() => loadConfig({ ADMIN_RATE_LIMIT_MAX_REQUESTS: "0" })).toThrow(ConfigError);
    expect(() => loadConfig({ DATABASE_URL: "postgres://db" })).toThrow(/INSTALLATION_CLOSES_AT/);
    expect(loadConfig({
      ADMIN_RATE_LIMIT_MAX_REQUESTS: "900",
      ADMIN_RATE_LIMIT_MAX_AUTH_FAILURES: "12",
      ADMIN_RATE_LIMIT_WINDOW_MS: "30000",
    }).adminRateLimit).toEqual({
      maxAuthenticatedRequests: 900,
      maxAuthenticationFailures: 12,
      windowMs: 30_000,
    });
    const persistent = loadConfig({
      DATABASE_URL: "postgres://db",
      INSTALLATION_CLOSES_AT: "2026-12-31T23:00:00+00:00",
    });
    expect(persistent.participantDataExpiresAt).toBe(Date.parse("2027-03-31T23:00:00Z"));
  });
});

describe("HTTP readiness and bundles", () => {
  it("reports health, readiness, sanitized status, and serves all client bundles", async () => {
    const runtime = await buildServer({ config: await fixture() });
    runtimes.push(runtime);
    expect((await runtime.app.inject({ url: "/healthz" })).statusCode).toBe(200);
    const ready = await runtime.app.inject({ url: "/readyz" });
    expect(ready.json()).toEqual({ ok: true, scenarioVersion: "test-1" });
    const status = (await runtime.app.inject({ url: "/api/status" })).json();
    expect(status).toMatchObject({ ready: true, scenarioVersion: "test-1" });
    expect(status).not.toHaveProperty("displayToken");
    for (const role of ["display", "phone", "admin"]) {
      const response = await runtime.app.inject({ url: `/${role}/` });
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain(`<h1>${role}</h1>`);
      expect(response.headers["cache-control"]).toBe("no-cache");
    }
  });

  it("exposes only the public video phase id-to-source map", async () => {
    const runtime = await buildServer({ config: await fixture() });
    runtimes.push(runtime);

    const response = await runtime.app.inject({ url: "/api/phases" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ intro: "intro.mp4", outro: "outro.mp4" });
    expect(response.body).not.toContain("expectedDurationMs");
    expect(response.body).not.toContain("entryPhaseId");
    expect(response.body).not.toContain("idle");
    expect(response.body).not.toContain("question");
    expect(response.body).not.toContain("scenario-internal-marker");
    expect(response.body).not.toContain("video-internal-marker");
  });

  it("serves the media manifest and immutable media without changing readiness", async () => {
    const runtime = await buildServer({ config: await fixture() });
    runtimes.push(runtime);

    const manifest = await runtime.app.inject({ url: "/media-manifest.json" });
    expect(manifest.statusCode).toBe(200);
    expect(manifest.headers["content-type"]).toContain("application/json");
    expect(manifest.headers["cache-control"]).toBe("no-cache");
    expect(manifest.json()).toEqual({
      files: [
        { src: "intro.mp4", bytes: 5, hash: "test" },
        { src: "outro.mp4", bytes: 5, hash: "test-outro" },
      ],
    });

    const media = await runtime.app.inject({ url: "/media/intro.mp4" });
    expect(media.statusCode).toBe(200);
    expect(media.body).toBe("video");
    expect(media.headers["content-type"]).toBe("video/mp4");
    expect(media.headers["cache-control"]).toBe("public, max-age=31536000, immutable");

    expect((await runtime.app.inject({ url: "/media/unknown.mp4" })).statusCode).toBe(404);
    expect((await runtime.app.inject({ url: "/media/%2e%2e/scenario.json" })).statusCode).toBe(404);
    expect((await runtime.app.inject({ url: "/readyz" })).json()).toEqual({
      ok: true,
      scenarioVersion: "test-1",
    });
  });

  it("stays live but fails readiness for an invalid scenario", async () => {
    const runtime = await buildServer({ config: await fixture(true) });
    runtimes.push(runtime);
    expect((await runtime.app.inject({ url: "/healthz" })).statusCode).toBe(200);
    const ready = await runtime.app.inject({ url: "/readyz" });
    expect(ready.statusCode).toBe(503);
    expect(ready.json().errors[0]).toContain("unknown phase");
    const phases = await runtime.app.inject({ url: "/api/phases" });
    expect(phases.statusCode).toBe(503);
    expect(phases.json()).toEqual({ error: "scenario_unavailable" });
  });
});

describe("WebSocket lifecycle", () => {
  it("closes app resources before persistence when listening fails", async () => {
    const order: string[] = [];
    const failure = new Error("listen failed");
    await expect(listenWithCleanup({
      listen: async () => { throw failure; },
      close: async () => { order.push("app"); },
    }, {
      close: async () => { order.push("persistence"); },
    }, { host: "127.0.0.1", port: 3001 })).rejects.toBe(failure);
    expect(order).toEqual(["app", "persistence"]);
  });

  it("preserves listen and cleanup failures together", async () => {
    const listenError = new Error("listen failed");
    const closeError = new Error("app close failed");
    const persistenceError = new Error("persistence close failed");
    const result = listenWithCleanup({
      listen: async () => { throw listenError; },
      close: async () => { throw closeError; },
    }, {
      close: async () => { throw persistenceError; },
    }, { host: "127.0.0.1", port: 3001 });
    await expect(result).rejects.toMatchObject({
      name: "AggregateError",
      errors: [listenError, closeError, persistenceError],
    });
  });

  it("accepts /ws upgrades and closes clients during graceful shutdown", async () => {
    let connected = false;
    const runtime = await buildServer({
      config: await fixture(),
      onWebSocketConnection: () => { connected = true; },
    });
    runtimes.push(runtime);
    await runtime.app.listen({ host: "127.0.0.1", port: 0 });
    const address = runtime.app.server.address();
    if (!address || typeof address === "string") throw new Error("expected TCP address");
    const client = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
    await new Promise<void>((resolve, reject) => {
      client.once("open", resolve);
      client.once("error", reject);
    });
    expect(connected).toBe(true);
    const closed = new Promise<void>((resolve) => client.once("close", () => resolve()));
    await runtime.app.close();
    await closed;
    expect(runtime.webSockets.clients.size).toBe(0);
  });
});
