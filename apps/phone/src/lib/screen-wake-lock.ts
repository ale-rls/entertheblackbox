import { useEffect } from "react";

type WakeLockNavigator = { wakeLock?: Pick<WakeLock, "request"> };
type VisibilityDocument = Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;

/**
 * Keeps the phone's screen on while a show runs. A locked phone suspends the
 * page: its cursor drops off the gauze and its socket closes until the
 * person unlocks it. Browsers release the lock whenever the page is hidden,
 * so it is requested again each time the page becomes visible. Browsers
 * without the Screen Wake Lock API simply keep their usual timeout.
 */
export function createScreenWakeLock(nav: WakeLockNavigator, doc: VisibilityDocument) {
  let active = false;
  let sentinel: WakeLockSentinel | null = null;
  let pending = false;

  const acquire = () => {
    if (!active || pending || nav.wakeLock === undefined || doc.visibilityState !== "visible") return;
    if (sentinel !== null && !sentinel.released) return;
    pending = true;
    nav.wakeLock.request("screen").then((lock) => {
      pending = false;
      if (active) sentinel = lock;
      else void lock.release().catch(() => {});
    }, () => {
      // Refused (battery saver, not visible, unsupported): the screen just times out as usual.
      pending = false;
    });
  };
  const release = () => {
    const lock = sentinel;
    sentinel = null;
    if (lock !== null && !lock.released) void lock.release().catch(() => {});
  };

  doc.addEventListener("visibilitychange", acquire);
  return {
    setActive(next: boolean): void {
      active = next;
      if (next) acquire();
      else release();
    },
    dispose(): void {
      active = false;
      doc.removeEventListener("visibilitychange", acquire);
      release();
    },
  };
}

export function useScreenWakeLock(active: boolean): void {
  useEffect(() => {
    const lock = createScreenWakeLock(navigator as WakeLockNavigator, document);
    lock.setActive(active);
    return () => lock.dispose();
  }, [active]);
}
