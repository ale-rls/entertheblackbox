import type { IncomingMessage } from "node:http";
import {
  encodeMessage,
  parseClientMessage,
  PROTOCOL_VERSION,
  type ClientToServerMessage,
  type IdentityMessage,
  type JoinRejectedMessage,
  type ReloadMessage,
} from "@smartphonecracy/protocol";
import { DEFAULT_INSTALLATION_POLICY } from "@smartphonecracy/shared";
import type { RawData, WebSocket } from "ws";
import {
  issueJoinGrant,
  issueParticipantLease,
  verifyJoinGrant,
  verifyParticipantLease,
  type JoinGrantClaims,
} from "./tokens.js";
import { InMemoryIpRateLimiter, requestIp } from "./rate-limit.js";
import { createClientId, ParticipantRegistry, type ParticipantRecord } from "./registry.js";

export type AdmissionPolicy = {
  maxParticipants: number;
  joinGrantTtlMs: number;
  participantLeaseTtlMs: number;
};

export type AdmissionControllerOptions = {
  installationId: string;
  roomId: string;
  secret: string;
  policy?: AdmissionPolicy;
  sessionId?: string | (() => string);
  now?: () => number;
  rateLimiter?: InMemoryIpRateLimiter;
  trustProxy?: boolean;
  disconnectGraceMs?: number;
  buildVersion?: string;
  isNewParticipantAllowed?: () => boolean;
  onClientMessage?: (message: ClientToServerMessage, socket: WebSocket, request: IncomingMessage) => void;
  onParticipantJoin?: (participant: ParticipantRecord, socket: WebSocket) => void;
  onSocketClosed?: (socket: WebSocket) => void;
  onMessageError?: (error: unknown, socket: WebSocket, request: IncomingMessage) => void;
};

type SocketState = { joined: boolean };

function asBytes(raw: RawData): unknown {
  if (Array.isArray(raw)) return Buffer.concat(raw);
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  return raw;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === "object" && value !== null && "then" in value && typeof value.then === "function";
}

function joinMetadata(raw: unknown): { clientVersion: string | null; protocolVersion: number } | undefined {
  try {
    const value = typeof raw === "string"
      ? JSON.parse(raw)
      : JSON.parse(Buffer.from(raw as ArrayBuffer).toString("utf8"));
    if (typeof value !== "object" || value === null) return undefined;
    const message = value as Record<string, unknown>;
    if (message.t !== "join" && message.t !== "display_join") return undefined;
    return {
      clientVersion: typeof message.clientVersion === "string" ? message.clientVersion : null,
      protocolVersion: typeof message.v === "number" ? message.v : PROTOCOL_VERSION,
    };
  } catch {
    return undefined;
  }
}

export class AdmissionController {
  readonly registry: ParticipantRegistry;
  readonly rateLimiter: InMemoryIpRateLimiter;
  private readonly now: () => number;
  private readonly options: AdmissionControllerOptions & { policy: AdmissionPolicy };
  private readonly socketStates = new WeakMap<WebSocket, SocketState>();

  constructor(options: AdmissionControllerOptions) {
    this.options = {
      ...options,
      policy: options.policy ?? DEFAULT_INSTALLATION_POLICY,
    };
    this.now = options.now ?? (() => Date.now());
    this.registry = new ParticipantRegistry(
      this.options.policy.maxParticipants,
      options.disconnectGraceMs,
    );
    this.rateLimiter = options.rateLimiter ?? new InMemoryIpRateLimiter();
  }

  get participantLeaseTtlMs(): number {
    return this.options.policy.participantLeaseTtlMs;
  }

  issueJoinGrant(now = this.now()): { token: string; claims: JoinGrantClaims } {
    return issueJoinGrant({
      secret: this.options.secret,
      installationId: this.options.installationId,
      roomId: this.options.roomId,
      ttlMs: this.options.policy.joinGrantTtlMs,
      now,
    });
  }

  handleConnection(socket: WebSocket, request: IncomingMessage): void {
    this.socketStates.set(socket, { joined: false });
    socket.on("message", (raw: RawData) => {
      void this.handleRaw(socket, request, asBytes(raw)).catch((error: unknown) => {
        this.handleMessageError(error, socket, request);
      });
    });
    socket.on("close", () => {
      this.registry.releaseSocket(socket, this.now());
      this.options.onSocketClosed?.(socket);
    });
    socket.on("error", () => {
      this.registry.releaseSocket(socket, this.now());
      this.options.onSocketClosed?.(socket);
    });
  }

