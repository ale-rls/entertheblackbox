import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { parseServerMessage, SHOW_ENDED_CLOSE_CODE } from "@smartphonecracy/protocol";
import { z } from "zod";
import { AdmissionController, InMemoryIpRateLimiter, issueJoinGrant, issueParticipantLease, verifyJoinGrant, verifyParticipantLease } from "./index.js";
import type { WebSocket } from "ws";

class MockSocket extends EventEmitter {
  readyState = 1;
  readonly sent: unknown[] = [];
  readonly closeCalls: Array<{ code: number | undefined; reason: string | undefined }> = [];

  send(value: string): void {
    this.sent.push(JSON.parse(value));
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
    this.readyState = 3;
    this.emit("close");
  }

  terminate(): void {
    this.close(1006, "terminated");
  }
}

function socket(): WebSocket {
  return new MockSocket() as unknown as WebSocket;
}

function request(ip = "192.0.2.1", forwarded?: string): IncomingMessage {
  return {
    headers: forwarded ? { "x-forwarded-for": forwarded } : {},
    socket: { remoteAddress: ip },
  } as unknown as IncomingMessage;
}

function lastMessage(s: WebSocket): any {
  return (s as unknown as MockSocket).sent.at(-1);
}

function join(
  controller: AdmissionController,
  s: WebSocket,
  grant: string,
  lease?: string,
  ip?: string,
  forwarded?: string,
): void {
  controller.handleConnection(s, request(ip, forwarded));
  s.emit("message", Buffer.from(JSON.stringify({
    t: "join",
    v: 2,
    clientVersion: "test",
    installationId: "inst-1",
    roomId: "room-1",
    joinGrant: grant,
    ...(lease ? { participantLease: lease } : {}),
  })));
}

function controller(options: Partial<ConstructorParameters<typeof AdmissionController>[0]> = {}): AdmissionController {
  return new AdmissionController({
    installationId: "inst-1",
    roomId: "room-1",
    secret: "this-is-a-test-secret",
    now: () => 1_000,
    policy: { maxParticipants: 30, joinGrantTtlMs: 120_000, participantLeaseTtlMs: 7_200_000 },
    ...options,
  });
}

describe("HMAC admission tokens", () => {
  it("rotates grants with unique nonces and rejects expiry, tampering, and wrong scope", () => {
    const first = issueJoinGrant({ secret: "secret", installationId: "i", roomId: "r", ttlMs: 120, now: 1_000 });
    const second = issueJoinGrant({ secret: "secret", installationId: "i", roomId: "r", ttlMs: 120, now: 1_001 });
    expect(first.token).not.toBe(second.token);
    expect(verifyJoinGrant(first.token, { secret: "secret", installationId: "i", roomId: "r", now: 1_119 })).not.toBeNull();
    expect(verifyJoinGrant(first.token, { secret: "secret", installationId: "i", roomId: "r", now: 1_120 })).toBeNull();
    expect(verifyJoinGrant(`${first.token}x`, { secret: "secret", installationId: "i", roomId: "r", now: 1_001 })).toBeNull();
    expect(verifyJoinGrant(first.token, { secret: "secret", installationId: "other", roomId: "r", now: 1_001 })).toBeNull();
  });

  it("issues installation-scoped two-hour participant leases", () => {
    const lease = issueParticipantLease({ secret: "secret", installationId: "i", clientId: "c1", ttlMs: 7_200_000, now: 1_000 });
    expect(verifyParticipantLease(lease.token, { secret: "secret", installationId: "i", now: 7_201_000 })).toBeNull();
    expect(verifyParticipantLease(lease.token, { secret: "secret", installationId: "i", now: 7_200_999 })?.clientId).toBe("c1");
    expect(verifyParticipantLease(lease.token, { secret: "secret", installationId: "other", now: 1_001 })).toBeNull();
    expect(verifyParticipantLease(lease.token, { secret: "secret", installationId: "i", now: 1_001 })?.clientId).toBe("c1");
  });
});

