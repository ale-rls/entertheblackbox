import { afterEach, describe, expect, it, vi } from "vitest";
import scenarioJson from "../../../../content/scenarios/dev.json";
import { scenarioSchema, type Scenario } from "@smartphonecracy/scenario";
import type { FinalVoteSnapshot } from "../votes/index.js";
import { InstallationPersistence, PersistenceWriteQueue, PostgresPersistenceExecutor, type PersistenceExecutor, type PersistenceQueueHealthEvent, type SqlStatement } from "./index.js";

class RecordingExecutor implements PersistenceExecutor {
  calls: SqlStatement[][] = [];
  queries: SqlStatement[] = [];
  failures = 0;
  rows: Record<string, unknown>[] = [];
  async execute(statements: readonly SqlStatement[]): Promise<void> {
    if (this.failures-- > 0) throw new Error("database unavailable");
    this.calls.push([...statements]);
  }
  async query<T extends object>(statement: SqlStatement): Promise<readonly T[]> {
    this.queries.push(statement);
    return this.rows as T[];
  }
}

const scenario = scenarioJson as Scenario;
const expires = Date.UTC(2027, 0, 1);

afterEach(() => vi.useRealTimers());

describe("persistence", () => {
  it("commits batches atomically and rolls back partial failures", async () => {
    const queries: string[] = [];
    let releaseCalls = 0;
    const client = { query: async (text: string) => {
      queries.push(text);
      if (text === "bad") throw new Error("constraint");
    }, release: () => { releaseCalls += 1; } };
    const executor = new PostgresPersistenceExecutor({
      connect: async () => client,
      query: async () => ({ rows: [] }),
    });
    await expect(executor.execute([{ text: "ok" }, { text: "bad" }])).rejects.toThrow("constraint");
    expect(queries).toEqual(["begin", "ok", "bad", "rollback"]);
    expect(releaseCalls).toBe(1);
  });

  it("buffers without blocking gameplay, retries in order, and flushes", async () => {
    const executor = new RecordingExecutor(); executor.failures = 2;
    const queue = new PersistenceWriteQueue(executor, { retryDelayMs: 0, sleep: async () => undefined });
    queue.enqueue([{ text: "first" }]); queue.enqueue([{ text: "second" }]);
    expect(queue.bufferedWrites).toBe(2);
    await queue.flush();
    expect(executor.calls.map((call) => call[0]?.text)).toEqual(["first", "second"]);
  });

  it("retries indefinitely with capped backoff and reports degradation then recovery", async () => {
    const executor = new RecordingExecutor(); executor.failures = 8;
    const delays: number[] = [];
    const health: PersistenceQueueHealthEvent[] = [];
    const queue = new PersistenceWriteQueue(executor, {
      retryDelayMs: 10, maxRetryDelayMs: 25, sustainedFailureThreshold: 3,
      sleep: async (delay) => { delays.push(delay); }, onHealthEvent: (event) => health.push(event),
    });
    queue.enqueue([{ text: "survives-outage" }]);
    await queue.flush();
    expect(delays).toEqual([10, 20, 25, 25, 25, 25, 25, 25]);
    expect(health.map((event) => event.status)).toEqual(["degraded", "recovered"]);
    expect(executor.calls[0]?.[0]?.text).toBe("survives-outage");
  });

  it("bounds the retry buffer and reports overflow without throwing from enqueue", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const health: PersistenceQueueHealthEvent[] = [];
    const executor: PersistenceExecutor = {
      execute: async () => blocked,
      query: async <T extends object>() => [] as T[],
    };
    const queue = new PersistenceWriteQueue(executor, { maxBufferedWrites: 2, onHealthEvent: (event) => health.push(event) });
    queue.enqueue([{ text: "one" }]);
    queue.enqueue([{ text: "two" }]);
    expect(() => queue.enqueue([{ text: "dropped" }])).not.toThrow();
    expect(queue.bufferedWrites).toBe(2);
    expect(health).toContainEqual({ status: "buffer-full", bufferedWrites: 2, droppedWrites: 1 });
    release();
    await queue.flush();
  });

  it("cancels permanent retry backoff and reports abandoned writes on shutdown timeout", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const health: PersistenceQueueHealthEvent[] = [];
    const executor: PersistenceExecutor = {
      execute: async () => { attempts += 1; throw new Error("offline"); },
      query: async <T extends object>() => [] as T[],
    };
    const queue = new PersistenceWriteQueue(executor, {
      retryDelayMs: 60_000,
      onHealthEvent: (event) => health.push(event),
    });
    queue.enqueue([{ text: "never-written" }]);
    const shutdown = queue.shutdown(10);
    await vi.advanceTimersByTimeAsync(10);
    const result = await shutdown;
    const attemptsAtShutdown = attempts;
    await Promise.resolve();
    await Promise.resolve();

    expect(result).toEqual({ timedOut: true, abandonedWrites: 1 });
    await expect(queue.shutdown(10)).resolves.toEqual(result);
    expect(queue.bufferedWrites).toBe(0);
    expect(attempts).toBe(attemptsAtShutdown);
    expect(health).toContainEqual({
      status: "stopped",
      bufferedWrites: 0,
      abandonedWrites: 1,
      reason: "shutdown-timeout",
    });
    expect(() => queue.enqueue([{ text: "after-stop" }])).not.toThrow();
    expect(queue.bufferedWrites).toBe(0);
    expect(health).toContainEqual({
      status: "stopped",
      bufferedWrites: 0,
      abandonedWrites: 1,
      reason: "enqueue-after-stop",
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("persists transition checkpoints and explicit recovery events", async () => {
    const executor = new RecordingExecutor();
    const persistence = new InstallationPersistence({ queue: new PersistenceWriteQueue(executor), installationId: "i", scenario, participantDataExpiresAt: expires });
    persistence.checkpoint({ kind: "recovery", reason: "crash-recovery", sessionId: "s", phaseId: "question-fixed", phaseEpoch: 3, startedAt: 10, deadlineAt: 20 });
    await persistence.flush();
    const texts = executor.calls.flat().map((statement) => statement.text);
    expect(texts.some((text) => text.includes("insert into checkpoints"))).toBe(true);
    expect(texts.some((text) => text.includes("'recovery'"))).toBe(true);
  });

  it("attributes the idle transition to the session that just ended", async () => {
    const executor = new RecordingExecutor();
    const persistence = new InstallationPersistence({ queue: new PersistenceWriteQueue(executor), installationId: "i", scenario, participantDataExpiresAt: expires });
    persistence.checkpoint({ kind: "transition", reason: "start", sessionId: "s", phaseId: "intro-video", phaseEpoch: 1, startedAt: 10, deadlineAt: 20 });
    persistence.checkpoint({ kind: "transition", reason: "complete", sessionId: "idle", phaseId: "idle", phaseEpoch: 4, startedAt: 30, deadlineAt: null });
    await persistence.flush();
    const sessionWrites = executor.calls.flat().filter((statement) => statement.text.includes("insert into sessions"));
    expect(sessionWrites.at(-1)?.values?.[0]).toBe("s");
    expect(sessionWrites.at(-1)?.values?.[3]).toBe("ended");
  });

  it("stores exactly final votes and a complete reproducible outcome", async () => {
    const executor = new RecordingExecutor();
    const persistence = new InstallationPersistence({ queue: new PersistenceWriteQueue(executor), installationId: "i", scenario, participantDataExpiresAt: expires });
    const snapshot: FinalVoteSnapshot = Object.freeze({ sessionId: "s", questionId: "question-fixed", phaseEpoch: 2, recordedAt: 200, votes: Object.freeze([
      Object.freeze({ sessionId: "s", questionId: "question-fixed", participantId: "p1", x: .8, y: .8, status: "valid", lastInputAt: 190, lastHeartbeatAt: 195, currentPhaseStartedAt: 100, currentPhaseDeadline: 200, recordedAt: 200 }),
      Object.freeze({ sessionId: "s", questionId: "question-fixed", participantId: "p2", x: null, y: null, status: "never-moved", lastInputAt: null, lastHeartbeatAt: 195, currentPhaseStartedAt: 100, currentPhaseDeadline: 200, recordedAt: 200 }),
    ]) });
    persistence.voteSnapshot(snapshot); await persistence.flush();
    const batch = executor.calls.flat();
    expect(batch.filter((statement) => statement.text.includes("insert into votes"))).toHaveLength(2);
    expect(batch.some((statement) => statement.text.toLowerCase().includes("cursor"))).toBe(false);
    const phaseWrite = batch.find((statement) => statement.text.includes("insert into session_phases"))!;
    const outcome = JSON.parse(phaseWrite.values![9] as string);
    expect(outcome).toMatchObject({ winner: "fixed", resolvedTarget: "question-quadrant", includedTotal: 1, excludedTotal: 1, boundaryConvention: expect.any(String) });
  });

  it("persists a canonical two-quadrant layout, active labels, counts, and boundary rule", async () => {
    const twoScenario = scenarioSchema.parse({
      version: "persist-two-y",
      entryPhaseId: "question-two",
      phases: [{ kind: "idle", id: "idle" }, {
        kind: "position-question",
        id: "question-two",
        text: "Top or bottom?",
        field: {
          type: "two-quadrant",
          axis: "y",
          labels: { minLabel: "Top", maxLabel: "Bottom" },
        },
        durationMs: 100,
        freezeMs: 0,
        connectionStaleAfterMs: 100,
        showLiveCounts: true,
        next: {
          type: "quadrant-plurality",
          map: { min: "idle", max: "idle" },
          tie: "idle",
          empty: "idle",
          countedStatuses: ["valid"],
        },
      }],
    });
    const executor = new RecordingExecutor();
    const persistence = new InstallationPersistence({
      queue: new PersistenceWriteQueue(executor),
      installationId: "i",
      scenario: twoScenario,
      participantDataExpiresAt: expires,
    });
    const snapshot: FinalVoteSnapshot = Object.freeze({
      sessionId: "s",
      questionId: "question-two",
      phaseEpoch: 3,
      recordedAt: 200,
      votes: Object.freeze([Object.freeze({
        sessionId: "s",
        questionId: "question-two",
        participantId: "p1",
        x: 0.12,
        y: 0.5,
        status: "valid",
        lastInputAt: 190,
        lastHeartbeatAt: 195,
        currentPhaseStartedAt: 100,
        currentPhaseDeadline: 200,
        recordedAt: 200,
      })]),
    });

    persistence.voteSnapshot(snapshot);
    await persistence.flush();
    const phaseWrite = executor.calls.flat().find((statement) => statement.text.includes("insert into session_phases"))!;
    expect(phaseWrite.values?.[7]).toBe("null");
    expect(JSON.parse(phaseWrite.values?.[8] as string)).toEqual({ minLabel: "Top", maxLabel: "Bottom" });
    expect(JSON.parse(phaseWrite.values?.[9] as string)).toMatchObject({
      layout: "two-quadrant",
      activeAxis: "y",
      field: {
        type: "two-quadrant",
        axis: "y",
        labels: { minLabel: "Top", maxLabel: "Bottom" },
      },
      quadrantCounts: { min: 0, max: 1 },
      winner: "max",
      resolvedTarget: "idle",
      includedTotal: 1,
      excludedTotal: 0,
      boundaryConvention: "y=0.5 belongs to the max/bottom quadrant",
    });
  });

  it("exposes testable participant deletion without leases, grants, IPs, or traces", async () => {
    const executor = new RecordingExecutor();
    const persistence = new InstallationPersistence({ queue: new PersistenceWriteQueue(executor), installationId: "i", scenario, participantDataExpiresAt: expires });
    executor.rows = [{ deletedCount: "3" }];
    await expect(persistence.deleteExpiredParticipantData(expires)).resolves.toBe(3);
    expect(executor.queries.at(-1)).toEqual({ text: `select delete_expired_participant_data($1) as "deletedCount"`, values: [new Date(expires).toISOString()] });
  });

  it("reconstructs session exports through the executor query after restart", async () => {
    const executor = new RecordingExecutor();
    executor.rows = [{
      sessionId: "s", questionId: "question-fixed", phaseEpoch: 2,
      outcome: { winner: "fixed" }, participantId: "p1", x: 0.8, y: 0.2,
      status: "valid", lastInputAt: "2026-07-12T10:00:00.000Z", recordedAt: "2026-07-12T10:00:01.000Z",
    }];
    const persistenceAfterRestart = new InstallationPersistence({ queue: new PersistenceWriteQueue(executor), installationId: "i", scenario, participantDataExpiresAt: expires });
    const exported = await persistenceAfterRestart.exportSession("s");
    expect(exported?.json).toEqual({ sessionId: "s", snapshots: [{
      sessionId: "s", questionId: "question-fixed", phaseEpoch: 2, outcome: { winner: "fixed" },
      votes: [{ participantId: "p1", x: 0.8, y: 0.2, status: "valid", lastInputAt: "2026-07-12T10:00:00.000Z", recordedAt: "2026-07-12T10:00:01.000Z" }],
    }] });
    expect(exported?.csv).toContain('"p1"');
    expect(await new InstallationPersistence({ queue: new PersistenceWriteQueue(new RecordingExecutor()), installationId: "i", scenario, participantDataExpiresAt: expires }).exportSession("missing")).toBeNull();
  });
});
