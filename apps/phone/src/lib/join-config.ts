export type JoinConfig = { installationId: string; roomId: string };

const RETRY_BASE_MS = 1_000;
const RETRY_CAP_MS = 8_000;

/**
 * Loads the join settings, retrying until it succeeds or is cancelled. The
 * page fetches them once on load, and that is exactly when a whole audience
 * scans the QR at once on busy venue Wi-Fi: a single failure must not leave
 * Join disabled until the person thinks to reload.
 */
export async function loadJoinConfig(options: {
  load: () => Promise<JoinConfig>;
  cancelled: () => boolean;
  onError: (message: string) => void;
  wait?: (ms: number) => Promise<void>;
}): Promise<JoinConfig | null> {
  const wait = options.wait ?? waitOrOnline;
  for (let attempt = 0; !options.cancelled(); attempt += 1) {
    try {
      return await options.load();
    } catch (error) {
      if (options.cancelled()) return null;
      const reason = error instanceof Error ? error.message : "Join service unavailable";
      options.onError(`${reason} — retrying…`);
      await wait(Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** attempt));
    }
  }
  return null;
}

export async function fetchJoinConfig(url: string): Promise<JoinConfig> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Join service unavailable (${response.status})`);
  return await response.json() as JoinConfig;
}

/** Waits for the delay, or less if the browser reports the network is back. */
function waitOrOnline(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      window.removeEventListener("online", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    window.addEventListener("online", done);
  });
}
