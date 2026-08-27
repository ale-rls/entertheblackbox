import { describe, expect, it, vi } from "vitest";
import { subscribeWithRetry } from "./index.js";
import type { PocketBaseClient } from "./persistence/pocketbase-client.js";

function fakePocketbase(subscribe: (topic: string, callback: () => void) => Promise<() => void>): PocketBaseClient {
  return {
    pb: { collection: () => ({ subscribe }) },
  } as unknown as PocketBaseClient;
}

describe("subscribeWithRetry", () => {
  it("retries with capped exponential backoff until the initial connect succeeds", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const subscribe = vi.fn(async () => {
        calls += 1;
        if (calls < 4) throw new Error("EventSource connect took too long");
        return () => {};
      });
      const onChange = vi.fn();
      subscribeWithRetry(fakePocketbase(subscribe), "media", onChange, () => false, 30_000);

      // Attempt 1 fails synchronously-ish (fake timers still need a microtask flush).
      await vi.advanceTimersByTimeAsync(0);
      expect(subscribe).toHaveBeenCalledTimes(1);

      // Backoff: 1s, 2s, 4s before the 4th (successful) attempt.
      await vi.advanceTimersByTimeAsync(1_000);
      expect(subscribe).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(subscribe).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(4_000);
      expect(subscribe).toHaveBeenCalledTimes(4);

      // No further retries once connected, and time moving forward proves it.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(subscribe).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops retrying once isStopped() reports true", async () => {
    vi.useFakeTimers();
    try {
      let stopped = false;
      const subscribe = vi.fn(async () => {
        throw new Error("still down");
      });
      subscribeWithRetry(fakePocketbase(subscribe), "media", () => {}, () => stopped, 30_000);
      await vi.advanceTimersByTimeAsync(0);
      expect(subscribe).toHaveBeenCalledTimes(1);

      stopped = true;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(subscribe).toHaveBeenCalledTimes(1); // no more attempts after shutdown
    } finally {
      vi.useRealTimers();
    }
  });

  it("caps the retry delay instead of growing unbounded", async () => {
    vi.useFakeTimers();
    try {
      const subscribe = vi.fn(async () => {
        throw new Error("still down");
      });
      subscribeWithRetry(fakePocketbase(subscribe), "media", () => {}, () => false, 5_000);
      await vi.advanceTimersByTimeAsync(0); // attempt 1 (fails)
      await vi.advanceTimersByTimeAsync(1_000); // attempt 2 (1s delay)
      await vi.advanceTimersByTimeAsync(2_000); // attempt 3 (2s delay)
      await vi.advanceTimersByTimeAsync(4_000); // attempt 4 (4s delay)
      expect(subscribe).toHaveBeenCalledTimes(4);
      // Next delay would be 8s uncapped; capped at 5s it should have fired already.
      await vi.advanceTimersByTimeAsync(5_000);
      expect(subscribe).toHaveBeenCalledTimes(5);
    } finally {
      vi.useRealTimers();
    }
  });
});
