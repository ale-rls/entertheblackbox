import { parseTrackingMessage, type TrackedBody, type TrackingMessage } from "./protocol.js";

/**
 * What the caller should do about one tracked body, so the socket handling and
 * the engine wiring can be tested apart from each other.
 *
 * `leave` covers both a body that walked out of frame and one lost to a
 * TrackingBox restart. The vote engine already models the difference between
 * "connected but hasn't moved" and "gone", so nothing new is needed downstream.
 */
export type TrackingAction =
  | { type: "join"; gid: number }
  | { type: "position"; gid: number; x: number; y: number }
  | { type: "leave"; gid: number };

/**
 * Folds the `/ws` stream into a set of present bodies.
 *
 * A snapshot is always taken as the complete truth rather than merged into
 * prior state. TrackingBox reassigns GIDs from scratch when it restarts, so
 * patching would silently attribute one person's position to another. Treating
 * every snapshot as authoritative makes a restart and a dropped connection the
 * same code path, which is the one that gets exercised.
 */
export class TrackedAudience {
  /** Bodies believed to be visible right now. Presence is the whole state; a
   * body's position is not retained because the vote engine already holds it. */
  private readonly present = new Set<number>();

  /** Bodies currently visible, for headcount and diagnostics. */
  get size(): number {
    return this.present.size;
  }

  gids(): readonly number[] {
    return [...this.present];
  }

  /** Apply one decoded JSON frame. Unrecognised frames produce no actions. */
  ingest(raw: unknown): readonly TrackingAction[] {
    const message = parseTrackingMessage(raw);
    if (message === null) return [];
    return this.apply(message);
  }

  apply(message: TrackingMessage): readonly TrackingAction[] {
    if (message.kind === "snapshot") return this.applySnapshot(message.bodies);
    return this.applyBody(message.body);
  }

  /**
   * Drop every body. Called when the socket closes: until a fresh snapshot
   * arrives we cannot claim anyone is still standing anywhere.
   */
  reset(): readonly TrackingAction[] {
    const actions: TrackingAction[] = [...this.present].map((gid) => ({ type: "leave", gid }));
    this.present.clear();
    return actions;
  }

  private applySnapshot(bodies: readonly TrackedBody[]): readonly TrackingAction[] {
    const actions: TrackingAction[] = [];
    const seen = new Set<number>();

    for (const body of bodies) {
      if (!body.visible) continue;
      seen.add(body.gid);
      actions.push(...this.applyBody(body));
    }

    const departed = [...this.present].filter((gid) => !seen.has(gid));
    for (const gid of departed) {
      this.present.delete(gid);
      actions.push({ type: "leave", gid });
    }
    return actions;
  }

  private applyBody(body: TrackedBody): readonly TrackingAction[] {
    if (!body.visible) {
      if (!this.present.delete(body.gid)) return [];
      return [{ type: "leave", gid: body.gid }];
    }

    const actions: TrackingAction[] = [];
    if (!this.present.has(body.gid)) {
      this.present.add(body.gid);
      actions.push({ type: "join", gid: body.gid });
    }
    // A body with no usable floor projection is present but unplaced. It stays
    // joined so it counts toward the audience, and simply records no position,
    // which the vote engine already treats as never-moved.
    if (body.floorValid && body.floor !== null) {
      actions.push({ type: "position", gid: body.gid, x: body.floor[0], y: body.floor[1] });
    }
    return actions;
  }
}
