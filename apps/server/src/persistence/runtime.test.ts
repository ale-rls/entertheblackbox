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
    const pool = {
      async query(text: string, values?: readonly unknown[]) {
        queries.push({ text, ...(values === undefined ? {} : { values }) });
        if (text.startsWith("select id from sessions")) return { rows: [{ id: "active-session" }] };
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
    });

    expect(runtime).not.toBeNull();
    expect(queries[0]?.text).toBe("-- migration marker");
    expect(queries.some(({ text }) => text.startsWith("select id from sessions"))).toBe(true);
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
    expect(endCalls).toBe(1);
  });
});
