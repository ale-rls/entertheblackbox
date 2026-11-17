import { createHash, timingSafeEqual } from 'node:crypto';

export type StaffGateVerdict = 'ok' | 'disabled' | 'locked' | 'wrong';

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Checks the venue staff PIN for the tablet staff menu. The PIN lives in the
 * server environment (STAFF_PIN), never in the published scenario. Each
 * participant gets a few attempts before a short lockout.
 */
export class StaffGate {
  private readonly pin: Buffer | null;
  private readonly failures = new Map<string, { count: number; lockedUntil: number }>();
  constructor(pin: string | undefined, private readonly maxFailures = 5, private readonly lockoutMs = 60_000) {
    this.pin = pin ? digest(pin) : null;
  }
  get enabled(): boolean { return this.pin !== null; }
  check(participantId: string, candidate: string, now: number): StaffGateVerdict {
    if (!this.pin) return 'disabled';
    const state = this.failures.get(participantId) ?? { count: 0, lockedUntil: 0 };
    if (state.lockedUntil > now) return 'locked';
    if (timingSafeEqual(digest(candidate), this.pin)) { this.failures.delete(participantId); return 'ok'; }
    const count = state.count + 1;
    if (count >= this.maxFailures) { this.failures.set(participantId, { count: 0, lockedUntil: now + this.lockoutMs }); return 'locked'; }
    this.failures.set(participantId, { count, lockedUntil: 0 });
    return 'wrong';
  }
}

export function staffGateMessage(verdict: Exclude<StaffGateVerdict, 'ok'>): string {
  if (verdict === 'disabled') return 'The staff menu is not set up on this server.';
  if (verdict === 'locked') return 'Too many wrong PINs. Try again in a minute.';
  return 'Wrong PIN.';
}
