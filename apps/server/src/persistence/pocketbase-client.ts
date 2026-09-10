import { EventSource, type EventSourceInit, type FetchLike } from "eventsource";
import PocketBase from "pocketbase";
import type { ServerConfig } from "../config.js";

// PocketBase's realtime subscriptions (index.ts's auto-restart-on-publish)
// need a global EventSource, which only exists in browsers -- Node has no
// built-in implementation. The production reverse proxy compresses SSE
// responses when Node advertises gzip support. Because an SSE response never
// ends, Node's fetch waits forever for that gzip stream to finish and the
// PocketBase SDK never receives PB_CONNECT. Force identity encoding so each
// event is delivered immediately instead of being trapped in the compressor.
export const pocketBaseRealtimeFetch: FetchLike = (url, init) => {
  const headers = new Headers(init.headers);
  headers.set("Accept-Encoding", "identity");
  return fetch(url, { ...init, headers });
};

export class PocketBaseEventSource extends EventSource {
  constructor(url: string | URL, init?: EventSourceInit) {
    super(url, { ...init, fetch: pocketBaseRealtimeFetch });
  }
}

// Importing this module installs the configured polyfill before anything can
// call .subscribe().
if (typeof globalThis.EventSource === "undefined") {
  (globalThis as unknown as { EventSource: typeof EventSource }).EventSource = PocketBaseEventSource;
}

/**
 * Superuser-authenticated PocketBase client for server-side persistence.
 * The auth token is short-lived, so every write/read path calls
 * `ensureAuth()` first instead of authenticating once at startup.
 */
export class PocketBaseClient {
  readonly pb: PocketBase;
  private readonly email: string;
  private readonly password: string;
  private authPromise: Promise<void> | null = null;

  constructor(config: Pick<ServerConfig, "pocketbase">) {
    this.pb = new PocketBase(config.pocketbase.url);
    this.email = config.pocketbase.adminEmail;
    this.password = config.pocketbase.adminPassword;
  }

  async ensureAuth(): Promise<void> {
    if (this.pb.authStore.isValid) return;
    this.authPromise ??= this.pb.collection("_superusers")
      .authWithPassword(this.email, this.password)
      .then(() => undefined)
      .finally(() => {
        this.authPromise = null;
      });
    await this.authPromise;
  }
}