  private async handleRaw(socket: WebSocket, request: IncomingMessage, raw: unknown): Promise<void> {
    const metadata = joinMetadata(raw);
    if (
      this.options.buildVersion !== undefined &&
      metadata !== undefined &&
      metadata.clientVersion !== this.options.buildVersion
    ) {
      this.send(socket, {
        t: "reload",
        v: metadata.protocolVersion === 1 ? 1 : PROTOCOL_VERSION,
        minVersion: this.options.buildVersion,
        reason: "assets",
      });
    }
    const parsed = parseClientMessage(raw);
    if (!parsed.ok) {
      this.close(socket, 1008, "invalid client message");
      return;
    }
    const clientMessageResult = this.options.onClientMessage?.(parsed.message, socket, request) as unknown;
    if (isPromiseLike(clientMessageResult)) await clientMessageResult;
    if (parsed.message.t === "ping") {
      this.send(socket, {
        t: "pong",
        v: PROTOCOL_VERSION,
        echoClientTime: parsed.message.clientTime,
        serverTime: this.now(),
      });
      return;
    }
    if (parsed.message.t !== "join") return;

    const state = this.socketStates.get(socket);
    if (!state || state.joined) {
      this.close(socket, 1008, "socket already joined");
      return;
    }
    const rate = this.rateLimiter.consume(
      requestIp(request, this.options.trustProxy ?? false),
      this.now(),
    );
    if (!rate.allowed) {
      this.send(socket, {
        t: "join_rejected",
        v: PROTOCOL_VERSION,
        reason: "rate_limited",
        ...(rate.retryAfterMs === undefined ? {} : { retryAfterMs: rate.retryAfterMs }),
      });
      return;
    }

    const now = this.now();
    const grant = verifyJoinGrant(parsed.message.joinGrant, {
      secret: this.options.secret,
      installationId: this.options.installationId,
      roomId: this.options.roomId,
      now,
    });
    if (!grant) {
      this.send(socket, { t: "join_rejected", v: PROTOCOL_VERSION, reason: "expired_grant" });
      return;
    }

    this.registry.pruneExpired(now);
    const lease = parsed.message.participantLease
      ? verifyParticipantLease(parsed.message.participantLease, {
          secret: this.options.secret,
          installationId: this.options.installationId,
          now,
        })
      : null;
    const knownLease = parsed.message.participantLease && lease
      ? this.registry.get(parsed.message.participantLease)
      : undefined;
    if (!knownLease && this.options.isNewParticipantAllowed?.() === false) {
      this.send(socket, { t: "join_rejected", v: PROTOCOL_VERSION, reason: "show_in_progress" });
      return;
    }
    if (!knownLease && !this.registry.canAdmitNew(now)) {
      this.send(socket, { t: "join_rejected", v: PROTOCOL_VERSION, reason: "room_full" });
      return;
    }

    const clientId = lease?.clientId ?? createClientId();
    const issuedLease = lease && parsed.message.participantLease
      ? { token: parsed.message.participantLease, claims: lease }
      : issueParticipantLease({
          secret: this.options.secret,
          installationId: this.options.installationId,
          clientId,
          ttlMs: this.options.policy.participantLeaseTtlMs,
          now,
        });
    const admitted = this.registry.admit({
      participantLease: issuedLease.token,
      clientId,
      leaseExpiresAt: issuedLease.claims.expiresAt,
      socket,
      now,
    });
    if (!admitted.ok) {
      this.send(socket, { t: "join_rejected", v: PROTOCOL_VERSION, reason: "room_full" });
      return;
    }
    if (admitted.replacedSocket) this.close(admitted.replacedSocket, 4001, "lease replaced");
    state.joined = true;
    this.send(socket, {
      t: "identity",
      v: PROTOCOL_VERSION,
      clientId: admitted.participant.clientId,
      color: admitted.participant.color,
      sessionId: typeof this.options.sessionId === "function" ? this.options.sessionId() : this.options.sessionId ?? "idle",
      participantLease: issuedLease.token,
      leaseExpiresAt: issuedLease.claims.expiresAt,
    });
    const participantJoinResult = this.options.onParticipantJoin?.(admitted.participant, socket) as unknown;
    if (isPromiseLike(participantJoinResult)) await participantJoinResult;
  }

  private handleMessageError(error: unknown, socket: WebSocket, request: IncomingMessage): void {
    try {
      if (this.options.onMessageError) {
        this.options.onMessageError(error, socket, request);
      } else {
        console.error("websocket client message handling failed", error);
      }
    } catch (reportingError) {
      try {
        console.error("websocket client message error reporting failed", reportingError, error);
      } catch {
        // The message boundary must remain non-throwing even if stderr is unavailable.
      }
    }

    try {
      this.close(socket, 1011, "client message handling failed");
    } catch (closeError) {
      try {
        console.error("failed to close websocket after client message error", closeError);
      } catch {
        // Closing this socket is best-effort after an application error.
      }
      try {
        socket.terminate();
      } catch {
        // Nothing else can safely be done for this socket.
      }
    }
  }

  private send(socket: WebSocket, message: IdentityMessage | JoinRejectedMessage | ReloadMessage | { t: "pong"; v: typeof PROTOCOL_VERSION; echoClientTime: number; serverTime: number }): void {
    if (socket.readyState === undefined || socket.readyState === 1) socket.send(encodeMessage(message));
  }

  private close(socket: WebSocket, code: number, reason: string): void {
    if (socket.readyState === undefined || socket.readyState === 0 || socket.readyState === 1) {
      socket.close(code, reason);
    }
  }
}
