import { pathToFileURL } from "node:url";
import { loadConfig, type ServerConfig } from "./config.js";
import { buildServer, type ServerRuntime } from "./server.js";
import { loadPublishedScenarioFromPocketbase, loadScenarioReadiness } from "./readiness.js";
import { PocketBaseAdminDataSource } from "./persistence/admin-data.js";
import { PocketBaseClient } from "./persistence/pocketbase-client.js";
import { readServerConfigOverride } from "./persistence/installation-config.js";
import { syncMediaFromPocketbase } from "./persistence/media-sync.js";

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

/**
 * Boots one server instance: resolve the operator override, load the
 * published scenario, build the Fastify app, and start listening. Called
 * once at process start and again by `restart()` below every time
 * PocketBase reports a change, so it must be fully self-contained and
 * side-effect-free beyond what it returns.
 */
async function boot(config: ServerConfig, pocketbase: PocketBaseClient): Promise<ServerRuntime> {
  const override = await readServerConfigOverride(pocketbase)
    .catch((error: unknown) => {
      console.error("pocketbase: failed to load server config override", error);
      return null;
    });
  const effectiveConfig = {
    ...config,
    installationId: override?.installationId ?? config.installationId,
    roomId: override?.roomId ?? config.roomId,
  };
  const adminData = new PocketBaseAdminDataSource(pocketbase, {
    installationId: effectiveConfig.installationId,
    roomId: effectiveConfig.roomId,
  });
  // Mirror Studio's uploaded media down onto local disk before validating
  // the scenario against it -- readiness below stats mediaDir directly and
  // has no PocketBase awareness of its own. Missing/unreachable PocketBase
  // just means whatever's already on disk is used, same as before this
  // sync existed.
  await syncMediaFromPocketbase(pocketbase, effectiveConfig.mediaDir)
    .catch((error: unknown) => console.error("pocketbase: failed to sync media library", error));
  // PocketBase is the source of truth for published scenarios once Studio
  // publishes one; the local content/ JSON files remain the fallback so
  // dev/CI keep working against an empty PocketBase instance.
  const readiness = await loadPublishedScenarioFromPocketbase(pocketbase, effectiveConfig.mediaDir, override?.activeShowId)
    .catch((error: unknown) => {
      console.error("pocketbase: failed to load published scenario, falling back to local file", error);
      return null;
    }) ?? await loadScenarioReadiness(effectiveConfig);
  const runtime = await buildServer({ config: effectiveConfig, readiness, adminData, pocketbase });
  await listenWithCleanup(runtime.app, { host: config.host, port: config.port });
  return runtime;
}

export async function startServer(): Promise<void> {
  const config = loadConfig();
  const pocketbase = new PocketBaseClient(config);
  await pocketbase.ensureAuth().catch((error: unknown) => {
    console.error("pocketbase: failed initial auth", error);
  });

  let runtime = await boot(config, pocketbase);
  let restarting = false;
  let shuttingDown = false;

  // installationId/roomId/showId are baked into long-lived per-process
  // objects (PhaseEngine, AdmissionController, MovementRecorder) and
  // already-issued join tokens, so applying a change without a clean
  // restart would either do nothing or break active connections mid-show
  // -- see the installation_config migration. What used to require an
  // operator to notice and manually restart/redeploy is now automatic:
  // PocketBase's realtime feed (SSE) pushes a message the instant Studio
  // publishes a show, uploads media, or an operator changes the active
  // show/installation, and we react by rebooting in place (which re-runs
  // the media sync too) -- same restart, just triggered by PocketBase
  // instead of a human.
  const restart = (reason: string): void => {
    if (restarting || shuttingDown) return;
    restarting = true;
    void (async () => {
      try {
        runtime.app.log.info({ reason }, "pocketbase change detected, restarting server");
        await runtime.app.close();
        runtime = await boot(config, pocketbase);
      } catch (error) {
        console.error("restart: failed to reboot server after pocketbase change", error);
      } finally {
        restarting = false;
      }
    })();
  };
  await pocketbase.pb.collection("scenarios").subscribe("*", () => restart("scenarios"))
    .catch((error: unknown) => console.error("pocketbase: failed to subscribe to scenarios", error));
  await pocketbase.pb.collection("installation_config").subscribe("*", () => restart("installation_config"))
    .catch((error: unknown) => console.error("pocketbase: failed to subscribe to installation_config", error));
  await pocketbase.pb.collection("media").subscribe("*", () => restart("media"))
    .catch((error: unknown) => console.error("pocketbase: failed to subscribe to media", error));

  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    runtime.app.log.info({ signal }, "shutting down");
    await pocketbase.pb.collection("scenarios").unsubscribe().catch(() => {});
    await pocketbase.pb.collection("installation_config").unsubscribe().catch(() => {});
    await pocketbase.pb.collection("media").unsubscribe().catch(() => {});
    await runtime.app.close();
  };
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
