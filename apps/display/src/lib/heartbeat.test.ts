import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROTOCOL_VERSION,
  type DisplayHeartbeatMessage,
} from "@entertheblackbox/protocol";
import { IDLE_PLACEHOLDER, startHeartbeat } from "./heartbeat.js";

describe("startHeartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends a display_heartbeat every 5s while the socket is open", () => {
    const sent: DisplayHeartbeatMessage[] = [];
    let open = true;
    let session = { sessionId: IDLE_PLACEHOLDER, phaseId: IDLE_PLACEHOLDER, phaseEpoch: 0 };

    startHeartbeat({
      isOpen: () => open,
      getState: () => session,
      send: (m) => sent.push(m as DisplayHeartbeatMessage),
      now: () => 42,
    });

    vi.advanceTimersByTime(5000);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      t: "display_heartbeat",
      v: PROTOCOL_VERSION,
      sessionId: IDLE_PLACEHOLDER,
      phaseId: IDLE_PLACEHOLDER,
      phaseEpoch: 0,
      clientTime: 42,
    });

    vi.advanceTimersByTime(5000);
    expect(sent).toHaveLength(2);

    // Not open: the tick is skipped entirely (no stale frame sent).
    open = false;
    vi.advanceTimersByTime(5000);
    expect(sent).toHaveLength(2);
  });

  it("always reads the latest session/phase via the getter, not a stale snapshot", () => {
    const sent: DisplayHeartbeatMessage[] = [];
    let session = { sessionId: "s1", phaseId: "p1", phaseEpoch: 1 };

    startHeartbeat({
      isOpen: () => true,
      getState: () => session,
      send: (m) => sent.push(m as DisplayHeartbeatMessage),
    });

    vi.advanceTimersByTime(5000);
    expect(sent[0]).toMatchObject({ sessionId: "s1", phaseId: "p1", phaseEpoch: 1 });

    session = { sessionId: "s2", phaseId: "p9", phaseEpoch: 4 };
    vi.advanceTimersByTime(5000);
    expect(sent[1]).toMatchObject({ sessionId: "s2", phaseId: "p9", phaseEpoch: 4 });
  });

  it("stops sending once disposed", () => {
    const sent: DisplayHeartbeatMessage[] = [];
    const dispose = startHeartbeat({
      isOpen: () => true,
      getState: () => ({ sessionId: "s1", phaseId: "p1", phaseEpoch: 0 }),
      send: (m) => sent.push(m as DisplayHeartbeatMessage),
    });

    vi.advanceTimersByTime(5000);
    expect(sent).toHaveLength(1);

    dispose();
    vi.advanceTimersByTime(20_000);
    expect(sent).toHaveLength(1);
  });

  it("honors a custom interval", () => {
    const sent: DisplayHeartbeatMessage[] = [];
    startHeartbeat({
      isOpen: () => true,
      getState: () => ({ sessionId: "s1", phaseId: "p1", phaseEpoch: 0 }),
      send: (m) => sent.push(m as DisplayHeartbeatMessage),
      intervalMs: 1000,
    });

    vi.advanceTimersByTime(3000);
    expect(sent).toHaveLength(3);
  });
});
