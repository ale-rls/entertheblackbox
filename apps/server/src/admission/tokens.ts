import type { ParticipantClient } from "@entertheblackbox/protocol";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type JoinGrantClaims = {
  installationId: string;
  roomId: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
};

export type ParticipantLeaseClaims = {
  /** Absent only on legacy leases. */
  client?: ParticipantClient;
  installationId: string;
  clientId: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
};

type SignedClaims = JoinGrantClaims | ParticipantLeaseClaims;

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function sign(kind: string, payload: string, secret: string): string {
  return createHmac("sha256", secret).update(`${kind}.${payload}`).digest("base64url");
}

function issue<T extends SignedClaims>(kind: string, claims: T, secret: string): string {
  const payload = encode(claims);
  return `${kind}.${payload}.${sign(kind, payload, secret)}`;
}

function verify<T extends SignedClaims>(
  token: string,
  kind: string,
  secret: string,
  now: number,
): T | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== kind) return null;
  const [, payload, suppliedSignature] = parts;
  if (!payload || !suppliedSignature) return null;

  let expected: Buffer;
  let supplied: Buffer;
  let claims: unknown;
  try {
    expected = Buffer.from(sign(kind, payload, secret), "base64url");
    supplied = Buffer.from(suppliedSignature, "base64url");
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  if (!claims || typeof claims !== "object") return null;

  const candidate = claims as Partial<T>;
  if (
    typeof candidate.issuedAt !== "number" ||
    typeof candidate.expiresAt !== "number" ||
    !Number.isSafeInteger(candidate.issuedAt) ||
    !Number.isSafeInteger(candidate.expiresAt) ||
    candidate.issuedAt > now ||
    candidate.expiresAt <= now
  ) return null;
  return claims as T;
}

function nonce(): string {
  return randomBytes(16).toString("base64url");
}

export function issueJoinGrant(options: {
  secret: string;
  installationId: string;
  roomId: string;
  ttlMs: number;
  now?: number;
}): { token: string; claims: JoinGrantClaims } {
  const issuedAt = options.now ?? Date.now();
  const claims: JoinGrantClaims = {
    installationId: options.installationId,
    roomId: options.roomId,
    issuedAt,
    expiresAt: issuedAt + options.ttlMs,
    nonce: nonce(),
  };
  return { token: issue("grant-v1", claims, options.secret), claims };
}

export function verifyJoinGrant(
  token: string,
  options: { secret: string; installationId: string; roomId: string; now?: number },
): JoinGrantClaims | null {
  const claims = verify<JoinGrantClaims>(
    token,
    "grant-v1",
    options.secret,
    options.now ?? Date.now(),
  );
  if (!claims || claims.installationId !== options.installationId || claims.roomId !== options.roomId) {
    return null;
  }
  return claims;
}

export function issueParticipantLease(options: {
  secret: string;
  installationId: string;
  clientId: string;
  client?: ParticipantClient | undefined;
  ttlMs: number;
  now?: number;
}): { token: string; claims: ParticipantLeaseClaims } {
  const issuedAt = options.now ?? Date.now();
  const claims: ParticipantLeaseClaims = {
    installationId: options.installationId,
    clientId: options.clientId,
    ...(options.client === undefined ? {} : { client: options.client }),
    issuedAt,
    expiresAt: issuedAt + options.ttlMs,
    nonce: nonce(),
  };
  return { token: issue("lease-v1", claims, options.secret), claims };
}

export function verifyParticipantLease(
  token: string,
  options: { secret: string; installationId: string; now?: number },
): ParticipantLeaseClaims | null {
  const claims = verify<ParticipantLeaseClaims>(
    token,
    "lease-v1",
    options.secret,
    options.now ?? Date.now(),
  );
  return claims?.installationId === options.installationId ? claims : null;
}
