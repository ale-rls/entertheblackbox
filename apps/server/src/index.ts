import { pathToFileURL } from "node:url";
import { loadConfig, type ServerConfig } from "./config.js";
import { buildServer, type ServerRuntime } from "./server.js";
import { loadPublishedScenarioFromPocketbase, type ScenarioReadiness } from "./readiness.js";
import { PocketBaseAdminDataSource } from "./persistence/admin-data.js";
import { PocketBaseClient } from "./persistence/pocketbase-client.js";
import { readServerConfigOverride } from "./persistence/installation-config.js";
import { syncMediaFromPocketbase } from "./persistence/media-sync.js";
import { loadGhostPool } from "./persistence/ghost-pool-loader.js";
import { readLobbyStartTimes } from "./persistence/lobby-config.js";

export * from "./config.js";
export * from "./readiness.js";
export * from "./server.js";
export * from "./admission/index.js";
export * from "./engine/phase-engine.js";
export * from "./movement/index.js";
export * from "./ghosts/index.js";
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
 * Boots one server instance: resolve the active-show override, load the
 * published scenario, build the Fastify app, and start listening. Called
 * once at process start and again by `restart()` below every time
 * PocketBase reports a change, so it must be fully self-contained and
 * side-effect-free beyond what it returns.
 */
async function boot(
  config: ServerConfig,
  pocketbase: PocketBaseClient,
  onSessionEnded?: () => void,
): Promise<ServerRuntime> {
  const override = await readServerConfigOverride(pocketbase)
    .catch((error: unknown) => {
      console.error("pocketbase: failed to load server config override", error);
      return null;
    });
  const adminData = new PocketBaseAdminDataSource(pocketbase, {
    installationId: config.installationId,
    roomId: config.roomId,
  });
  // Mirror Studio's uploaded media down onto local disk before validating
  // the scenario against it -- readiness below stats mediaDir directly and
  // has no PocketBase awareness of its own. Missing/unreachable PocketBase
  // just means whatever's already on disk is used, same as before this
  // sync existed.
  await syncMediaFromPocketbase(pocketbase, config.mediaDir)
    .catch((error: unknown) => console.error("pocketbase: failed to sync media library", error));
  // PocketBase is the source of truth for published scenarios. Nothing
  // published (or PocketBase being unreachable) must surface as a visibly
  // not-ready server -- readiness.ready === false already makes every
  // route 503 and skips building a PhaseEngine (server.ts), so the display
  // sits on its own "preparing media" screen -- rather than silently
  // running local content/scenarios/dev.json's placeholder show live. To
  // preview locally, publish something first (e.g.
  // `tsx scripts/publish-scenario-to-pocketbase.ts content/scenarios/dev.json`).
  const readiness: ScenarioReadiness = await loadPublishedScenarioFromPocketbase(
    pocketbase, config.mediaDir, override?.activeShowId,
  ).catch((error: unknown): ScenarioReadiness => {
    console.error("pocketbase: failed to load published scenario", error);
    return {
      ready: false,
      scenario: null,
      errors: [`pocketbase unreachable: ${error instanceof Error ? error.message : String(error)}`],
      warnings: [],
    };
  }) ?? {
    ready: false,
    scenario: null,
    errors: [
      override?.activeShowId
        ? `no published show found for active show id "${override.activeShowId}"`
        : "no show has been published to PocketBase yet",
    ],
    warnings: [],
  };
  // Past completed recordings for this showId, replayed as ghost cursors
  // (apps/server/src/ghosts) -- refreshed on every boot, so it naturally
  // stays in sync with whichever restart() below already triggers; there's
  // no separate subscription for movement_recordings/_batches.
  const ghostPool = readiness.ready
    ? await loadGhostPool(pocketbase, readiness.showId, readiness.scenario.version)
      .catch((error: unknown) => {
        console.error("pocketbase: failed to load ghost pool", error);
        return { tracks: [] };
      })
    : { tracks: [] };
  const scheduledStartTimes = await readLobbyStartTimes(pocketbase)
    .catch((error: unknown) => {
      console.error("pocketbase: failed to load lobby schedule", error);
      return [];
    });
  const runtime = await buildServer({
    config, readiness, adminData, pocketbase, ghostPool, scheduledStartTimes,
    ...(onSessionEnded === undefined ? {} : { onSessionEnded }),
    ...(override?.targetAudienceSize === undefined ? {} : { targetAudienceSizeOverride: override.targetAudienceSize }),
  });
  await listenWithCleanup(runtime.app, { host: config.host, port: config.port });
  return runtime;
}

/**
 * Subscribes to a PocketBase collection's realtime feed, retrying with
 * capped exponential backoff if the initial connect fails. Without this,
 * a single transient failure (observed in production: PocketBase's
 * EventSource-based realtime connect timing out) permanently disables
 * auto-restart-on-publish for the rest of the process's life -- the SDK
 * itself only reconnects a connection that dropped *after* successfully
 * opening, not one that never opened in the first place.
 */
