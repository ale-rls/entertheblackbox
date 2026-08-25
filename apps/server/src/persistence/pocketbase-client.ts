import PocketBase from "pocketbase";
import type { ServerConfig } from "../config.js";

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
