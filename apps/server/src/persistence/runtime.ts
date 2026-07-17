import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import type { Scenario } from "@smartphonecracy/scenario";
import type { ServerConfig } from "../config.js";
import { InstallationPersistence } from "./persistence.js";
import { PostgresPersistenceExecutor, type PostgresConnectionPool } from "./postgres-executor.js";
import { PersistenceWriteQueue, type PersistenceQueueHealthEvent } from "./write-queue.js";

const migrationPath = fileURLToPath(new URL("../../../../infra/migrations/001_persistence.sql", import.meta.url));

type PoolLike = PostgresConnectionPool & {
  end(): Promise<void>;
};

export type PersistenceRuntime = {
  persistence: InstallationPersistence;
  close(): Promise<void>;
};

export type PersistenceRuntimeDependencies = {
  createPool?: (connectionString: string) => PoolLike;
  readMigration?: () => Promise<string>;
  log?: (event: PersistenceRuntimeEvent) => void;
  now?: () => number;
  retentionCleanupIntervalMs?: number;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
};

export type RetentionCleanupEvent =
  | { status: "retention-cleanup-succeeded"; cutoff: string; deletedRows: number }
  | { status: "retention-cleanup-failed"; cutoff: string; error: { name: string; message: string } };

export type PersistenceRuntimeEvent = PersistenceQueueHealthEvent | RetentionCleanupEvent;

const DAY_MS = 86_400_000;

function errorDetails(error: unknown): { name: string; message: string } {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: "Error", message: String(error) };
}

export async function createPersistenceRuntime(
  config: ServerConfig,
  scenario: Scenario,
  dependencies: PersistenceRuntimeDependencies = {},
): Promise<PersistenceRuntime | null> {
  if (config.databaseUrl === undefined) return null;
  if (config.participantDataExpiresAt === undefined) {
    throw new Error("participant data expiry is required with persistence");
  }

  const pool = dependencies.createPool?.(config.databaseUrl) ?? new Pool({ connectionString: config.databaseUrl });
  try {
    const migration = await (dependencies.readMigration?.() ?? readFile(migrationPath, "utf8"));
    await pool.query(migration);
    const executor = new PostgresPersistenceExecutor(pool);
    let persistence: InstallationPersistence | undefined;
    const queue = new PersistenceWriteQueue(executor, {
      onHealthEvent: (event) => {
        dependencies.log?.(event);
        // A full queue cannot persist its own overflow event without recursively
        // producing another overflow. Degraded/recovered events are queued and
        // become durable when the database is writable again.
        if (event.status !== "buffer-full" && event.status !== "stopped") {
          persistence?.recordHealthEvent(event, dependencies.now?.() ?? Date.now());
        }
      },
    });
    persistence = new InstallationPersistence({
      queue,
      installationId: config.installationId,
      scenario,
      participantDataExpiresAt: config.participantDataExpiresAt,
    });
    await persistence.flush();
    await persistence.recoverAfterCrash(dependencies.now?.() ?? Date.now());
    await persistence.flush();
    const now = dependencies.now ?? Date.now;
    const schedule = dependencies.setTimeout ?? setTimeout;
    const cancel = dependencies.clearTimeout ?? clearTimeout;
    const cleanupIntervalMs = dependencies.retentionCleanupIntervalMs ?? DAY_MS;
    let cleanupTimer: ReturnType<typeof setTimeout> | null = null;
    let cleanupPromise: Promise<void> | null = null;
    let closed = false;
    const emit = (event: PersistenceRuntimeEvent): void => {
      try { dependencies.log?.(event); } catch { /* observability must not stop cleanup or startup */ }
    };

    const runRetentionCleanup = async (): Promise<void> => {
      const cutoff = now();
      const cutoffIso = new Date(cutoff).toISOString();
      try {
        const deletedRows = await persistence.deleteExpiredParticipantData(cutoff);
        emit({ status: "retention-cleanup-succeeded", cutoff: cutoffIso, deletedRows });
      } catch (error) {
        emit({ status: "retention-cleanup-failed", cutoff: cutoffIso, error: errorDetails(error) });
      }
    };

    const scheduleNextCleanup = (): void => {
      if (closed) return;
      cleanupTimer = schedule(() => {
        cleanupTimer = null;
        cleanupPromise = runRetentionCleanup().finally(() => {
          cleanupPromise = null;
          scheduleNextCleanup();
        });
      }, cleanupIntervalMs);
      cleanupTimer.unref?.();
    };

    // Run once on every successful persistence boot, then schedule from the
    // completion of each run so a slow database can never overlap cleanups.
    await runRetentionCleanup();
    scheduleNextCleanup();
    let closePromise: Promise<void> | null = null;
    return {
      persistence,
      close: () => {
        closePromise ??= (async () => {
          closed = true;
          if (cleanupTimer !== null) {
            cancel(cleanupTimer);
            cleanupTimer = null;
          }
          await cleanupPromise;
          await pool.end();
        })();
        return closePromise;
      },
    };
  } catch (error) {
    await pool.end();
    throw error;
  }
}
