import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";
import { loadScenarioReadiness } from "./readiness.js";
import { createPersistenceRuntime, type PersistenceRuntimeEvent } from "./persistence/index.js";

export * from "./config.js";
export * from "./readiness.js";
export * from "./server.js";
export * from "./admission/index.js";
export * from "./engine/phase-engine.js";
export * from "./persistence/index.js";

type ListeningApp = {
  listen(options: { host: string; port: number }): Promise<unknown>;
  close(): Promise<unknown>;
};

export async function listenWithCleanup(
  app: ListeningApp,
  persistenceRuntime: Pick<NonNullable<Awaited<ReturnType<typeof createPersistenceRuntime>>>, "close"> | null,
  options: { host: string; port: number },
): Promise<void> {
  try {
    await app.listen(options);
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    try {
      await app.close();
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    } finally {
      try {
        await persistenceRuntime?.close();
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    if (cleanupErrors.length > 0) throw new AggregateError([error, ...cleanupErrors], "server listen and cleanup failed");
    throw error;
  }
}

export async function startServer(): Promise<void> {
  const config = loadConfig();
  const readiness = await loadScenarioReadiness(config);
  const persistenceRuntime = readiness.ready
    ? await createPersistenceRuntime(config, readiness.scenario, {
        log: (event: PersistenceRuntimeEvent) => console.error(JSON.stringify({ component: "persistence", ...event })),
      })
    : null;
  const { app, engine } = await buildServer({
    config,
    readiness,
    ...(persistenceRuntime === null ? {} : { persistence: persistenceRuntime.persistence }),
  });
  engine?.recoverAfterCrash();
  let shutdownPromise: Promise<void> | null = null;
  const shutdown = async (signal: NodeJS.Signals) => {
    shutdownPromise ??= (async () => {
      app.log.info({ signal }, "shutting down");
      try {
        await app.close();
      } finally {
        await persistenceRuntime?.close();
      }
    })();
    return shutdownPromise;
  };
  await listenWithCleanup(app, persistenceRuntime, { host: config.host, port: config.port });
  const handleSignal = (signal: NodeJS.Signals) => {
    void shutdown(signal).catch((error: unknown) => {
      console.error("server shutdown failed", error);
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", () => handleSignal("SIGINT"));
  process.once("SIGTERM", () => handleSignal("SIGTERM"));
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  startServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
