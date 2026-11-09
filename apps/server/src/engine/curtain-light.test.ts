import { describe, expect, it } from "vitest";
import { scenarioSchema } from "@entertheblackbox/scenario";
import { parseServerMessage, type ClientToServerMessage } from "@entertheblackbox/protocol";
import type { WebSocket } from "ws";
import { ParticipantRegistry } from "../admission/registry.js";
import { GroupManager } from "../groups/group-manager.js";
import { PhaseEngine } from "./phase-engine.js";
import type { FinalVoteSnapshot } from "../votes/index.js";

class Socket {
  readyState = 1;
  sent: any[] = [];
  send(raw: string) {
    expect(parseServerMessage(raw).ok).toBe(true);
    this.sent.push(JSON.parse(raw));
  }
  close() { this.readyState = 3; }
  terminate() { this.close(); }
  get ws() { return this as unknown as WebSocket; }
  get snapshot() { return this.sent.filter((m) => m.t === "phase" || m.t === "snapshot").at(-1); }
}

const scenario = scenarioSchema.parse({
  version: "curtain-test", entryPhaseId: "split",
  groups: [
    { id: "theater", label: "Theater", votingMethod: "phone-cursor", voteTreatment: "curtain-light" },
    { id: "ki", label: "KI", votingMethod: "phone-cursor" },
  ],
  curtainLight: { src: "curtain.mp4" },
  phases: [
    { kind: "idle", id: "idle" },
    { kind: "group-branch", id: "split", durationMs: 100, assignment: { type: "self-select" },
      branches: [{ groupId: "theater", next: "vote" }, { groupId: "ki", next: "ki-vote" }], next: "together" },
    ...["vote", "ki-vote"].map((id) => ({
      kind: "position-question", id, text: "Choose", durationMs: 1_000, freezeMs: 0,
      connectionStaleAfterMs: 5_000, showLiveCounts: false, answerColors: { min: "#112233" },
      field: { type: "two-quadrant", axis: "x", variant: "split", labels: { minLabel: "No", maxLabel: "Yes" } },
      next: { type: "quadrant-plurality", map: { min: "together", max: "together" }, tie: "together", empty: "together", countedStatuses: ["valid", "stale", "disconnected"] },
    })),
    { kind: "narration", id: "together", text: "Together", durationMs: 1_000, next: "idle" },
  ],
});

const sharedScenario = scenarioSchema.parse({
  version: "curtain-shared-test", entryPhaseId: "shared-vote",
  groups: [
    { id: "ki", label: "KI", votingMethod: "physical" },
    { id: "theater", label: "Theater", votingMethod: "phone-cursor" },
  ],
  curtainLight: { src: "curtain.mp4" },
  phases: [
    { kind: "idle", id: "idle" },
    ...[["shared-vote", "plain-vote", true], ["plain-vote", "idle", false]].map(([id, target, curtain]) => ({
      kind: "position-question", id, text: "Choose", durationMs: 1_000, freezeMs: 0,
      connectionStaleAfterMs: 5_000, showLiveCounts: false, ...(curtain ? { curtainLightVote: true, answerColors: { rot: "#e5484d" } } : {}),
      // Four colour fields with an unlit gap between them, so cursors can appear without voting.
      field: { type: "polygon-zones", zones: ([["rot", 0, 0], ["blau", 0.53, 0], ["gelb", 0, 0.53], ["gruen", 0.53, 0.53]] as const).map(([zid, x, y]) => ({
        id: zid, label: zid, points: [{ x, y }, { x: x + 0.47, y }, { x: x + 0.47, y: y + 0.47 }, { x, y: y + 0.47 }],
      })) },
      next: { type: "fixed", target },
    })),
  ],
});

function setup(value = scenario) {
  let now = 0;
  const registry = new ParticipantRegistry(10);
  const groups = new GroupManager(value);
  const votes: FinalVoteSnapshot[] = [];
  const engine = new PhaseEngine({
    scenario: value, registry, now: () => now,
    installationId: "inst", roomId: "room", showId: "show", displayToken: "secret",
    autoStartOnFirstParticipant: false, sessionIdFactory: () => "visit",
    onCheckpoint: (event) => {
      if (event.reason === "session-start" || event.reason === "admin-restart") groups.beginSession(registry.values().map((p) => p.clientId));
    },
    groupSelection: {
      current: (id) => groups.groupFor(id), select: (id, group) => groups.assign(id, group),
      method: (id) => groups.votingMethodFor(id),
      begin: (phase, ids) => { groups.applyBranch(phase, ids); return ids; },
    },
    onVoteSnapshotEnqueued: (snapshot) => votes.push(snapshot),
  });
  const send = (socket: Socket, message: ClientToServerMessage) => engine.handleClientMessage(message, socket.ws);
  const display = (groupId?: string) => {
    const socket = new Socket();
    send(socket, { t: "display_join", v: 2, clientVersion: "test", installationId: "inst", roomId: "room", displayToken: "secret", ...(groupId === undefined ? {} : { groupId }) });
    return socket;
  };
  const phone = (id: string) => {
    const socket = new Socket();
    const result = registry.admit({ clientId: id, participantLease: id, name: id, leaseExpiresAt: 100_000, socket: socket.ws, now });
    if (!result.ok) throw new Error("admission failed");
    groups.ensureParticipant(id);
    engine.participantJoined(socket.ws, result.participant);
    return socket;
  };
  const choose = (phone: Socket, groupId: string) => send(phone, { t: "group_selection", v: 2, sessionId: phone.snapshot.sessionId, phaseEpoch: phone.snapshot.phaseEpoch, groupId });
  let seq = 0;
  const touch = (phone: Socket, x: number, y: number, start = false) => send(phone, {
    t: "input", v: 2, sessionId: "visit", phaseEpoch: phone.snapshot.phaseEpoch, seq: ++seq, x, y, ...(start ? { touch: "start" as const } : {}),
  });
  const tick = (time: number) => { now = time; engine.tick(now); };
  return { engine, votes, display, phone, choose, touch, tick, setNow: (time: number) => { now = time; } };
}

