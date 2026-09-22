import { runtimeApi } from "@entertheblackbox/protocol";
/**
 * A server only ever runs one show, so the venue's one kiosk shouldn't need
 * a query string at all: it fetches its installationId/roomId from the
 * server's own public /api/status and stores them here for App.tsx's
 * module-level config to read. The caller (main.tsx) must await this
 * before importing App.js: a static import would evaluate that
 * module-level config too early to see the resolved values.
 */

export type StatusSnapshot = { installationId?: string; roomId?: string } | null;

export type Installation = { installationId: string; roomId: string };

const DEFAULT_INSTALLATION: Installation = { installationId: "inst-1", roomId: "room-1" };

let resolved: Installation = DEFAULT_INSTALLATION;

/** Read by App.tsx's module-level config; reflects the last successful resolve() call, or the default. */
export function currentInstallation(): Installation {
  return resolved;
}

export async function resolveInstallation(fetchStatus: () => Promise<StatusSnapshot>): Promise<void> {
  const status = await fetchStatus();
  if (!status?.installationId || !status.roomId) return;
  resolved = { installationId: status.installationId, roomId: status.roomId };
}

export async function resolveInstallationFromWindow(): Promise<void> {
  await resolveInstallation(async () => {
    try {
      const response = await fetch(runtimeApi("/api/status"));
      if (!response.ok) return null;
      return await response.json() as StatusSnapshot;
    } catch {
      return null;
    }
  });
}
