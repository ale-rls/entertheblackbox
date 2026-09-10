import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MovementConsentManager } from "./movement-consent.js";

describe("MovementConsentManager", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps recordings when the participant grants consent", async () => {
    const deleteMovementRecordings = vi.fn(async () => undefined);
    const manager = new MovementConsentManager({ deleteMovementRecordings });
    manager.track("session-1", "participant-1");
    manager.endSession("session-1");

    await expect(manager.respond("session-1", "participant-1", true)).resolves.toBe("accepted");
    await vi.advanceTimersByTimeAsync(60_000);

    expect(deleteMovementRecordings).not.toHaveBeenCalled();
    manager.stop();
  });

  it("deletes recordings immediately when the participant refuses", async () => {
    const deleteMovementRecordings = vi.fn(async () => undefined);
    const manager = new MovementConsentManager({ deleteMovementRecordings });
    manager.track("session-1", "participant-1");
    manager.endSession("session-1");

    await expect(manager.respond("session-1", "participant-1", false)).resolves.toBe("accepted");

    expect(deleteMovementRecordings).toHaveBeenCalledWith("session-1", "participant-1");
    manager.stop();
  });

  it("deletes recordings after one minute without feedback", async () => {
    const deleteMovementRecordings = vi.fn(async () => undefined);
    const manager = new MovementConsentManager({ deleteMovementRecordings });
    manager.track("session-1", "participant-1");
    manager.endSession("session-1");

    await vi.advanceTimersByTimeAsync(59_999);
    expect(deleteMovementRecordings).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(deleteMovementRecordings).toHaveBeenCalledWith("session-1", "participant-1");
    manager.stop();
  });

  it("rejects unknown and contradictory responses while keeping retries idempotent", async () => {
    const deleteMovementRecordings = vi.fn(async () => undefined);
    const manager = new MovementConsentManager({ deleteMovementRecordings });
    manager.track("session-1", "participant-1");

    await expect(manager.respond("session-1", "participant-1", true)).resolves.toBe("not-found");
    manager.endSession("session-1");
    await expect(manager.respond("session-1", "participant-1", false)).resolves.toBe("accepted");
    await expect(manager.respond("session-1", "participant-1", false)).resolves.toBe("accepted");
    await expect(manager.respond("session-1", "participant-1", true)).resolves.toBe("conflict");
    expect(deleteMovementRecordings).toHaveBeenCalledOnce();
    manager.stop();
  });
});