describe("curtain-light votes", () => {
  it("applies the treatment only on the curtain group's timeline", () => {
    const h = setup();
    const theaterDisplay = h.display("theater");
    const kiDisplay = h.display("ki");
    const one = h.phone("one"); const two = h.phone("two");
    h.engine.adminStart(); h.choose(one, "theater"); h.choose(two, "ki"); h.tick(100);
    const phase = theaterDisplay.snapshot.phase;
    expect(phase.id).toBe("vote");
    expect(phase.voteTreatment.type).toBe("curtain-light");
    expect(phase.voteTreatment.answerColors.min).toBe("#112233");
    expect(phase.voteTreatment.entry).toEqual({ x: 0.5, y: 0.5 });
    expect(phase.field.neutralGap).toBeGreaterThan(0);
    expect(kiDisplay.snapshot.phase.voteTreatment).toBeUndefined();
    expect(kiDisplay.snapshot.phase.field.neutralGap).toBeUndefined();
    h.engine.stop();
  });

  it("enters at the neutral point without voting, then steers relative to the cursor", () => {
    const h = setup();
    const display = h.display("theater");
    const one = h.phone("one"); const two = h.phone("two");
    h.engine.adminStart(); h.choose(one, "theater"); h.choose(two, "theater"); h.tick(100);

    // First touch anywhere on the phone only reveals the cursor at the centre.
    h.setNow(200); h.touch(one, 0.95, 0.9, true);
    // A new touch anchors; dragging left by 0.35 moves the cursor from 0.5 to 0.15.
    h.setNow(400); h.touch(one, 0.9, 0.9, true);
    h.setNow(420); h.touch(one, 0.55, 0.9);
    // Participant two touches once and never moves: shown, but not counted.
    h.setNow(430); h.touch(two, 0.1, 0.1, true);
    h.tick(900);
    const status = display.sent.filter((m) => m.t === "question_status").at(-1);
    expect(status.quadrantCounts).toEqual({ min: 1, max: 0 });

    h.tick(1_200);
    const final = h.votes.find((snapshot) => snapshot.questionId === "vote")!;
    const vote = final.votes.find((v) => v.participantId === "one")!;
    expect(vote.x).toBeCloseTo(0.15);
    expect(vote.y).toBeCloseTo(0.5);
    expect(final.votes.find((v) => v.participantId === "two")!.x).toBeNull();
    h.engine.stop();
  });

  it("draws a flagged vote on the shared timeline as curtain light, entering at a neutral point", () => {
    const h = setup(sharedScenario);
    const main = h.display();
    const late = h.phone("late");
    h.engine.adminStart(); h.tick(10);
    const phase = main.snapshot.phase;
    expect(phase.id).toBe("shared-vote");
    expect(phase.voteTreatment.type).toBe("curtain-light");
    expect(phase.voteTreatment.answerColors.rot).toBe("#e5484d");
    expect(phase.voteTreatment.entry).not.toBeNull();

    // The first touch only reveals the cursor; the participant has no group (joined late).
    h.setNow(100); h.touch(late, 0.9, 0.9, true);
    h.setNow(200); h.touch(late, 0.9, 0.9, true);
    h.setNow(220); h.touch(late, 0.6, 0.6);
    h.tick(1_200);
    const vote = h.votes.find((snapshot) => snapshot.questionId === "shared-vote")!.votes[0]!;
    expect(vote.x).not.toBeNull();
    expect(vote.x!).toBeLessThan(0.5);

    expect(main.snapshot.phase.id).toBe("plain-vote");
    expect(main.snapshot.phase.voteTreatment).toBeUndefined();
    h.engine.stop();
  });

  it("keeps ordinary absolute input on other groups' votes", () => {
    const h = setup();
    const display = h.display("ki");
    const one = h.phone("one");
    h.engine.adminStart(); h.choose(one, "ki"); h.tick(100);
    h.setNow(200); h.touch(one, 0.9, 0.5, true);
    h.tick(1_200);
    expect(h.votes.find((snapshot) => snapshot.questionId === "ki-vote")!.votes[0]!.x).toBeCloseTo(0.9);
    expect(display.snapshot).toBeDefined();
    h.engine.stop();
  });
});