describe("participant admission", () => {
  it("evicts every phone at show end and requires a freshly issued QR grant", () => {
    let now = 1_000;
    const admission = controller({ now: () => now });
    const oldGrant = admission.issueJoinGrant(now).token;
    const first = socket();
    const second = socket();
    join(admission, first, oldGrant, undefined, "198.51.100.1");
    join(admission, second, oldGrant, undefined, "198.51.100.2");

    now = 2_000;
    expect(admission.endParticipantSession(now)).toBe(2);
    expect(admission.registry.leaseCount).toBe(0);
    expect(admission.registry.connectedCount).toBe(0);
    expect((first as unknown as MockSocket).closeCalls).toContainEqual({
      code: SHOW_ENDED_CLOSE_CODE,
      reason: "show ended",
    });
    expect((second as unknown as MockSocket).closeCalls).toContainEqual({
      code: SHOW_ENDED_CLOSE_CODE,
      reason: "show ended",
    });

    const staleQrRetry = socket();
    join(admission, staleQrRetry, oldGrant, undefined, "198.51.100.3");
    expect(lastMessage(staleQrRetry)).toMatchObject({ t: "join_rejected", reason: "expired_grant" });

    const freshQrJoin = socket();
    join(admission, freshQrJoin, admission.issueJoinGrant(now).token, undefined, "198.51.100.4");
    expect(lastMessage(freshQrJoin)).toMatchObject({ t: "identity" });
  });

  it("catches client message handler failures and closes only the offending socket", async () => {
    const failure = new Error("bad phase target");
    const reported: unknown[] = [];
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      const admission = controller({
        onClientMessage: async () => {
          await Promise.resolve();
          throw failure;
        },
        onMessageError: (error) => reported.push(error),
      });
      const offendingSocket = socket();
      const unaffectedSocket = socket();
      admission.handleConnection(offendingSocket, request());
      admission.handleConnection(unaffectedSocket, request("198.51.100.2"));
      offendingSocket.emit("message", Buffer.from(JSON.stringify({
        t: "ping",
        v: 2,
        clientTime: 123,
      })));

      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(reported).toEqual([failure]);
      expect((offendingSocket as unknown as MockSocket).closeCalls).toEqual([
        { code: 1011, reason: "client message handling failed" },
      ]);
      expect((unaffectedSocket as unknown as MockSocket).readyState).toBe(1);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("rejects new joins during an active show but permits a known lease to reconnect", () => {
    let newParticipantsAllowed = true;
    const admission = controller({ isNewParticipantAllowed: () => newParticipantsAllowed });
    const grant = admission.issueJoinGrant().token;
    const first = socket();
    join(admission, first, grant);
    const identity = lastMessage(first) as { participantLease: string };

    newParticipantsAllowed = false;
    const blocked = socket();
    join(admission, blocked, grant, undefined, "198.51.100.2");
    expect(lastMessage(blocked)).toMatchObject({ t: "join_rejected", reason: "show_in_progress" });

    const reconnect = socket();
    join(admission, reconnect, grant, identity.participantLease, "198.51.100.3");
    expect(lastMessage(reconnect)).toMatchObject({ t: "identity" });

    newParticipantsAllowed = true;
    const nextRound = socket();
    join(admission, nextRound, grant, undefined, "198.51.100.4");
    expect(lastMessage(nextRound)).toMatchObject({ t: "identity" });
  });

  it("soft-upgrades stale phone and display bundles without blocking admission or valid messages", () => {
    const messages: string[] = [];
    const admission = controller({
      buildVersion: "test",
      onClientMessage: (message) => messages.push(message.t),
    });
    const grant = admission.issueJoinGrant(1_000).token;

    const matching = socket();
    join(admission, matching, grant);
    expect((matching as unknown as MockSocket).sent).not.toContainEqual(expect.objectContaining({ t: "reload" }));

    const matchingDisplay = socket();
    admission.handleConnection(matchingDisplay, request("198.51.100.4"));
    matchingDisplay.emit("message", Buffer.from(JSON.stringify({
      t: "display_join",
      v: 2,
      clientVersion: "test",
      installationId: "inst-1",
      roomId: "room-1",
      displayToken: "token",
    })));
    expect((matchingDisplay as unknown as MockSocket).sent).not.toContainEqual(expect.objectContaining({ t: "reload" }));

    const stalePhone = socket();
    admission.handleConnection(stalePhone, request("198.51.100.2"));
    stalePhone.emit("message", Buffer.from(JSON.stringify({
      t: "join",
      v: 2,
      clientVersion: "old-build",
      installationId: "inst-1",
      roomId: "room-1",
      joinGrant: grant,
    })));
    expect((stalePhone as unknown as MockSocket).sent).toEqual(expect.arrayContaining([
      { t: "reload", v: 2, minVersion: "test", reason: "assets" },
      expect.objectContaining({ t: "identity" }),
    ]));

    const staleDisplay = socket();
    admission.handleConnection(staleDisplay, request("198.51.100.3"));
    staleDisplay.emit("message", Buffer.from(JSON.stringify({
      t: "display_join",
      v: 2,
      clientVersion: "old-build",
      installationId: "inst-1",
      roomId: "room-1",
      displayToken: "token",
    })));
    expect(lastMessage(staleDisplay)).toEqual({
      t: "reload", v: 2, minVersion: "test", reason: "assets",
    });
    expect(messages).toContain("display_join");
  });

  it("JSON-parses a valid non-join socket frame only once", () => {
    const messages: string[] = [];
    const admission = controller({
      buildVersion: "test",
      onClientMessage: (message) => messages.push(message.t),
    });
    const s = socket();
    admission.handleConnection(s, request());
    const parseSpy = vi.spyOn(JSON, "parse");

    try {
      s.emit("message", Buffer.from(JSON.stringify({
        t: "input",
        v: 2,
        sessionId: "session-1",
        phaseEpoch: 1,
        seq: 1,
        x: 0.25,
        y: 0.75,
      })));

      expect(messages).toEqual(["input"]);
      expect(parseSpy).toHaveBeenCalledTimes(1);
    } finally {
      parseSpy.mockRestore();
    }
  });

  it("sends reload to an old join message that lacks clientVersion before rejecting it", () => {
    const legacyReloadSchema = z.object({
      t: z.literal("reload"),
      v: z.literal(1),
      minVersion: z.string().min(1),
      reason: z.enum(["protocol", "scenario", "assets"]),
    });
    const admission = controller({ buildVersion: "server-build" });
    const oldClient = socket();
    admission.handleConnection(oldClient, request());
    oldClient.emit("message", Buffer.from(JSON.stringify({
      t: "join",
      v: 1,
      installationId: "inst-1",
      roomId: "room-1",
      joinGrant: admission.issueJoinGrant(1_000).token,
    })));
    expect((oldClient as unknown as MockSocket).sent).toContainEqual({
      t: "reload", v: 1, minVersion: "server-build", reason: "assets",
    });
    expect(legacyReloadSchema.safeParse(lastMessage(oldClient)).success).toBe(true);
    expect(parseServerMessage(lastMessage(oldClient)).ok).toBe(true);
    expect((oldClient as unknown as MockSocket).closeCalls[0]).toMatchObject({ code: 1008 });

    const oldDisplay = socket();
    admission.handleConnection(oldDisplay, request("198.51.100.2"));
    oldDisplay.emit("message", Buffer.from(JSON.stringify({
      t: "display_join",
      v: 1,
      installationId: "inst-1",
      roomId: "room-1",
      displayToken: "token",
    })));
    expect((oldDisplay as unknown as MockSocket).sent).toContainEqual({
      t: "reload", v: 1, minVersion: "server-build", reason: "assets",
    });
    expect(legacyReloadSchema.safeParse(lastMessage(oldDisplay)).success).toBe(true);
    expect((oldDisplay as unknown as MockSocket).closeCalls[0]).toMatchObject({ code: 1008 });
  });

  it("assigns stable identity and replaces a same-lease socket at capacity", () => {
    const admission = controller({
      policy: { maxParticipants: 2, joinGrantTtlMs: 120_000, participantLeaseTtlMs: 7_200_000 },
    });
    const grant = admission.issueJoinGrant(1_000).token;
    const first = socket();
    const second = socket();
    join(admission, first, grant, undefined, "198.51.100.1");
    join(admission, second, grant, undefined, "198.51.100.2");
    const firstIdentity = lastMessage(first);
    expect(lastMessage(second)).toMatchObject({ t: "identity" });
    expect(firstIdentity).toMatchObject({ t: "identity", sessionId: "idle", clientId: expect.any(String), color: expect.any(String) });
    expect(admission.registry.leaseCount).toBe(2);
    expect((first as unknown as MockSocket).readyState).toBe(1);
    expect((second as unknown as MockSocket).readyState).toBe(1);
    expect(admission.registry.connectedCount).toBe(2);

    const rejected = socket();
    join(admission, rejected, grant, undefined, "198.51.100.3");
    expect(lastMessage(rejected)).toMatchObject({ t: "join_rejected", reason: "room_full" });

    const replacement = socket();
    join(admission, replacement, grant, (firstIdentity as { participantLease: string }).participantLease, "198.51.100.4");
    expect(lastMessage(replacement)).toMatchObject({ t: "identity", clientId: (firstIdentity as { clientId: string }).clientId });
    expect((first as unknown as MockSocket).closeCalls).toContainEqual({ code: 4001, reason: "lease replaced" });
    expect(admission.registry.connectedCount).toBe(2);
  });

  it("rate-limits join attempts per IP without using IP as identity", () => {
    const admission = controller({ rateLimiter: new InMemoryIpRateLimiter({ maxAttempts: 2, windowMs: 1_000 }) });
    const invalid = "grant.v1.invalid.invalid";
    for (let i = 0; i < 2; i += 1) {
      const s = socket();
      join(admission, s, invalid, undefined, "203.0.113.8");
      expect(lastMessage(s)).toMatchObject({ t: "join_rejected", reason: "expired_grant" });
    }
    const limited = socket();
    join(admission, limited, invalid, undefined, "203.0.113.8");
    expect(lastMessage(limited)).toMatchObject({ t: "join_rejected", reason: "rate_limited", retryAfterMs: 1_000 });
    expect(admission.rateLimiter.size).toBe(1);
  });

  it("trusts X-Forwarded-For only when explicitly configured", () => {
    const invalid = "grant-v1.invalid.invalid";
    const defaultLimiter = new InMemoryIpRateLimiter({ maxAttempts: 1, windowMs: 1_000 });
    const direct = controller({ rateLimiter: defaultLimiter });
    const directFirst = socket();
    const directSecond = socket();
    join(direct, directFirst, invalid, undefined, "198.51.100.1", "203.0.113.1");
    join(direct, directSecond, invalid, undefined, "198.51.100.1", "203.0.113.2");
    expect(lastMessage(directSecond)).toMatchObject({ t: "join_rejected", reason: "rate_limited" });

    const proxied = controller({
      rateLimiter: new InMemoryIpRateLimiter({ maxAttempts: 1, windowMs: 1_000 }),
      trustProxy: true,
    });
    const proxiedFirst = socket();
    const proxiedSecond = socket();
    join(proxied, proxiedFirst, invalid, undefined, "198.51.100.1", "203.0.113.1");
    join(proxied, proxiedSecond, invalid, undefined, "198.51.100.1", "203.0.113.2");
    expect(lastMessage(proxiedSecond)).toMatchObject({ t: "join_rejected", reason: "expired_grant" });
  });

  it("holds a disconnected lease during a grace period, then frees its cap slot", () => {
    let now = 1_000;
    const admission = controller({
      now: () => now,
      disconnectGraceMs: 100,
      policy: { maxParticipants: 2, joinGrantTtlMs: 120_000, participantLeaseTtlMs: 7_200_000 },
    });
    const grant = admission.issueJoinGrant(now).token;
    const first = socket();
    const second = socket();
    join(admission, first, grant, undefined, "198.51.100.1");
    join(admission, second, grant, undefined, "198.51.100.2");
    expect(admission.registry.connectedCount).toBe(2);
    const lease = (lastMessage(first) as { participantLease: string }).participantLease;
    first.close();
    expect(admission.registry.connectedCount).toBe(1);

    now = 1_001;
    const blocked = socket();
    join(admission, blocked, grant, undefined, "198.51.100.3");
    expect(lastMessage(blocked)).toMatchObject({ t: "join_rejected", reason: "room_full" });

    const reconnect = socket();
    join(admission, reconnect, grant, lease, "198.51.100.4");
    expect(lastMessage(reconnect)).toMatchObject({ t: "identity" });
    expect(admission.registry.connectedCount).toBe(2);
    second.close();
    expect(admission.registry.connectedCount).toBe(1);

    now = 1_101;
    const admittedAfterGrace = socket();
    join(admission, admittedAfterGrace, grant, undefined, "198.51.100.5");
    expect(lastMessage(admittedAfterGrace)).toMatchObject({ t: "identity" });
    expect(admission.registry.connectedCount).toBe(2);
  });

  it("prunes expired rate-limit buckets during later traffic", () => {
    const limiter = new InMemoryIpRateLimiter({ maxAttempts: 2, windowMs: 1_000 });
    limiter.consume("203.0.113.1", 0);
    limiter.consume("203.0.113.2", 0);
    expect(limiter.size).toBe(2);
    limiter.consume("203.0.113.3", 1_000);
    expect(limiter.size).toBe(1);
  });

  it("parses every socket payload and closes malformed data", () => {
    const admission = controller();
    const s = socket();
    admission.handleConnection(s, request());
    s.emit("message", Buffer.from("{not-json"));
    expect((s as unknown as MockSocket).closeCalls[0]).toMatchObject({ code: 1008 });
    expect(parseServerMessage(JSON.stringify(lastMessage(s))).ok).toBe(false);
  });
});
