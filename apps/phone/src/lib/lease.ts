/**
 * Participant lease storage (plan §10): one signed, installation-scoped
 * lease in localStorage so ordinary tabs share one participant and one
 * projected cursor. The key is installation-scoped so a lease from one
 * installation is never sent to another.
 */

const keyFor = (installationId: string) =>
  `entertheblackbox:lease:${installationId}`;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function loadLease(
  installationId: string,
  storage: StorageLike = localStorage,
): string | null {
  try {
    return storage.getItem(keyFor(installationId));
  } catch {
    return null; // storage disabled (private mode etc.) — join as new
  }
}

export function storeLease(
  installationId: string,
  lease: string,
  storage: StorageLike = localStorage,
): void {
  try {
    storage.setItem(keyFor(installationId), lease);
  } catch {
    // Non-fatal: the participant just becomes a new voter next visit.
  }
}

export function clearLease(
  installationId: string,
  storage: StorageLike = localStorage,
): void {
  try {
    storage.removeItem(keyFor(installationId));
  } catch {
    // ignore
  }
}
