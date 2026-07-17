import { describe, expect, it } from "vitest";
import {
  PROTOCOL_VERSION,
  clampNormalized,
  encodeMessage,
  parseClientMessage,
  parseServerMessage,
} from "./index.js";
import type { ClientToServerMessage, ServerToClientMessage } from "./index.js";

const clientMessages: ClientToServerMessage[] = [
  {
    t: "join",
    v: 2,
    clientVersion: "1.0.0",
    installationId: "inst-1",
    roomId: "room-1",
    joinGrant: "grant-token",
  },
  { t: "input", v: 2, sessionId: "s1", phaseEpoch: 3, seq: 12, x: 0.25, y: 0.75 },
  { t: "ping", v: 2, clientTime: 1_752_000_000_000 },
  {
    t: "display_join",
    v: 2,
    clientVersion: "1.0.0",
    installationId: "inst-1",
    roomId: "room-1",
    displayToken: "secret",
  },
  { t: "video_ended", v: 2, sessionId: "s1", phaseId: "intro", phaseEpoch: 1, mediaId: "intro.mp4" },
  { t: "display_heartbeat", v: 2, sessionId: "s1", phaseId: "intro", phaseEpoch: 1, clientTime: 5 },
  {
    t: "display_playback_status",
    v: 2,
    sessionId: "s1",
    phaseId: "intro",
    phaseEpoch: 1,
    mediaId: "intro.mp4",
    status: "autoplay-blocked",
    detail: "play() requires a user gesture",
  },
  { t: "qr_grant_request", v: 2 },
];

const fourField = {
  type: "four-quadrant" as const,
  xAxis: { minLabel: "a", maxLabel: "b" },
  yAxis: { minLabel: "c", maxLabel: "d" },
};

const twoField = {
  type: "two-quadrant" as const,
  axis: "x" as const,
  labels: { minLabel: "disagree", maxLabel: "agree" },
};

const phaseSnapshot = {
  kind: "position-question" as const,
  id: "q1",
  text: "Choose",
  field: fourField,
  durationMs: 60_000,
  freezeMs: 3_000,
  connectionStaleAfterMs: 30_000,
  showLiveCounts: true,
  next: { type: "fixed" as const, target: "idle" },
  scenarioVersion: "test-1",
  startedAt: 1_752_000_000_000,
  deadlineAt: 1_752_000_060_000,
};

const serverMessages: ServerToClientMessage[] = [
  { t: "snapshot", v: 2, sessionId: "s1", phaseEpoch: 2, phase: phaseSnapshot, serverTime: 1 },
  { t: "phase", v: 2, sessionId: "s1", phaseEpoch: 2, phase: phaseSnapshot, serverTime: 1 },
  { t: "presence", v: 2, count: 7 },
  { t: "reload", v: 2, minVersion: "1.2.0", reason: "protocol" },
  { t: "cursors", v: 2, tick: 42, cursors: [{ clientId: "c1", x: 0.5, y: 0.5, color: "#f0a" }] },
  {
    t: "question_status",
    v: 2,
    sessionId: "s1",
    phaseEpoch: 2,
    connectedCount: 5,
    positionedCount: 4,
    field: fourField,
    quadrantCounts: { q1: 1, q2: 1, q3: 1, q4: 1 },
  },
  {
    t: "question_resolved",
    v: 2,
    sessionId: "s1",
    phaseEpoch: 2,
    field: fourField,
    quadrantCounts: { q1: 3, q2: 0, q3: 1, q4: 0 },
    winner: "q1",
    resolvedTarget: "video-2",
    freezeUntil: 1_752_000_063_000,
  },
  {
    t: "question_status",
    v: 2,
    sessionId: "s1",
    phaseEpoch: 3,
    connectedCount: 5,
    positionedCount: 4,
    field: twoField,
    quadrantCounts: { min: 1, max: 3 },
  },
  {
    t: "question_resolved",
    v: 2,
    sessionId: "s1",
    phaseEpoch: 3,
    field: twoField,
    quadrantCounts: { min: 1, max: 3 },
    winner: "max",
    resolvedTarget: "video-2",
    freezeUntil: 1_752_000_063_000,
  },
  { t: "qr_grant", v: 2, url: "https://x.example/j?g=abc", expiresAt: 9, placement: "corner" },
  { t: "qr_hidden", v: 2 },
  { t: "display_notice", v: 2, code: "display_replaced", level: "warning", message: "replaced" },
  {
    t: "identity",
    v: 2,
    clientId: "c1",
    color: "#f0a",
    sessionId: "s1",
    participantLease: "lease",
    leaseExpiresAt: 99,
  },
  { t: "join_rejected", v: 2, reason: "room_full" },
  { t: "join_rejected", v: 2, reason: "show_in_progress" },
  { t: "status", v: 2, phaseId: "intro", message: "watch the screen" },
  { t: "pong", v: 2, echoClientTime: 4, serverTime: 5 },
];

