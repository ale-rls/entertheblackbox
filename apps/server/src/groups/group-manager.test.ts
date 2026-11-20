import { describe, expect, it } from "vitest";
import { scenarioSchema, type GroupBranchPhase, type Scenario } from "@entertheblackbox/scenario";
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
  it("assigns by client at join, also mid-show, and manual splits keep it", () => {
    const groups = new GroupManager({ ...scenario, groupByClient: { native: "c", web: "b" } });
    groups.ensureParticipant("tablet", "native");
    groups.beginSession(["tablet"]);
    expect(groups.groupFor("tablet")).toBe("c");
    // Late joiner after the session started.
    expect(groups.ensureParticipant("phone", "web")).toBe("b");
    groups.applyBranch({ ...branch({ type: "manual", fallbackGroupId: "a" }), branches: [{ groupId: "c", weight: 1 }, { groupId: "b", weight: 1 }] }, ["tablet", "phone"]);
    expect(groups.snapshot(["tablet", "phone"])).toEqual([{ participantId: "tablet", groupId: "c" }, { participantId: "phone", groupId: "b" }]);
    // Unknown client falls back to the balanced lobby groups.
    expect(["a", "b"]).toContain(groups.ensureParticipant("unknown"));
  });

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

  it("records a tablet's answer on the field its own path counted, when another path runs the same question on the curtain", () => {
    const field = { type: "two-quadrant", axis: "x", variant: "spectrum", labels: { minLabel: "L", maxLabel: "R" } } as const;
    const shared = scenarioSchema.parse({
      version: "shared-question", entryPhaseId: "idle", cyclesAllowed: false,
      groups: [{ id: "theater", label: "Theater", voteTreatment: "curtain-light" }, { id: "ki", label: "KI" }],
      curtainLight: { src: "curtain.mp4" },
      phases: [
        { kind: "idle", id: "idle" },
        { kind: "group-branch", id: "split", durationMs: 1_000, assignment: { type: "manual", fallbackGroupId: "ki" },
          branches: [{ groupId: "theater", next: "question" }, { groupId: "ki", next: "question" }], next: "idle" },
        { kind: "position-question", id: "question", text: "Choose", durationMs: 1_000, freezeMs: 0, connectionStaleAfterMs: 1_000,
          showLiveCounts: false, field, next: { type: "fixed", target: "idle" } },
      ],
    });
    const groups = new GroupManager(shared);
    groups.beginSession(["tablet"]);
    // The KI path counted this right-hand press on the plain field; the curtain's neutral gap does not apply to it.
    groups.recordAnswers("question", field, {
      sessionId: "s", questionId: "question", phaseEpoch: 1, recordedAt: 1,
      votes: [{ sessionId: "s", questionId: "question", participantId: "tablet", x: 0.5, y: 0.5, status: "valid", lastInputAt: 1, lastHeartbeatAt: 1, currentPhaseStartedAt: 0, currentPhaseDeadline: 2, recordedAt: 1 }],
    }, field);
    groups.applyBranch(branch({ type: "vote", questionId: "question", map: { min: "a", max: "b" }, fallbackGroupId: "c" }), ["tablet"]);
    expect(groups.groupFor("tablet")).toBe("b");
  });

  it("routes by the latest run of a question: no answer or a neutral one there clears an earlier answer", () => {
    const field = { type: "two-quadrant", axis: "x", variant: "spectrum", labels: { minLabel: "L", maxLabel: "R" } } as const;
    const vote = (participantId: string, x: number | null) => ({ sessionId: "s", questionId: "question", participantId, x, y: x === null ? null : 0.5,
      status: "valid" as const, lastInputAt: 1, lastHeartbeatAt: 1, currentPhaseStartedAt: 0, currentPhaseDeadline: 2, recordedAt: 1 });
    const groups = new GroupManager(scenario);
    groups.beginSession(["moved", "silent", "kept"]);
    groups.recordAnswers("question", field, { sessionId: "s", questionId: "question", phaseEpoch: 1, recordedAt: 1,
      votes: [vote("moved", 0.1), vote("silent", 0.1), vote("kept", 0.9)] });
    // The same question runs again on a curtain path: one lands in the neutral gap, one doesn't vote, one isn't there.
    const gap = { type: "polygon-zones", zones: [{ id: "min", label: "L", points: [{ x: 0, y: 0 }, { x: 0.3, y: 0 }, { x: 0.3, y: 1 }, { x: 0, y: 1 }] }] } as const;
    groups.recordAnswers("question", field, { sessionId: "s", questionId: "question", phaseEpoch: 2, recordedAt: 2,
      votes: [vote("moved", 0.5), vote("silent", null)] }, gap as never);
    groups.applyBranch(branch({ type: "vote", questionId: "question", map: { min: "a", max: "b" }, fallbackGroupId: "c" }), ["moved", "silent", "kept"]);
    expect(groups.groupFor("moved")).toBe("c");
    expect(groups.groupFor("silent")).toBe("c");
    expect(groups.groupFor("kept")).toBe("b");
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

it('preserves admission audience choices when entering the show', () => {
  const scenario = scenarioSchema.parse({ version:'admission-test', entryPhaseId:'intro', groups:[{id:'a',label:'A'},{id:'b',label:'B'}], initialGroupIds:['a','b'], phases:[{kind:'idle',id:'idle'},{kind:'narration',id:'intro',text:'Welcome',durationMs:1000,next:'idle'}] });
  const manager=new GroupManager(scenario);manager.assign('one','b');manager.assign('two','b');manager.beginSession(['one','two'],true);expect(manager.groupFor('one')).toBe('b');expect(manager.groupFor('two')).toBe('b');
});

it('stops counting a handed-over occupant when balancing the next participant', () => {
  const scenario = scenarioSchema.parse({ version:'retire-test', entryPhaseId:'intro', groups:[{id:'a',label:'A'},{id:'b',label:'B'}], initialGroupIds:['a','b'], phases:[{kind:'idle',id:'idle'},{kind:'narration',id:'intro',text:'Welcome',durationMs:1000,next:'idle'}] });
  const manager = new GroupManager(scenario);
  for (const id of ['old-1', 'old-2', 'stays']) manager.assign(id, 'a');
  for (const id of ['b-1', 'b-2']) manager.assign(id, 'b');
  // Without retirement group a counts 3 against b's 2 and the replacement would land in b.
  manager.retireParticipant('old-1'); manager.retireParticipant('old-2');
  expect(manager.groupFor('old-1')).toBeNull();
  expect(manager.ensureParticipant('replacement')).toBe('a');
});
