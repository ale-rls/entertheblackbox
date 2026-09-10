/**
 * Which tracked body is holding which phone.
 *
 * Voting does not need this: counting GIDs per floor zone already works
 * without knowing who anyone is. Personal audio does, because sending one
 * participant's cue to another person's headphones is the failure this whole
 * module exists to avoid.
 *
 * The state machine is ported from `bindings.py` in the sibling Python runner,
 * whose design is sound:
 *
 *     unclaimed -> bound -> lost -> (bound | orphaned) -> bound
 *
 * The rule that matters is in `plausibleRebindCandidates`: when an unbound GID
 * appears and more than one lost player could plausibly be it, we refuse to
 * guess and leave everyone as they are. An unbound participant hears nothing,
 * which is recoverable; a wrongly bound one hears someone else's cue, which is
 * not.
 *
 * Unlike the Python original this is pure and tick-driven rather than
 * timer-driven, so orphaning is deterministic in tests.
 */

export type BindingState = "bound" | "lost" | "orphaned";

export type BindingReason = "claim" | "auto-rebind" | "operator" | "lost" | "orphaned";

export type BindingEvent = {
  participantId: string;
  gid: number | null;
  state: BindingState;
  reason: BindingReason;
};

type Player = {
  participantId: string;
  gid: number | null;
  state: BindingState;
  lastX: number | null;
  lastY: number | null;
  lastSeenAt: number | null;
};

export type BindingRegistryOptions = {
  /**
   * Thresholds for auto-rebind, in normalized floor units and milliseconds.
   * Deliberately hard cutoffs rather than a weighted score: they are meant to
   * be retuned from rehearsal telemetry, and a cutoff is far easier to reason
   * about on a venue floor than a scoring function.
   */
  rebindMaxDistance?: number;
  rebindMaxGapMs?: number;
  orphanAfterMs?: number;
};

const DEFAULT_REBIND_MAX_DISTANCE = 0.15;
const DEFAULT_REBIND_MAX_GAP_MS = 8_000;
const DEFAULT_ORPHAN_AFTER_MS = 3_000;

export class BindingError extends Error {}

export class BindingRegistry {
  private readonly players = new Map<string, Player>();
  private readonly byGid = new Map<number, string>();
  /** GIDs currently visible, with their last known position. */
  private readonly liveGids = new Map<number, { x: number; y: number } | null>();
  /**
   * GIDs already offered to the rebind matcher. The adapter reports a body as
   * `join` with no position and only then a `position`, so "first sighting" is
   * not the moment a match is possible; the first sighting *with a position*
   * is. Cleared when the GID leaves.
   */
  private readonly rebindAttempted = new Set<number>();

  private readonly rebindMaxDistance: number;
  private readonly rebindMaxGapMs: number;
  private readonly orphanAfterMs: number;

  constructor(options: BindingRegistryOptions = {}) {
    this.rebindMaxDistance = options.rebindMaxDistance ?? DEFAULT_REBIND_MAX_DISTANCE;
    this.rebindMaxGapMs = options.rebindMaxGapMs ?? DEFAULT_REBIND_MAX_GAP_MS;
    this.orphanAfterMs = options.orphanAfterMs ?? DEFAULT_ORPHAN_AFTER_MS;
  }

  /**
   * The participant a GID's position should be attributed to: the phone that
   * claimed it, or null when nobody has. Callers fall back to the anonymous
   * `gid:<n>` participant so unbound bodies still count toward a vote.
   */
  participantForGid(gid: number): string | null {
    return this.byGid.get(gid) ?? null;
  }

  gidForParticipant(participantId: string): number | null {
    const player = this.players.get(participantId);
    return player?.state === "bound" ? player.gid : null;
  }

  stateOf(participantId: string): BindingState | null {
    return this.players.get(participantId)?.state ?? null;
  }

  /** Everyone currently lost or orphaned, for the operator dashboard. */
  unboundParticipants(): readonly string[] {
    return [...this.players.values()]
      .filter((player) => player.state !== "bound")
      .map((player) => player.participantId);
  }

  /**
   * Self-service claim from a participant's phone. Refused when that
   * participant is already bound, so an accidental double-submit cannot
   * hijack a live binding, and when the GID is not currently visible.
   */
  claim(participantId: string, gid: number, now: number): BindingEvent {
    const existing = this.players.get(participantId);
    if (existing !== undefined && existing.state === "bound") {
      throw new BindingError(`participant ${participantId} is already bound to gid ${existing.gid}`);
    }
    if (!this.liveGids.has(gid)) throw new BindingError(`gid ${gid} is not currently visible`);
    const holder = this.byGid.get(gid);
    if (holder !== undefined && holder !== participantId) {
      throw new BindingError(`gid ${gid} is already claimed by ${holder}`);
    }
    return this.bind(participantId, gid, "claim", now);
  }

