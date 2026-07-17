import { describe, expect, it, vi } from "vitest";
import { scenarioSchema } from "@smartphonecracy/scenario";
import { loadConfig } from "../config.js";
import { createPersistenceRuntime } from "./runtime.js";

const scenario = scenarioSchema.parse({
  version: "runtime-test",
  entryPhaseId: "intro",
  cyclesAllowed: false,
  phases: [
    { kind: "idle", id: "idle" },
    { kind: "video", id: "intro", src: "intro.mp4", expectedDurationMs: 1_000, next: "idle" },
  ],
});

describe("production persistence runtime", () => {
  it("stays disabled when DATABASE_URL is absent", async () => {
    const createPool = vi.fn();
    expect(await createPersistenceRuntime(loadConfig({ NODE_ENV: "test" }), scenario, { createPool })).toBeNull();
    expect(createPool).not.toHaveBeenCalled();
  });

  it("migrates, uses a fresh pooled client for later batches, and closes the pool", async () => {
    const queries: Array<{ text: string; values?: readonly unknown[] }> = [];
    const batchQueries: string[][] = [];
    let connectCalls = 0;
    let releaseCalls = 0;
    let endCalls = 0;
    const cleanupTimer = { unref: vi.fn() };
    const setTimeoutStub = vi.fn(() => cleanupTimer as unknown as ReturnType<typeof setTimeout>);
    const clearTimeoutStub = vi.fn();
    const pool = {
      async query(text: string, values?: readonly unknown[]) {
        queries.push({ text, ...(values === undefined ? {} : { values }) });
        if (text.startsWith("select id from sessions")) return { rows: [{ id: "active-session" }] };
        if (text.startsWith("select delete_expired_participant_data")) return { rows: [{ deletedCount: "2" }] };
        return { rows: [] };
      },
      async connect() {
        connectCalls += 1;
        const clientQueries: string[] = [];
        batchQueries.push(clientQueries);
        return {
          async query(text: string) { clientQueries.push(text); return { rows: [] }; },
          release() { releaseCalls += 1; },
        };
      },
      async end() { endCalls += 1; },
    };
    const runtime = await createPersistenceRuntime(loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgres://example.invalid/db",
      INSTALLATION_CLOSES_AT: "2026-12-31T23:00:00+00:00",
    }), scenario, {
      createPool: () => pool,
      readMigration: async () => "-- migration marker",
      now: () => Date.parse("2026-07-12T15:00:00Z"),
      setTimeout: setTimeoutStub as unknown as typeof setTimeout,
      clearTimeout: clearTimeoutStub as unknown as typeof clearTimeout,
      log: () => { throw new Error("broken log observer"); },
    });

    expect(runtime).not.toBeNull();
    expect(queries[0]?.text).toBe("-- migration marker");
    expect(queries.some(({ text }) => text.startsWith("select id from sessions"))).toBe(true);
    expect(queries.some(({ text }) => text.startsWith("select delete_expired_participant_data"))).toBe(true);
    expect(batchQueries[0]?.some((text) => text.includes("insert into scenarios"))).toBe(true);
    expect(batchQueries[1]?.some((text) => text.startsWith("update sessions set status='ended'"))).toBe(true);
    expect(batchQueries[1]?.some((text) => text.includes("'recovery'"))).toBe(true);
    runtime?.persistence.audit({ action: "later-operation", at: "2026-07-12T15:01:00Z", detail: null });
    await runtime?.persistence.flush();
    expect(batchQueries[2]?.some((text) => text.includes("'admin_action'"))).toBe(true);
    expect(connectCalls).toBe(3);
    expect(releaseCalls).toBe(3);
    await runtime?.close();
    await runtime?.close();
    expect(cleanupTimer.unref).toHaveBeenCalledOnce();
    expect(clearTimeoutStub).toHaveBeenCalledOnce();
    expect(clearTimeoutStub).toHaveBeenCalledWith(cleanupTimer);
    expect(endCalls).toBe(1);
  });

  it("logs cleanup failures, retries daily without overlap, and waits for in-flight cleanup on close", async () => {
    const cleanupResults: Array<Promise<{ rows: Array<{ deletedCount: string }> }>> = [
      Promise.reject(new Error("cleanup unavailable")),
    ];
    let resolveSecondCleanup!: (result: { rows: Array<{ deletedCount: string }> }) => void;
    cleanupResults.push(new Promise((resolve) => { resolveSecondCleanup = resolve; }));
    const pool = {
      async query(text: string) {
        if (text.startsWith("select id from sessions")) return { rows: [] };
        if (text.startsWith("select delete_expired_participant_data")) return cleanupResults.shift() ?? { rows: [{ deletedCount: "0" }] };
        return { rows: [] };
      },
      async connect() {
        return { query: async () => ({ rows: [] }), release: () => undefined };
      },
      end: vi.fn(async () => undefined),
    };
    const callbacks: Array<() => void> = [];
    const timers: Array<{ unref: ReturnType<typeof vi.fn> }> = [];
    const setTimeoutStub = vi.fn((callback: () => void, _delay: number) => {
      callbacks.push(callback);
      const timer = { unref: vi.fn() };
      timers.push(timer);
      return timer as unknown as ReturnType<typeof setTimeout>;
    });
    const clearTimeoutStub = vi.fn();
    const events: Array<{ status: string; [key: string]: unknown }> = [];
    const runtime = await createPersistenceRuntime(loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgres://example.invalid/db",
      INSTALLATION_CLOSES_AT: "2026-12-31T23:00:00+00:00",
    }), scenario, {
      createPool: () => pool,
      readMigration: async () => "-- migration marker",
      now: () => Date.parse("2026-07-12T15:00:00Z"),
      retentionCleanupIntervalMs: 1234,
      setTimeout: setTimeoutStub as unknown as typeof setTimeout,
      clearTimeout: clearTimeoutStub as unknown as typeof clearTimeout,
      log: (event) => events.push(event),
    });

    expect(events).toContainEqual({
      status: "retention-cleanup-failed",
      cutoff: "2026-07-12T15:00:00.000Z",
      error: { name: "Error", message: "cleanup unavailable" },
    });
    expect(setTimeoutStub).toHaveBeenCalledTimes(1);
    expect(setTimeoutStub).toHaveBeenCalledWith(expect.any(Function), 1234);
    expect(timers[0]?.unref).toHaveBeenCalledOnce();

    callbacks.shift()?.();
    await Promise.resolve();
    expect(setTimeoutStub).toHaveBeenCalledTimes(1);

    const close = runtime?.close();
    await Promise.resolve();
    expect(pool.end).not.toHaveBeenCalled();
    resolveSecondCleanup({ rows: [{ deletedCount: "4" }] });
    await close;

    expect(events).toContainEqual({
      status: "retention-cleanup-succeeded",
      cutoff: "2026-07-12T15:00:00.000Z",
      deletedRows: 4,
    });
    expect(clearTimeoutStub).not.toHaveBeenCalled();
    expect(setTimeoutStub).toHaveBeenCalledTimes(1);
    expect(pool.end).toHaveBeenCalledOnce();
  });
});
