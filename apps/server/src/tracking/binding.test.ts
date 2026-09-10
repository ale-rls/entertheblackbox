import { describe, expect, it } from "vitest";
import { BindingError, BindingRegistry } from "./binding.js";

const at = (x: number, y: number) => ({ x, y });

/**
 * Report a body the way the adapter actually does: a `join` carrying no
 * position, then a `position`. Calling gidSeen once with a position is a shape
 * the phase engine never produces, and testing that way hid a bug where
 * auto-rebind could not fire at all through the real path.
 */
function sight(registry: BindingRegistry, gid: number, position: { x: number; y: number }, now: number) {
  registry.gidSeen(gid, null, now);
  return registry.gidSeen(gid, position, now);
}

/** Registry with a body already visible at a known spot. */
function withVisibleGid(gid: number, position: { x: number; y: number }, now = 1_000) {
  const registry = new BindingRegistry();
  sight(registry, gid, position, now);
  return registry;
}

describe("BindingRegistry", () => {
  it("attributes a claimed gid to the phone, and an unclaimed one to nobody", () => {
    const registry = withVisibleGid(7, at(0.5, 0.5));
    expect(registry.participantForGid(7)).toBeNull();

    registry.claim("phone-a", 7, 1_000);
    expect(registry.participantForGid(7)).toBe("phone-a");
    expect(registry.gidForParticipant("phone-a")).toBe(7);
  });

  it("refuses a claim on a gid nobody can see", () => {
    const registry = new BindingRegistry();
    expect(() => registry.claim("phone-a", 99, 1_000)).toThrow(BindingError);
  });

  it("refuses a second claim so a double-submit cannot hijack a live binding", () => {
    const registry = withVisibleGid(7, at(0.5, 0.5));
    sight(registry, 8, at(0.9, 0.9), 1_000);
    registry.claim("phone-a", 7, 1_000);
    expect(() => registry.claim("phone-a", 8, 1_100)).toThrow(BindingError);
  });

  it("refuses a claim on a gid someone else already holds", () => {
    const registry = withVisibleGid(7, at(0.5, 0.5));
    registry.claim("phone-a", 7, 1_000);
    expect(() => registry.claim("phone-b", 7, 1_100)).toThrow(BindingError);
  });

  it("marks a player lost when their body disappears", () => {
    const registry = withVisibleGid(7, at(0.5, 0.5));
    registry.claim("phone-a", 7, 1_000);
    expect(registry.gidLeft(7, 2_000)).toMatchObject({ participantId: "phone-a", state: "lost" });
    expect(registry.participantForGid(7)).toBeNull();
    expect(registry.stateOf("phone-a")).toBe("lost");
  });

  it("auto-rebinds a lost player when one nearby body reappears", () => {
    const registry = withVisibleGid(7, at(0.5, 0.5));
    registry.claim("phone-a", 7, 1_000);
    registry.gidLeft(7, 2_000);

    // TrackingBox gives the same person a new gid after an occlusion.
    const event = sight(registry, 12, at(0.52, 0.51), 3_000);
    expect(event).toMatchObject({ participantId: "phone-a", gid: 12, reason: "auto-rebind" });
    expect(registry.participantForGid(12)).toBe("phone-a");
  });

  it("refuses to guess when two lost players are both plausible", () => {
    const registry = new BindingRegistry();
    sight(registry, 1, at(0.50, 0.50), 1_000);
    sight(registry, 2, at(0.52, 0.50), 1_000);
    registry.claim("phone-a", 1, 1_000);
    registry.claim("phone-b", 2, 1_000);
    registry.gidLeft(1, 2_000);
    registry.gidLeft(2, 2_000);

    // A new body between the two. Binding either one has a 50% chance of
    // sending someone else's audio to the wrong person, so bind neither.
    expect(sight(registry, 3, at(0.51, 0.50), 2_500)).toBeNull();
    expect(registry.plausibleRebindCandidates(3, 2_500)).toEqual(["phone-a", "phone-b"]);
    expect(registry.participantForGid(3)).toBeNull();
    expect(registry.stateOf("phone-a")).toBe("lost");
  });

  it("does not rebind a body that appears too far away", () => {
    const registry = withVisibleGid(7, at(0.1, 0.1));
    registry.claim("phone-a", 7, 1_000);
    registry.gidLeft(7, 2_000);
    expect(sight(registry, 12, at(0.9, 0.9), 2_500)).toBeNull();
  });

  it("does not rebind after too long a gap, even if the body is close", () => {
    const registry = withVisibleGid(7, at(0.5, 0.5));
    registry.claim("phone-a", 7, 1_000);
    registry.gidLeft(7, 2_000);
    expect(sight(registry, 12, at(0.5, 0.5), 2_000 + 9_000)).toBeNull();
  });

  it("does not treat an already-bound gid as a rebind candidate", () => {
    // A heartbeat snapshot resends every visible gid, not only new ones.
    const registry = withVisibleGid(7, at(0.5, 0.5));
    registry.claim("phone-a", 7, 1_000);
    expect(registry.gidSeen(7, at(0.5, 0.5), 1_500)).toBeNull();
    expect(registry.participantForGid(7)).toBe("phone-a");
  });

  it("auto-rebinds through the adapter's join-then-position sequence", () => {
    // Regression: the arrival carries no position, so matching only on first
    // sighting could never measure distance and rebinding never fired at all.
    const registry = withVisibleGid(7, at(0.5, 0.5));
    registry.claim("phone-a", 7, 1_000);
    registry.gidLeft(7, 2_000);

    expect(registry.gidSeen(12, null, 2_500)).toBeNull();
    expect(registry.gidSeen(12, at(0.51, 0.50), 2_500)).toMatchObject({
      participantId: "phone-a", gid: 12, reason: "auto-rebind",
    });
  });

  it("tries the rebind match once per gid, not on every heartbeat", () => {
    const registry = withVisibleGid(7, at(0.9, 0.9));
    registry.claim("phone-a", 7, 1_000);
    registry.gidLeft(7, 2_000);
    // Far away on arrival, so no match; a later position must not re-open it.
    sight(registry, 12, at(0.1, 0.1), 2_500);
    expect(registry.gidSeen(12, at(0.9, 0.9), 2_600)).toBeNull();
    expect(registry.stateOf("phone-a")).toBe("lost");
  });

  it("orphans a player who stays lost past the threshold", () => {
    const registry = withVisibleGid(7, at(0.5, 0.5));
    registry.claim("phone-a", 7, 1_000);
    registry.gidLeft(7, 2_000);

    expect(registry.tick(2_500)).toEqual([]);
    expect(registry.tick(6_000)).toEqual([
      { participantId: "phone-a", gid: null, state: "orphaned", reason: "orphaned" },
    ]);
    expect(registry.stateOf("phone-a")).toBe("orphaned");
    // Orphaning is reported once, not on every subsequent tick.
    expect(registry.tick(7_000)).toEqual([]);
  });

  it("lets an operator take a gid from another player, who then goes lost", () => {
    const registry = withVisibleGid(7, at(0.5, 0.5));
    registry.claim("phone-a", 7, 1_000);

    expect(registry.operatorRebind("phone-b", 7, 2_000)).toMatchObject({
      participantId: "phone-b", gid: 7, reason: "operator",
    });
    expect(registry.participantForGid(7)).toBe("phone-b");
    expect(registry.stateOf("phone-a")).toBe("lost");
  });

  it("lists everyone currently unbound for the operator dashboard", () => {
    const registry = withVisibleGid(7, at(0.5, 0.5));
    sight(registry, 8, at(0.9, 0.9), 1_000);
    registry.claim("phone-a", 7, 1_000);
    registry.claim("phone-b", 8, 1_000);
    expect(registry.unboundParticipants()).toEqual([]);
    registry.gidLeft(8, 2_000);
    expect(registry.unboundParticipants()).toEqual(["phone-b"]);
  });
});
