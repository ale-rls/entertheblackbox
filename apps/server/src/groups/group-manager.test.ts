import { describe, expect, it } from "vitest";
import type { GroupBranchPhase, Scenario } from "@entertheblackbox/scenario";
import { GroupManager } from "./group-manager.js";

const scenario = {
  version: "groups-test", entryPhaseId: "idle", cyclesAllowed: false,
  groups: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }],
  initialGroupIds: ["a", "b"], phases: [{ kind: "idle", id: "idle" }],
} satisfies Scenario;

const branch = (assignment: GroupBranchPhase["assignment"]): GroupBranchPhase => ({
  kind: "group-branch", id: "split", durationMs: 5_000, assignment,
  branches: [{ groupId: "a", weight: 1 }, { groupId: "b", weight: 1 }], next: "idle",
});

describe("GroupManager", () => {
  it("starts with balanced groups and keeps reconnecting participants stable", () => {
    const groups = new GroupManager(scenario);
    groups.beginSession(["one", "two", "three", "four"]);
    const counts = groups.snapshot(["one", "two", "three", "four"]).reduce<Record<string, number>>((all, row) => {
      all[row.groupId!] = (all[row.groupId!] ?? 0) + 1; return all;
    }, {});
    expect(counts).toEqual({ a: 2, b: 2 });
    expect(groups.ensureParticipant("one")).toBe(groups.groupFor("one"));
  });

  it("splits from an earlier individual answer with a fallback", () => {
    const groups = new GroupManager(scenario);
    groups.beginSession(["left", "right", "missing"]);
    groups.recordAnswers("question", { type: "two-quadrant", axis: "x", variant: "spectrum", labels: { minLabel: "L", maxLabel: "R" } }, {
      sessionId: "s", questionId: "question", phaseEpoch: 1, recordedAt: 1,
      votes: [
        { sessionId: "s", questionId: "question", participantId: "left", x: 0.1, y: 0.5, status: "valid", lastInputAt: 1, lastHeartbeatAt: 1, currentPhaseStartedAt: 0, currentPhaseDeadline: 2, recordedAt: 1 },
        { sessionId: "s", questionId: "question", participantId: "right", x: 0.9, y: 0.5, status: "valid", lastInputAt: 1, lastHeartbeatAt: 1, currentPhaseStartedAt: 0, currentPhaseDeadline: 2, recordedAt: 1 },
      ],
    });
    groups.applyBranch(branch({ type: "vote", questionId: "question", map: { min: "a", max: "b" }, fallbackGroupId: "a" }), ["left", "right", "missing"]);
    expect(groups.groupFor("left")).toBe("a");
    expect(groups.groupFor("right")).toBe("b");
    expect(groups.groupFor("missing")).toBe("a");
  });

  it("preserves valid operator choices for manual branching", () => {
    const groups = new GroupManager(scenario);
    groups.beginSession(["one", "two"]);
    groups.assign("one", "b");
    groups.applyBranch(branch({ type: "manual", fallbackGroupId: "a" }), ["one", "two"]);
    expect(groups.groupFor("one")).toBe("b");
  });

  it("clears the source cohort so every participant can self-select", () => {
    const groups = new GroupManager(scenario);
    groups.beginSession(["one", "two"]);
    groups.applyBranch(branch({ type: "self-select" }), ["one", "two"]);
    expect(groups.snapshot(["one", "two"])).toEqual([
      { participantId: "one", groupId: null },
      { participantId: "two", groupId: null },
    ]);
    groups.assign("one", "b");
    expect(groups.groupFor("one")).toBe("b");
  });

  it("switches voting method with the group", () => {
    const groups = new GroupManager({
      ...scenario,
      groups: [
        { id: "a", label: "A", votingMethod: "physical" },
        { id: "b", label: "B", votingMethod: "phone-buttons" },
        { id: "c", label: "C", votingMethod: "phone-cursor" },
      ],
    });
    groups.beginSession(["one"]);
    expect(groups.votingMethodFor("one")).toBe("physical");
    groups.applyBranch(branch({ type: "self-select" }), ["one"]);
    expect(groups.votingMethodFor("one")).toBeUndefined();
    groups.assign("one", "b");
    expect(groups.votingMethodFor("one")).toBe("phone-buttons");
  });
});
