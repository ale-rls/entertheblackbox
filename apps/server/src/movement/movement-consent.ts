export const MOVEMENT_CONSENT_TIMEOUT_MS = 60_000;

export type MovementConsentDataSource = {
  deleteMovementRecordings(sessionId: string, participantId: string): Promise<void>;
};

export type MovementConsentResult = "accepted" | "conflict" | "not-found";

type ConsentState = "collecting" | "pending" | "deleting" | "granted" | "deleted";
type ConsentEntry = {
  state: ConsentState;
  timer: ReturnType<typeof setTimeout> | null;
};

const keyFor = (sessionId: string, participantId: string): string =>
  `${sessionId}\u0000${participantId}`;

/**
 * Keeps consent deadlines on the server, so cursor data is removed after one
 * minute even if a phone is backgrounded, loses its connection, or closes the
 * page without answering the end-of-show prompt.
 */
export class MovementConsentManager {
  private readonly entries = new Map<string, ConsentEntry>();
  private readonly timeoutMs: number;

  constructor(
    private readonly data: MovementConsentDataSource,
    options: { timeoutMs?: number; onError?: (error: unknown) => void } = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? MOVEMENT_CONSENT_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1) {
      throw new Error("movement consent timeout must be a positive integer");
    }
    this.onError = options.onError ?? ((error) => console.error("failed to delete unconsented movement recording", error));
  }

  private readonly onError: (error: unknown) => void;

  track(sessionId: string, participantId: string): void {
    const key = keyFor(sessionId, participantId);
    if (!this.entries.has(key)) this.entries.set(key, { state: "collecting", timer: null });
  }

  endSession(sessionId: string): void {
    for (const [key, entry] of this.entries) {
      if (!key.startsWith(`${sessionId}\u0000`) || entry.state !== "collecting") continue;
      const participantId = key.slice(sessionId.length + 1);
      entry.state = "pending";
      this.scheduleDeletion(entry, sessionId, participantId, this.timeoutMs);
    }
  }

  async respond(sessionId: string, participantId: string, granted: boolean): Promise<MovementConsentResult> {
    const entry = this.entries.get(keyFor(sessionId, participantId));
    if (entry === undefined || entry.state === "collecting") return "not-found";
    if (entry.state === "granted") return granted ? "accepted" : "conflict";
    if (entry.state === "deleted") return granted ? "conflict" : "accepted";
    if (entry.state === "deleting") return granted ? "conflict" : "accepted";

    if (granted) {
      if (entry.timer !== null) clearTimeout(entry.timer);
      entry.timer = null;
      entry.state = "granted";
      return "accepted";
    }

    await this.deleteEntry(entry, sessionId, participantId);
    return "accepted";
  }

  stop(): void {
    for (const entry of this.entries.values()) {
      if (entry.timer !== null) clearTimeout(entry.timer);
      entry.timer = null;
    }
  }

  private scheduleDeletion(
    entry: ConsentEntry,
    sessionId: string,
    participantId: string,
    delayMs: number,
  ): void {
    entry.timer = setTimeout(() => {
      entry.timer = null;
      void this.deleteEntry(entry, sessionId, participantId).catch(this.onError);
    }, delayMs);
    entry.timer.unref?.();
  }

  private async deleteEntry(entry: ConsentEntry, sessionId: string, participantId: string): Promise<void> {
    if (entry.state !== "pending") return;
    if (entry.timer !== null) clearTimeout(entry.timer);
    entry.timer = null;
    entry.state = "deleting";
    try {
      await this.data.deleteMovementRecordings(sessionId, participantId);
      entry.state = "deleted";
    } catch (error) {
      entry.state = "pending";
      // A transient PocketBase failure must not turn silence into consent.
      this.scheduleDeletion(entry, sessionId, participantId, Math.min(5_000, this.timeoutMs));
      throw error;
    }
  }
}
