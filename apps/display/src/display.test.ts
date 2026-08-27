import { describe, expect, it } from "vitest";
import {
  PROTOCOL_VERSION,
  type PhaseSnapshotMessage,
  type ServerToClientMessage,
} from "@smartphonecracy/protocol";
import { Backoff } from "./lib/backoff.js";
import { ServerClock } from "./lib/serverClock.js";
import {
  displayReducer,
  initialDisplayState,
  type DisplayState,
} from "./state/store.js";

describe("ServerClock", () => {
  it("estimates offset from the ping/pong midpoint", () => {
    const clock = new ServerClock();
    // sent at 1000, received at 1200 local; server said 6100 -> midpoint 1100, offset 5000
    clock.addSample(1000, 1200, 6100);
    expect(clock.offset).toBe(5000);
    expect(clock.now(2000)).toBe(7000);
  });

  it("uses the median so one jittery sample cannot skew countdowns", () => {
    const clock = new ServerClock();
    clock.addSample(0, 0, 5000);
    clock.addSample(0, 0, 5010);
    clock.addSample(0, 0, 90_000); // spike
    expect(clock.offset).toBe(5010);
  });

  it("floors remaining time at zero", () => {
    const clock = new ServerClock();
    clock.addSample(0, 0, 0); // zero offset
    expect(clock.remainingUntil(500, 400)).toBe(100);
    expect(clock.remainingUntil(500, 900)).toBe(0);
  });
});

describe("Backoff", () => {
  it("grows exponentially to the cap and resets", () => {
    const b = new Backoff({ baseMs: 500, factor: 2, capMs: 4000, jitter: 0, rng: () => 0.5 });
    expect(b.next()).toBe(500);
    expect(b.next()).toBe(1000);
    expect(b.next()).toBe(2000);
    expect(b.next()).toBe(4000);
    expect(b.next()).toBe(4000); // capped
    b.reset();
    expect(b.next()).toBe(500);
  });

  it("applies symmetric jitter", () => {
    const low = new Backoff({ baseMs: 1000, jitter: 0.2, rng: () => 0 });
    const high = new Backoff({ baseMs: 1000, jitter: 0.2, rng: () => 1 });
    expect(low.next()).toBe(900);
    expect(high.next()).toBe(1100);
  });
});

const snapshot = (
  overrides: Partial<{ sessionId: string; phaseEpoch: number; id: string }> = {},
): ServerToClientMessage => {
  const phase: PhaseSnapshotMessage = {
    kind: "video",
    id: overrides.id ?? "intro",
    src: "intro.mp4",
    expectedDurationMs: 10_000,
    next: "q1",
    scenarioVersion: "dev-1",
    startedAt: 0,
    deadlineAt: null,
  };
  return {
    t: "snapshot",
    v: PROTOCOL_VERSION,
    sessionId: overrides.sessionId ?? "s1",
    phaseEpoch: overrides.phaseEpoch ?? 1,
    phase,
    serverTime: 0,
  };
};

const apply = (state: DisplayState, message: ServerToClientMessage) =>
  displayReducer(state, { type: "server-message", message });

describe("displayReducer", () => {
  it("adopts snapshots and phases", () => {
    const s = apply(initialDisplayState, snapshot());
    expect(s.sessionId).toBe("s1");
    expect(s.phaseEpoch).toBe(1);
    expect(s.phase?.id).toBe("intro");
  });

  it("ignores stale-epoch frames from the same session", () => {
    let s = apply(initialDisplayState, snapshot({ phaseEpoch: 5, id: "later" }));
    s = apply(s, snapshot({ phaseEpoch: 3, id: "earlier" }));
    expect(s.phase?.id).toBe("later");
    expect(s.phaseEpoch).toBe(5);
  });

  it("accepts a lower epoch from a NEW session (epochs reset per session)", () => {
    let s = apply(initialDisplayState, snapshot({ sessionId: "s1", phaseEpoch: 9 }));
    s = apply(s, snapshot({ sessionId: "s2", phaseEpoch: 0, id: "fresh" }));
    expect(s.sessionId).toBe("s2");
    expect(s.phase?.id).toBe("fresh");
  });

  it("tracks presence, notices, and reload", () => {
    let s = apply(initialDisplayState, { t: "presence", v: PROTOCOL_VERSION, count: 12 });
    expect(s.presenceCount).toBe(12);
    s = apply(s, {
      t: "display_notice",
      v: PROTOCOL_VERSION,
      code: "display_replaced",
      level: "warning",
      message: "replaced",
    });
    expect(s.notice?.code).toBe("display_replaced");
    s = apply(s, { t: "reload", v: PROTOCOL_VERSION, minVersion: "1.1.0", reason: "assets" });
    expect(s.reloadRequired?.reason).toBe("assets");
  });

  it("adopts a rating_status for the current session/epoch and drops stale ones", () => {
    let s = apply(initialDisplayState, snapshot({ sessionId: "s1", phaseEpoch: 4 }));
    s = apply(s, {
      t: "rating_status", v: PROTOCOL_VERSION, sessionId: "s1", phaseEpoch: 4,
      candidateLabel: "OpenApollo", applause: 3, boo: 1,
    });
    expect(s.ratingStatus).toMatchObject({ candidateLabel: "OpenApollo", applause: 3, boo: 1 });

    // Stale epoch is ignored.
    s = apply(s, {
      t: "rating_status", v: PROTOCOL_VERSION, sessionId: "s1", phaseEpoch: 3,
      candidateLabel: "Dionysos69", applause: 9, boo: 0,
    });
    expect(s.ratingStatus?.candidateLabel).toBe("OpenApollo");

    // A new phase clears the previous rating tally.
    s = apply(s, snapshot({ sessionId: "s1", phaseEpoch: 5, id: "next" }));
    expect(s.ratingStatus).toBeNull();
  });

  it("drops the QR grant while reconnecting (server resends after join)", () => {
    let s = apply(initialDisplayState, {
      t: "qr_grant",
      v: PROTOCOL_VERSION,
      url: "https://x.example/j?g=1",
      expiresAt: 99,
      placement: "large",
    });
    expect(s.qrGrant).not.toBeNull();
    s = displayReducer(s, { type: "connection-status", status: "reconnecting" });
    expect(s.qrGrant).toBeNull();
  });

  it("qr_hidden clears and suppresses the QR", () => {
    let s = apply(initialDisplayState, {
      t: "qr_grant",
      v: PROTOCOL_VERSION,
      url: "https://x.example/j?g=1",
      expiresAt: 99,
      placement: "corner",
    });
    s = apply(s, { t: "qr_hidden", v: PROTOCOL_VERSION });
    expect(s.qrGrant).toBeNull();
    expect(s.qrHidden).toBe(true);
  });
});
