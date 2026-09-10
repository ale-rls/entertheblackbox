import { describe, expect, it } from "vitest";
import { parseTrackingMessage, participantIdForGid } from "./protocol.js";
import { TrackedAudience, type TrackingAction } from "./audience.js";
import { BindingRegistry } from "./binding.js";

/**
 * Frames copied from the shapes TrackingBox actually emits — see
 * `services/trackingbox/src/audience_tracker/statestore.py` (`publish` builds
 * change events from `AudienceState.summary()`, `get_snapshot` builds the
 * snapshot) and the `/ws` handler in `api/app.py`.
 */
const snapshotFrame = (people: unknown[]) => ({
  type: "snapshot",
  data: {
    timestamp: "2026-09-10T13:00:00Z",
    active_people: people.length,
    zone_counts: {},
    people,
  },
});

const person = (gid: number, floor: [number, number] | null, visible = true) => ({
  gid,
  visible,
  center: [0.5, 0.5],
  bbox: [0, 0, 10, 10],
  floor,
  floor_valid: floor !== null,
  zone: null,
});

describe("parseTrackingMessage", () => {
  it("reads a snapshot frame", () => {
    const message = parseTrackingMessage(snapshotFrame([person(17, [0.43, 0.71])]));
    expect(message).toEqual({
      kind: "snapshot",
      bodies: [{ gid: 17, visible: true, floor: [0.43, 0.71], floorValid: true }],
    });
  });

  it("reads a bare change event, which carries no type field", () => {
    expect(parseTrackingMessage(person(4, [0.1, 0.2]))).toEqual({
      kind: "change",
      body: { gid: 4, visible: true, floor: [0.1, 0.2], floorValid: true },
    });
  });

  it("reads the explicit gone event published when a gid drops out", () => {
    expect(parseTrackingMessage(person(9, null, false))).toEqual({
      kind: "change",
      body: { gid: 9, visible: false, floor: null, floorValid: false },
    });
  });

  it("refuses floor_valid without a usable point, which would produce NaN positions", () => {
    const message = parseTrackingMessage({ gid: 3, visible: true, floor: null, floor_valid: true });
    expect(message).toMatchObject({ kind: "change", body: { floorValid: false, floor: null } });
  });

  it("ignores frames it does not recognise rather than throwing mid-show", () => {
    expect(parseTrackingMessage({ type: "metrics", data: {} })).toBeNull();
    expect(parseTrackingMessage({ gid: "17" })).toBeNull();
    expect(parseTrackingMessage(null)).toBeNull();
    expect(parseTrackingMessage([])).toBeNull();
    expect(parseTrackingMessage({ type: "snapshot", data: { people: "nope" } })).toBeNull();
  });

  it("namespaces participant ids so a gid cannot collide with a phone clientId", () => {
    expect(participantIdForGid(17)).toBe("gid:17");
  });
});

describe("TrackedAudience", () => {
  it("joins and places a body from a snapshot", () => {
    const audience = new TrackedAudience();
    expect(audience.ingest(snapshotFrame([person(1, [0.25, 0.75])]))).toEqual([
      { type: "join", gid: 1 },
      { type: "position", gid: 1, x: 0.25, y: 0.75 },
    ]);
    expect(audience.size).toBe(1);
  });

  it("emits position without re-joining a body already present", () => {
    const audience = new TrackedAudience();
    audience.ingest(person(1, [0.1, 0.1]));
    expect(audience.ingest(person(1, [0.9, 0.9]))).toEqual([
      { type: "position", gid: 1, x: 0.9, y: 0.9 },
    ]);
  });

  it("keeps an unplaced body joined so it still counts as present", () => {
    const audience = new TrackedAudience();
    // Floor projection can fail while the person is plainly visible.
    expect(audience.ingest(person(2, null))).toEqual([{ type: "join", gid: 2 }]);
    expect(audience.size).toBe(1);
  });

  it("treats a snapshot as truth and drops bodies missing from it", () => {
    const audience = new TrackedAudience();
    audience.ingest(snapshotFrame([person(1, [0.1, 0.1]), person(2, [0.2, 0.2])]));
    // A TrackingBox restart reassigns gids from scratch; patching prior state
    // would attribute gid 1's position to a different person.
    const actions = audience.ingest(snapshotFrame([person(3, [0.3, 0.3])]));
    expect(actions).toEqual([
      { type: "leave", gid: 1 },
      { type: "leave", gid: 2 },
      { type: "join", gid: 3 },
      { type: "position", gid: 3, x: 0.3, y: 0.3 },
    ]);
    expect(audience.gids()).toEqual([3]);
  });

  it("lets a replacement gid rebind when it replaces an old gid in one snapshot", () => {
    const audience = new TrackedAudience();
    const bindings = new BindingRegistry();
    const apply = (actions: readonly TrackingAction[], now: number) => {
      for (const action of actions) {
        if (action.type === "join") bindings.gidSeen(action.gid, null, now);
        if (action.type === "position") bindings.gidSeen(action.gid, { x: action.x, y: action.y }, now);
        if (action.type === "leave") bindings.gidLeft(action.gid, now);
      }
    };

    apply(audience.ingest(snapshotFrame([person(7, [0.5, 0.5])])), 1_000);
    bindings.claim("phone-a", 7, 1_000);

    apply(audience.ingest(snapshotFrame([person(12, [0.52, 0.51])])), 2_000);

    expect(bindings.gidForParticipant("phone-a")).toBe(12);
    expect(bindings.participantForGid(12)).toBe("phone-a");
    expect(bindings.stateOf("phone-a")).toBe("bound");
  });

  it("leaves a body once, not on every repeat of the gone event", () => {
    const audience = new TrackedAudience();
    audience.ingest(person(5, [0.5, 0.5]));
    expect(audience.ingest(person(5, null, false))).toEqual([{ type: "leave", gid: 5 }]);
    expect(audience.ingest(person(5, null, false))).toEqual([]);
  });

  it("drops everyone when the socket closes", () => {
    const audience = new TrackedAudience();
    audience.ingest(snapshotFrame([person(1, [0.1, 0.1]), person(2, [0.2, 0.2])]));
    expect(audience.reset()).toEqual([
      { type: "leave", gid: 1 },
      { type: "leave", gid: 2 },
    ]);
    expect(audience.size).toBe(0);
  });

  it("ignores a body the snapshot reports as not visible", () => {
    const audience = new TrackedAudience();
    expect(audience.ingest(snapshotFrame([person(7, null, false)]))).toEqual([]);
    expect(audience.size).toBe(0);
  });
});
