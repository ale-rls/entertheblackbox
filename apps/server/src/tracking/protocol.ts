/**
 * Wire format of TrackingBox's `/ws` stream.
 *
 * Read from the vendored source rather than inferred: see
 * `services/trackingbox/src/audience_tracker/api/app.py` (the `/ws` handler)
 * and `statestore.py` (`publish` / `get_snapshot`).
 *
 * Two message shapes share the socket and are told apart by `type`:
 *
 *  - `{"type": "snapshot", "data": {...}}` is sent once on connect and again
 *    on every heartbeat interval where nothing changed. It is a complete
 *    picture, so it can always be taken as truth.
 *  - Anything else is a bare per-GID change event with no `type` field at all,
 *    in the `AudienceState.summary()` shape.
 *
 * `floor` is a normalized 0..1 pair (config `floor_space: "normalized"`), which
 * is the coordinate space the vote engine already works in, so positions need
 * no rescaling. `floor` is null and `floor_valid` false whenever floor
 * projection could not resolve — including for a GID that has dropped out of
 * the snapshot entirely, which TrackingBox publishes as an explicit
 * `visible: false` event rather than as a silent absence.
 */

/** One tracked body, as it appears in a change event. */
export type TrackedBody = {
  gid: number;
  visible: boolean;
  /** Normalized 0..1 floor position, or null when projection failed. */
  floor: readonly [number, number] | null;
  floorValid: boolean;
};

export type TrackingMessage =
  | { kind: "snapshot"; bodies: readonly TrackedBody[] }
  | { kind: "change"; body: TrackedBody };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseFloorPoint(value: unknown): readonly [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [x, y] = value;
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return [x, y];
}

function parseBody(value: unknown): TrackedBody | null {
  if (!isRecord(value)) return null;
  const { gid } = value;
  if (typeof gid !== "number" || !Number.isInteger(gid)) return null;
  const floor = parseFloorPoint(value.floor);
  // Trust `floor_valid` only when a usable point actually came with it; a
  // truthy flag beside a null point would otherwise produce NaN positions.
  const floorValid = value.floor_valid === true && floor !== null;
  return {
    gid,
    visible: value.visible === true,
    floor,
    floorValid,
  };
}

/**
 * Parse one decoded JSON frame. Returns null for anything unrecognised —
 * heartbeats of other shapes, future fields, or malformed frames — so a
 * protocol change upstream degrades to ignored messages rather than a crash
 * mid-show.
 */
export function parseTrackingMessage(value: unknown): TrackingMessage | null {
  if (!isRecord(value)) return null;

  if (value.type === "snapshot") {
    const data = value.data;
    if (!isRecord(data)) return null;
    const people = data.people;
    if (!Array.isArray(people)) return null;
    const bodies: TrackedBody[] = [];
    for (const person of people) {
      const body = parseBody(person);
      if (body !== null) bodies.push(body);
    }
    return { kind: "snapshot", bodies };
  }

  // Bare change event: no `type`, but always carries a gid.
  const body = parseBody(value);
  return body === null ? null : { kind: "change", body };
}

/** Participant id for a tracked body. Namespaced so it can never collide with
 * a phone participant's clientId. */
export function participantIdForGid(gid: number): string {
  return `gid:${gid}`;
}
