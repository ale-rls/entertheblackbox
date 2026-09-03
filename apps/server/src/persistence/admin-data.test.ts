import { describe, expect, it, vi } from "vitest";
import { PocketBaseAdminDataSource } from "./admin-data.js";
import type { PocketBaseClient } from "./pocketbase-client.js";

describe("PocketBaseAdminDataSource movement deletion", () => {
  it("waits for queued recording writes, then deletes batches before their parent records", async () => {
    const rows = {
      movement_recordings: new Map<string, Record<string, unknown>>(),
      movement_recording_batches: new Map<string, Record<string, unknown>>(),
    };
    const operations: string[] = [];
    let nextId = 0;
    const pb = {
      filter: (_expression: string, params: Record<string, unknown>) => JSON.stringify(params),
      collection: (name: keyof typeof rows) => ({
        create: async (data: Record<string, unknown>) => {
          const id = `row-${++nextId}`;
          rows[name].set(id, { id, ...data });
          operations.push(`create:${name}`);
          return rows[name].get(id);
        },
        getFirstListItem: async (filter: string) => {
          const params = JSON.parse(filter) as Record<string, unknown>;
          const row = [...rows[name].values()].find((candidate) =>
            candidate.recordingId === (params.id ?? params.recordingId));
          if (row === undefined) throw new Error("not found");
          return row;
        },
        getFullList: async ({ filter }: { filter: string }) => {
          const params = JSON.parse(filter) as Record<string, unknown>;
          return [...rows[name].values()].filter((candidate) =>
            Object.entries(params).every(([key, value]) => candidate[key] === value));
        },
        update: async (id: string, data: Record<string, unknown>) => {
          rows[name].set(id, { ...rows[name].get(id), ...data });
          operations.push(`update:${name}`);
        },
        delete: async (id: string) => {
          rows[name].delete(id);
          operations.push(`delete:${name}`);
        },
      }),
    };
    const client = {
      ensureAuth: vi.fn(async () => undefined),
      pb,
    } as unknown as PocketBaseClient;
    const data = new PocketBaseAdminDataSource(client, { installationId: "inst-1", roomId: "room-1" });

    data.recordMovementStarted({
      recordingId: "recording-1",
      sessionId: "session-1",
      participantId: "participant-1",
      participantName: "Ada",
      showId: "show-1",
      scenarioVersion: "v1",
      installationId: "inst-1",
      roomId: "room-1",
      startedAt: 1_000,
    });
    data.recordMovementBatch({
      recordingId: "recording-1",
      sessionId: "session-1",
      batchIndex: 0,
      recordedAt: 2_000,
      samples: [{ t: 1_000, x: 0.25, y: 0.75 }],
    });
    data.recordMovementFinalized({
      recordingId: "recording-1",
      endedAt: 3_000,
      status: "completed",
      sampleCount: 1,
    });

    await data.deleteMovementRecordings("session-1", "participant-1");

    expect(rows.movement_recordings.size).toBe(0);
    expect(rows.movement_recording_batches.size).toBe(0);
    expect(operations).toEqual([
      "create:movement_recordings",
      "create:movement_recording_batches",
      "update:movement_recordings",
      "delete:movement_recording_batches",
      "delete:movement_recordings",
    ]);
  });
});