describe("round-trips", () => {
  it.each(clientMessages.map((m) => [m.t, m] as const))(
    "client message %s survives encode/parse",
    (_t, message) => {
      const parsed = parseClientMessage(encodeMessage(message));
      expect(parsed).toEqual({ ok: true, message });
    },
  );

  it.each(serverMessages.map((m) => [m.t, m] as const))(
    "server message %s survives encode/parse",
    (_t, message) => {
      const parsed = parseServerMessage(encodeMessage(message));
      expect(parsed).toEqual({ ok: true, message });
    },
  );

  it("parses Uint8Array payloads (ws binary frames)", () => {
    const bytes = new TextEncoder().encode(encodeMessage({ t: "ping", v: 2, clientTime: 1 }));
    expect(parseClientMessage(bytes).ok).toBe(true);
  });
});

describe("rejection with useful errors", () => {
  it("rejects non-JSON", () => {
    const r = parseClientMessage("{nope");
    expect(r).toMatchObject({ ok: false, error: "invalid-json" });
  });

  it("rejects unknown discriminators", () => {
    const r = parseClientMessage(JSON.stringify({ t: "hack", v: 2 }));
    expect(r).toMatchObject({ ok: false, error: "invalid-message" });
  });

  it("rejects a wrong protocol version", () => {
    const r = parseClientMessage(JSON.stringify({ t: "ping", v: 1, clientTime: 1 }));
    expect(r).toMatchObject({ ok: false, error: "invalid-message" });
    if (!r.ok) expect(r.reason).toContain("v");
  });

  it("rejects missing fields and names the path", () => {
    const r = parseClientMessage(
      JSON.stringify({ t: "input", v: 2, sessionId: "s1", phaseEpoch: 0, seq: 0, x: 0.1 }),
    );
    expect(r).toMatchObject({ ok: false, error: "invalid-message" });
    if (!r.ok) expect(r.reason).toContain("y");
  });

  it("rejects non-finite coordinates", () => {
    const r = parseClientMessage(
      JSON.stringify({ t: "input", v: 2, sessionId: "s1", phaseEpoch: 0, seq: 0, x: "0.1", y: 0.2 }),
    );
    expect(r.ok).toBe(false);
  });

  it("rejects question_status with a partial quadrantCounts", () => {
    const r = parseServerMessage(
      JSON.stringify({
        t: "question_status",
        v: 2,
        sessionId: "s1",
        phaseEpoch: 0,
        connectedCount: 1,
        positionedCount: 1,
        field: fourField,
        quadrantCounts: { q1: 1 },
      }),
    );
    expect(r.ok).toBe(false);
  });

  it("strictly correlates field layout with counts and winner", () => {
    const mismatchedStatus = parseServerMessage({
      t: "question_status",
      v: 2,
      sessionId: "s1",
      phaseEpoch: 0,
      connectedCount: 1,
      positionedCount: 1,
      field: twoField,
      quadrantCounts: { q1: 1, q2: 0, q3: 0, q4: 0 },
    });
    expect(mismatchedStatus.ok).toBe(false);

    const mismatchedResolution = parseServerMessage({
      t: "question_resolved",
      v: 2,
      sessionId: "s1",
      phaseEpoch: 0,
      field: twoField,
      quadrantCounts: { min: 0, max: 1 },
      winner: "q1",
      resolvedTarget: "idle",
      freezeUntil: 100,
    });
    expect(mismatchedResolution.ok).toBe(false);
  });

  it("requires the field descriptor even when live counts are hidden", () => {
    expect(parseServerMessage({
      t: "question_status",
      v: 2,
      sessionId: "s1",
      phaseEpoch: 0,
      connectedCount: 1,
      positionedCount: 0,
    }).ok).toBe(false);
    expect(parseServerMessage({
      t: "question_status",
      v: 2,
      sessionId: "s1",
      phaseEpoch: 0,
      connectedCount: 1,
      positionedCount: 0,
      field: twoField,
    }).ok).toBe(true);
  });
});

describe("clampNormalized", () => {
  it("clamps into 0..1 and maps NaN to 0", () => {
    expect(clampNormalized(-0.5)).toBe(0);
    expect(clampNormalized(1.5)).toBe(1);
    expect(clampNormalized(0.25)).toBe(0.25);
    expect(clampNormalized(Number.NaN)).toBe(0);
  });
});

it("exports the protocol version", () => {
  expect(PROTOCOL_VERSION).toBe(2);
});
