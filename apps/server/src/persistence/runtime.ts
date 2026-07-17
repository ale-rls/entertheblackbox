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
  log?: (event: PersistenceQueueHealthEvent) => void;
  now?: () => number;
};

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
    let closePromise: Promise<void> | null = null;
    return {
      persistence,
      close: () => {
        closePromise ??= (async () => {
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