export function subscribeWithRetry(
  pocketbase: PocketBaseClient,
  collection: string,
  onChange: () => void,
  isStopped: () => boolean,
  maxDelayMs = 30_000,
): void {
  let attempt = 0;
  const attemptSubscribe = (): void => {
    if (isStopped()) return;
    pocketbase.pb.collection(collection).subscribe("*", onChange)
      .then(() => { attempt = 0; })
      .catch((error: unknown) => {
        if (isStopped()) return;
        const delayMs = Math.min(maxDelayMs, 1000 * 2 ** attempt);
        attempt += 1;
        console.error(
          `pocketbase: failed to subscribe to ${collection}, retrying in ${delayMs}ms`,
          error,
        );
        setTimeout(attemptSubscribe, delayMs);
      });
  };
  attemptSubscribe();
}

export const DEFAULT_RESTART_SETTLE_DELAY_MS = 500;

/**
 * Debounce PocketBase change notifications before replacing the HTTP server.
 *
 * PocketBase can publish a realtime collection event before the HTTP request
 * which created the record has finished returning. Studio creates a scenarios
 * record through this same server, so restarting immediately from that event
 * can disconnect the in-flight /api/admin/publish response and make the
 * reverse proxy report a 502 even though PocketBase saved the show. Waiting
 * for a short quiet period lets that response flush, coalesces related events,
 * and retains one follow-up restart when another event arrives during a boot.
 */
export function createRestartScheduler(
  restart: (reason: string) => Promise<void>,
  isStopped: () => boolean,
  settleDelayMs = DEFAULT_RESTART_SETTLE_DELAY_MS,
): { schedule: (reason: string) => void; stop: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  const pendingReasons = new Set<string>();

  const scheduleTimer = () => {
    if (timer !== null || running || isStopped()) return;
    timer = setTimeout(() => {
      timer = null;
      if (isStopped()) {
        pendingReasons.clear();
        return;
      }
      const reason = [...pendingReasons].join(", ");
      pendingReasons.clear();
      running = true;
      const finished = () => {
        running = false;
        if (pendingReasons.size > 0) scheduleTimer();
      };
      void restart(reason).then(finished, finished);
    }, settleDelayMs);
  };

  return {
    schedule(reason) {
      if (isStopped()) return;
      pendingReasons.add(reason);
      if (timer !== null) clearTimeout(timer);
      timer = null;
      scheduleTimer();
    },
    stop() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pendingReasons.clear();
    },
  };
}

/**
 * Holds content/config reloads while a show is active, then releases one
 * coalesced reload as soon as the engine reports that the session ended.
 */
export function createActiveShowRestartGate(
  schedule: (reason: string) => void,
  isShowActive: () => boolean,
): { request: (reason: string) => void; flush: () => void } {
  const deferredReasons = new Set<string>();
  return {
    request(reason) {
      if (isShowActive()) {
        deferredReasons.add(reason);
        return;
      }
      schedule(reason);
    },
    flush() {
      if (isShowActive() || deferredReasons.size === 0) return;
      const reason = [...deferredReasons].join(", ");
      deferredReasons.clear();
      schedule(reason);
    },
  };
}

export async function startServer(): Promise<void> {
  const config = loadConfig();
  const pocketbase = new PocketBaseClient(config);
  await pocketbase.ensureAuth().catch((error: unknown) => {
    console.error("pocketbase: failed initial auth", error);
  });

  let flushDeferredRestart = () => {};
  let runtime = await boot(config, pocketbase, () => flushDeferredRestart());
  let restarting = false;
  let shuttingDown = false;

  // The active showId is baked into long-lived per-process objects
  // (PhaseEngine, AdmissionController, MovementRecorder) and already-issued
  // join tokens, so applying a change without a clean restart would either
  // do nothing or break active connections mid-show -- see the
  // installation_config migration. What used to require an operator to
  // notice and manually restart/redeploy is now automatic: PocketBase's
  // realtime feed (SSE) pushes a message the instant Studio publishes a
  // show, uploads media, or an operator changes the active show. Idle and
  // lobby installations reboot after the short settle delay; active shows
  // keep their in-memory engine and defer one coalesced reboot until their
  // session ends, so authoring cannot interrupt playback.
  let requestRestart = (_reason: string) => {};
  const restart = async (reason: string): Promise<void> => {
    if (restarting || shuttingDown) return;
    // The show may have started during the scheduler's settle delay. Check
    // again at execution time so that race cannot interrupt a new session.
    if (runtime.engine?.lifecycleState === "active") {
      requestRestart(reason);
      return;
    }
    restarting = true;
    try {
      runtime.app.log.info({ reason }, "pocketbase change detected, restarting server");
      await runtime.app.close();
      runtime = await boot(config, pocketbase, () => flushDeferredRestart());
    } catch (error) {
      console.error("restart: failed to reboot server after pocketbase change", error);
    } finally {
      restarting = false;
    }
  };
  const isStopped = () => shuttingDown;
  const restarts = createRestartScheduler(restart, isStopped);
  const restartGate = createActiveShowRestartGate(
    (reason) => restarts.schedule(reason),
    () => runtime.engine?.lifecycleState === "active",
  );
  requestRestart = restartGate.request;
  flushDeferredRestart = restartGate.flush;
  subscribeWithRetry(pocketbase, "scenarios", () => restartGate.request("scenarios"), isStopped);
  subscribeWithRetry(pocketbase, "installation_config", () => restartGate.request("installation_config"), isStopped);
  subscribeWithRetry(pocketbase, "media", () => restartGate.request("media"), isStopped);

  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    restarts.stop();
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
