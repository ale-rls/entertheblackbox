import { PROTOCOL_VERSION, type DisplayToServerMessage } from "@smartphonecracy/protocol";

/**
 * apps/server issues a QR grant once, at display_join -- refreshing it
 * again is entirely request-driven (qr_grant_request), and until this
 * loop existed nothing on the display side ever sent one. Grants expire
 * after joinGrantTtlMs (DEFAULT_INSTALLATION_POLICY, 2 minutes): any
 * display connection older than that showed an already-expired, or
 * already-hidden (shouldShowGrant), code for the rest of its lifetime.
 * The server decides whether a request actually yields a fresh grant
 * (e.g. it may withhold one mid-question) -- this loop just needs to
 * keep asking well before the current one lapses.
 */

const DEFAULT_INTERVAL_MS = 60_000;

export type QrGrantRefreshOptions = {
  /** Whether the socket is currently open; requests are skipped otherwise. */
  isOpen: () => boolean;
  send: (message: DisplayToServerMessage) => void;
  intervalMs?: number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
};

/** Starts the QR grant refresh loop. Returns a dispose function. */
export function startQrGrantRefresh(options: QrGrantRefreshOptions): () => void {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const schedule = options.setIntervalFn ?? setInterval;
  const cancel = options.clearIntervalFn ?? clearInterval;

  const tick = () => {
    if (!options.isOpen()) return;
    options.send({ t: "qr_grant_request", v: PROTOCOL_VERSION });
  };

  const timer = schedule(tick, intervalMs);
  return () => cancel(timer);
}
