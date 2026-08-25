import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";
import { loadPublishedScenarioFromPocketbase, loadScenarioReadiness } from "./readiness.js";
import { PocketBaseAdminDataSource } from "./persistence/admin-data.js";
import { PocketBaseClient } from "./persistence/pocketbase-client.js";

export * from "./config.js";
export * from "./readiness.js";
export * from "./server.js";
export * from "./admission/index.js";
export * from "./engine/phase-engine.js";
export * from "./movement/index.js";
export * from "./persistence/admin-data.js";
export * from "./persistence/pocketbase-client.js";

type ListeningApp = {
  listen(options: { host: string; port: number }): Promise<unknown>;
  close(): Promise<unknown>;
};

export async function listenWithCleanup(
  app: ListeningApp,
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
    }
    if (cleanupErrors.length > 0) throw new AggregateError([error, ...cleanupErrors], "server listen and cleanup failed");
    throw error;
  }
}

export async function startServer(): Promise<void> {
  const config = loadConfig();
  const pocketbase = new PocketBaseClient(config);
  const adminData = new PocketBaseAdminDataSource(pocketbase, {
    installationId: config.installationId,
    roomId: config.roomId,
  });
  // PocketBase is the source of truth for published scenarios once Studio
  // publishes one; the local content/ JSON files remain the fallback so
  // dev/CI keep working against an empty PocketBase instance.
  const readiness = await loadPublishedScenarioFromPocketbase(pocketbase, config.mediaDir)
    .catch((error: unknown) => {
      console.error("pocketbase: failed to load published scenario, falling back to local file", error);
      return null;
    }) ?? await loadScenarioReadiness(config);
  const { app } = await buildServer({ config, readiness, adminData });
  let shutdownPromise: Promise<void> | null = null;
  const shutdown = async (signal: NodeJS.Signals) => {
    shutdownPromise ??= (async () => {
      app.log.info({ signal }, "shutting down");
      await app.close();
    })();
    return shutdownPromise;
  };
  await listenWithCleanup(app, { host: config.host, port: config.port });
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
