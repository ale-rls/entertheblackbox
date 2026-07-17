import { createHash, randomBytes } from "node:crypto";
import type { WebSocket } from "ws";

export const IDENTITY_COLORS = [
  "#ff595e", "#ffca3a", "#8ac926", "#1982c4", "#6a4c93",
  "#f15bb5", "#00bbf9", "#00f5d4", "#fb8500", "#8338ec",
  "#3a86ff", "#06d6a0",
] as const;

export type ParticipantRecord = {
  clientId: string;
  participantLease: string;
  color: string;
  leaseExpiresAt: number;
  socket?: WebSocket | undefined;
  disconnectedAt?: number | undefined;
  lastSeenAt: number;
};

export type RegistryAdmission =
  | { ok: true; participant: ParticipantRecord; replacedSocket?: WebSocket | undefined }
  | { ok: false; reason: "room_full" };

function socketIsConnected(socket: WebSocket | undefined): boolean {
  if (!socket) return false;
  // The fallback keeps lightweight unit-test doubles useful while real ws
  // sockets expose OPEN/CONNECTING numeric ready states.
  return socket.readyState === undefined || socket.readyState === 0 || socket.readyState === 1;
}

function newClientId(): string {
  return `client-${randomBytes(9).toString("base64url")}`;
}

function colorStart(clientId: string): number {
  const digest = createHash("sha256").update(clientId).digest();
  return digest[0]! % IDENTITY_COLORS.length;
}

export class ParticipantRegistry {
  private readonly participants = new Map<string, ParticipantRecord>();
  private readonly connectedLeases = new Set<string>();

  constructor(
    private readonly maxParticipants: number,
    private readonly disconnectGraceMs = 30_000,
  ) {
    if (maxParticipants < 1) throw new Error("maxParticipants must be positive");
    if (disconnectGraceMs < 1) throw new Error("disconnectGraceMs must be positive");
  }

  get leaseCount(): number {
    return this.participants.size;
  }

  get connectedCount(): number {
    return this.connectedLeases.size;
  }

  hasLease(participantLease: string): boolean {
    return this.participants.has(participantLease);
  }

  get(participantLease: string): ParticipantRecord | undefined {
    return this.participants.get(participantLease);
  }

  /** Return the current lease records for session/vote consumers. */
  values(): readonly ParticipantRecord[] {
    return [...this.participants.values()];
  }

  canAdmitNew(now = Date.now()): boolean {
    this.pruneExpired(now);
    // A disconnected lease still holds its slot during the grace period, but
    // the existing lease may reconnect without competing for a new slot.
    return this.leaseCount < this.maxParticipants;
  }

  admit(options: {
    participantLease: string;
    clientId: string;
    leaseExpiresAt: number;
    socket: WebSocket;
    now?: number;
  }): RegistryAdmission {
    const now = options.now ?? Date.now();
    this.pruneExpired(now);
    const existing = this.participants.get(options.participantLease);
    if (!existing && !this.canAdmitNew(now)) return { ok: false, reason: "room_full" };

    const participant = existing ?? {
      clientId: options.clientId,
      participantLease: options.participantLease,
      color: this.allocateColor(options.clientId),
      leaseExpiresAt: options.leaseExpiresAt,
      lastSeenAt: now,
    };
    const replacedSocket = existing?.socket && existing.socket !== options.socket
      ? existing.socket
      : undefined;
    participant.socket = options.socket;
    participant.disconnectedAt = undefined;
    participant.lastSeenAt = now;
    participant.leaseExpiresAt = options.leaseExpiresAt;
    this.participants.set(options.participantLease, participant);
    if (socketIsConnected(options.socket)) this.connectedLeases.add(options.participantLease);
    else this.connectedLeases.delete(options.participantLease);
    return replacedSocket === undefined
      ? { ok: true, participant }
      : { ok: true, participant, replacedSocket };
  }

  releaseSocket(socket: WebSocket, now = Date.now()): void {
    for (const [lease, participant] of this.participants) {
      if (participant.socket === socket) {
        participant.socket = undefined;
        participant.disconnectedAt = now;
        this.connectedLeases.delete(lease);
      }
    }
  }

  /** Remove every visit lease and close its live socket. */
  evictAll(code: number, reason: string): number {
    const sockets = [...this.participants.values()]
      .map((participant) => participant.socket)
      .filter((socket): socket is WebSocket => socket !== undefined);
    const evicted = this.participants.size;
    this.participants.clear();
    this.connectedLeases.clear();
    for (const socket of sockets) {
      if (!socketIsConnected(socket)) continue;
      try {
        socket.close(code, reason);
      } catch {
        try {
          socket.terminate();
        } catch {
          // The registry is already cleared; another phone can still be closed.
        }
      }
    }
    return evicted;
  }

  pruneExpired(now = Date.now()): void {
    for (const [lease, participant] of this.participants) {
      if (participant.leaseExpiresAt <= now) {
        participant.socket?.terminate();
        this.participants.delete(lease);
        this.connectedLeases.delete(lease);
      } else if (
        participant.disconnectedAt !== undefined &&
        participant.disconnectedAt + this.disconnectGraceMs <= now
      ) {
        this.participants.delete(lease);
        this.connectedLeases.delete(lease);
      }
    }
  }

  private allocateColor(clientId: string): string {
    const used = new Set([...this.participants.values()].map((participant) => participant.color));
    const start = colorStart(clientId);
    for (let offset = 0; offset < IDENTITY_COLORS.length; offset += 1) {
      const color = IDENTITY_COLORS[(start + offset) % IDENTITY_COLORS.length]!;
      if (!used.has(color)) return color;
    }
    return IDENTITY_COLORS[start]!;
  }
}

export function createClientId(): string {
  return newClientId();
}
