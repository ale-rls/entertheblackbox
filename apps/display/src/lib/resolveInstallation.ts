/**
 * When the display is opened without ?installation=/&room= (the venue's
 * one kiosk shouldn't need to remember/type the full URL every time,
 * since a server only ever runs one show at a time), fetch them from the
 * server's own public /api/status and patch them into the URL so
 * App.tsx's module-level config -- which reads location.search directly
 * -- picks them up. The caller (main.tsx) must do this before importing
 * App.js: a static import would evaluate that module-level config too
 * early to see the patch.
 */

export type StatusSnapshot = { installationId?: string; roomId?: string } | null;

export type InstallationParamsSource = {
  location: Pick<Location, "search" | "pathname" | "hash">;
  fetchStatus: () => Promise<StatusSnapshot>;
  replaceUrl: (url: string) => void;
};

export async function resolveInstallationParams(source: InstallationParamsSource): Promise<void> {
  const params = new URLSearchParams(source.location.search);
  if (params.has("installation") && params.has("room")) return;

  const status = await source.fetchStatus();
  if (!status?.installationId || !status.roomId) return;

  if (!params.has("installation")) params.set("installation", status.installationId);
  if (!params.has("room")) params.set("room", status.roomId);
  source.replaceUrl(`${source.location.pathname}?${params.toString()}${source.location.hash}`);
}

export async function resolveInstallationParamsFromWindow(): Promise<void> {
  await resolveInstallationParams({
    location,
    fetchStatus: async () => {
      try {
        const response = await fetch("/api/status");
        if (!response.ok) return null;
        return await response.json() as StatusSnapshot;
      } catch {
        return null;
      }
    },
    replaceUrl: (url) => history.replaceState(null, "", url),
  });
}
