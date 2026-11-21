/**
 * The scene graph behind the cue sheet changes only when the server restarts
 * (publishing a show restarts it with the new scenario). Admin pages stay open
 * across restarts, so the graph is tied to the server boot it was loaded from.
 */

/** Two samples whose boot times differ by less than this belong to the same server run. */
export const SAME_BOOT_TOLERANCE_MS = 5_000;

/** When the server process started, from one status sample. */
export function serverBootAt(status: { uptimeMs: number; serverTime?: number }, receivedAt: number): number {
  return (status.serverTime ?? receivedAt) - status.uptimeMs;
}

/** True when there is no graph yet, or it was loaded before the server last restarted. */
export function flowNeedsReload(loadedBootAt: number | null, bootAt: number): boolean {
  return loadedBootAt === null || Math.abs(bootAt - loadedBootAt) > SAME_BOOT_TOLERANCE_MS;
}