  /**
   * Manual rebind from the admin dashboard. Works for a participant in any
   * state and may take a GID from someone else, which is the point: an
   * operator is correcting a binding they can see is wrong. The previous
   * holder goes lost rather than being dropped.
   */
  operatorRebind(participantId: string, gid: number, now: number): BindingEvent {
    if (!this.liveGids.has(gid)) throw new BindingError(`gid ${gid} is not currently visible`);
    const holderId = this.byGid.get(gid);
    if (holderId !== undefined && holderId !== participantId) {
      const holder = this.players.get(holderId);
      if (holder !== undefined) this.markLost(holder, now);
    }
    return this.bind(participantId, gid, "operator", now);
  }

  /** A tracked body appeared or moved. Returns any auto-rebind it triggered. */
  gidSeen(gid: number, position: { x: number; y: number } | null, now: number): BindingEvent | null {
    const known = this.liveGids.has(gid);
    this.liveGids.set(gid, position);

    const boundTo = this.byGid.get(gid);
    if (boundTo !== undefined) {
      const player = this.players.get(boundTo);
      if (player !== undefined && position !== null) {
        player.lastX = position.x;
        player.lastY = position.y;
        player.lastSeenAt = now;
      }
      return null;
    }

    // Match on the first sighting that carries a usable position. Matching on
    // arrival alone can never work: the arrival has no position, so there is
    // nothing to measure distance against. Attempted once per GID so a
    // heartbeat snapshot, which resends every visible GID, does not retry the
    // match on every beat.
    void known;
    if (position === null || this.rebindAttempted.has(gid)) return null;
    this.rebindAttempted.add(gid);
    return this.tryAutoRebind(gid, now);
  }

  /** A tracked body disappeared. Its player, if any, goes lost. */
  gidLeft(gid: number, now: number): BindingEvent | null {
    this.liveGids.delete(gid);
    this.rebindAttempted.delete(gid);
    const participantId = this.byGid.get(gid);
    if (participantId === undefined) return null;
    const player = this.players.get(participantId);
    if (player === undefined) return null;
    return this.markLost(player, now);
  }

  /**
   * Promote players who have been lost longer than the threshold. Call on the
   * engine's existing tick; nothing here schedules its own timer.
   */
  tick(now: number): readonly BindingEvent[] {
    const events: BindingEvent[] = [];
    for (const player of this.players.values()) {
      if (player.state !== "lost") continue;
      if (player.lastSeenAt === null || now - player.lastSeenAt < this.orphanAfterMs) continue;
      player.state = "orphaned";
      events.push({ participantId: player.participantId, gid: null, state: "orphaned", reason: "orphaned" });
    }
    return events;
  }

  /**
   * Lost and orphaned players who could plausibly be this GID: close enough,
   * and seen recently enough. Exposed for the operator dashboard, which shows
   * why an ambiguous GID was not auto-bound.
   */
  plausibleRebindCandidates(gid: number, now: number): readonly string[] {
    const position = this.liveGids.get(gid);
    if (position === undefined || position === null) return [];
    const candidates: string[] = [];
    for (const player of this.players.values()) {
      if (player.state === "bound") continue;
      if (player.lastX === null || player.lastY === null || player.lastSeenAt === null) continue;
      if (now - player.lastSeenAt > this.rebindMaxGapMs) continue;
      const dx = player.lastX - position.x;
      const dy = player.lastY - position.y;
      if (Math.hypot(dx, dy) > this.rebindMaxDistance) continue;
      candidates.push(player.participantId);
    }
    return candidates;
  }

  private tryAutoRebind(gid: number, now: number): BindingEvent | null {
    const candidates = this.plausibleRebindCandidates(gid, now);
    // Exactly one, or nothing. Never guess between two people.
    if (candidates.length !== 1) return null;
    return this.bind(candidates[0]!, gid, "auto-rebind", now);
  }

  private bind(participantId: string, gid: number, reason: BindingReason, now: number): BindingEvent {
    const player = this.players.get(participantId) ?? {
      participantId,
      gid: null,
      state: "lost" as BindingState,
      lastX: null,
      lastY: null,
      lastSeenAt: null,
    };
    if (player.gid !== null) this.byGid.delete(player.gid);

    const position = this.liveGids.get(gid) ?? null;
    player.gid = gid;
    player.state = "bound";
    player.lastSeenAt = now;
    if (position !== null) {
      player.lastX = position.x;
      player.lastY = position.y;
    }
    this.players.set(participantId, player);
    this.byGid.set(gid, participantId);
    return { participantId, gid, state: "bound", reason };
  }

  private markLost(player: Player, now: number): BindingEvent {
    if (player.gid !== null) this.byGid.delete(player.gid);
    player.gid = null;
    player.state = "lost";
    player.lastSeenAt = now;
    return { participantId: player.participantId, gid: null, state: "lost", reason: "lost" };
  }
}
