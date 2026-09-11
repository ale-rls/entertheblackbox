import { describe, expect, it } from "vitest";
import { scenarioSchema, validateScenario } from "@entertheblackbox/scenario";
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
  version: "groups-test", entryPhaseId: "split", cyclesAllowed: false,
  groups: [{ id: "a", label: "Actors" }, { id: "b", label: "Builders" }, { id: "c", label: "Chorus" }],
  initialGroupIds: ["a", "b"],
  phases: [
    { kind: "idle", id: "idle" },
    { kind: "group-branch", id: "split", title: "Choose a role", durationMs: 100,
      assignment: { type: "self-select" }, branches: [{ groupId: "a", next: "vote" }, { groupId: "b", next: "film" }, { groupId: "c", next: "film" }], next: "together" },
    { kind: "position-question", id: "vote", text: "Choose", durationMs: 100, freezeMs: 0,
      connectionStaleAfterMs: 1_000, showLiveCounts: true,
      field: { type: "two-quadrant", axis: "x", variant: "split", labels: { minLabel: "No", maxLabel: "Yes" } },
      next: { type: "fixed", target: "together" } },
    { kind: "video", id: "film", src: "film.mp4", expectedDurationMs: 1_000, next: "together" },
    { kind: "video", id: "together", src: "together.mp4", expectedDurationMs: 1_000, next: "idle" },
  ],
});

function setup(value = scenario) {
  let now = 0;
  const registry = new ParticipantRegistry(10);
  const groups = new GroupManager(value);
  const votes: FinalVoteSnapshot[] = [];
  const audio: Array<{ ids: readonly string[]; phase: string }> = [];
  const ended: string[] = [];
  const engine = new PhaseEngine({
    scenario: value, registry, now: () => now,
    installationId: "inst", roomId: "room", showId: "show", displayToken: "secret",
    autoStartOnFirstParticipant: false, sessionIdFactory: () => "visit",
    onCheckpoint: (event) => {
      if (event.reason === "session-start" || event.reason === "admin-restart") groups.beginSession(registry.values().map((p) => p.clientId));
    },
    groupSelection: {
      current: (id) => groups.groupFor(id), select: (id, group) => groups.assign(id, group),
      begin: (phase, ids) => {
        const cohort = ids.filter((id) => !phase.sourceGroupIds || phase.sourceGroupIds.includes(groups.groupFor(id) ?? ""));
        groups.applyBranch(phase, ids);
        return cohort;
      },
    },
    onParticipantPhase: (ids, phase) => audio.push({ ids, phase: phase.id }),
    onVoteSnapshotEnqueued: (snapshot) => votes.push(snapshot),
    onSessionEnded: (event) => ended.push(event.sessionId),
  });
  const send = (socket: Socket, message: ClientToServerMessage) => engine.handleClientMessage(message, socket.ws);
  const display = (groupId?: string, token = "secret") => {
    const socket = new Socket();
    send(socket, { t: "display_join", v: 2, clientVersion: "test", installationId: "inst", roomId: "room", displayToken: token,
      ...(groupId === undefined ? {} : { groupId }) });
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
  const tick = (time: number) => { now = time; engine.tick(now); };
  return { engine, groups, registry, votes, audio, ended, send, display, phone, choose, tick, setNow: (time: number) => { now = time; } };
}

describe("independent group paths", () => {
  it("scopes votes, media completion, reconnects and reunion without advancing the main display", () => {
    const h = setup();
    const main = h.display();
    const screenA = h.display("a");
    const screenB = h.display("b");
    const screenC = h.display("c");
    const a = h.phone("one");
    const b = h.phone("two");
    expect(h.engine.adminStart().ok).toBe(true);
    expect(a.sent.at(-1).groups.map((g: { label: string }) => g.label)).toEqual(["Actors", "Builders", "Chorus"]);
    h.choose(a, "a"); h.choose(b, "b");
    h.tick(100);
    expect(main.snapshot.phase.kind).toBe("group-branch");
    expect(a.snapshot.phase.id).toBe("vote");
    expect(b.snapshot.phase.id).toBe("film");
    expect(screenA.snapshot.phase.id).toBe("vote");
    expect(screenB.snapshot.phase.id).toBe("film");
    expect(screenC.snapshot.phase.kind).toBe("idle");
    const input = { t: "input" as const, v: 2 as const, sessionId: "visit", phaseEpoch: a.snapshot.phaseEpoch, seq: 1, x: 0.8, y: 0.5 };
    h.send(b, input); // Forging another path's epoch must not cast a vote there.
    h.send(a, input);
    h.engine.socketClosed(a.ws);
    h.registry.releaseSocket(a.ws, 110);
    const reconnected = h.phone("one");
    expect(reconnected.snapshot.phase.id).toBe("vote");
    h.tick(200);
    expect(h.votes).toHaveLength(1);
    expect(h.votes[0]!.votes.map((vote) => vote.participantId)).toEqual(["one"]);
    expect(reconnected.snapshot.phase.kind).toBe("group-branch");
    expect(main.snapshot.phase.kind).toBe("group-branch");
    expect(h.audio).toContainEqual({ ids: ["one"], phase: "idle" });
    const endFilm = { t: "video_ended" as const, v: 2 as const, sessionId: "visit", phaseEpoch: b.snapshot.phaseEpoch, phaseId: "film", mediaId: "film.mp4" };
    h.send(main, endFilm); // Main cannot end a group display's media.
    h.tick(201);
    expect(b.snapshot.phase.id).toBe("film");
    const lastLocalEpoch = reconnected.snapshot.phaseEpoch;
    h.send(screenB, endFilm);
    h.tick(202);
    expect(main.snapshot.phase.id).toBe("together");
    expect(reconnected.snapshot.phase.id).toBe("together");
    expect(b.snapshot.phase.id).toBe("together");
    expect(b.snapshot.phaseEpoch).toBeGreaterThan(lastLocalEpoch);
    expect(b.snapshot.sessionId).toBe("visit");
    expect(screenA.snapshot.phase.kind).toBe("idle");
    expect(screenB.snapshot.phase.kind).toBe("idle");
    expect(h.ended).toEqual([]);
    expect(main.readyState).toBe(1);
    h.engine.stop();
  });

  it("closes selection at its deadline, even before the next tick, and keeps unchosen phones unassigned on reconnect", () => {
    const h = setup();
    h.display();
    const a = h.phone("one");
    const b = h.phone("two");
    h.engine.adminStart();
    h.choose(a, "a");
    h.engine.socketClosed(b.ws);
    h.registry.releaseSocket(b.ws);
    const reconnected = h.phone("two");
    expect(h.groups.groupFor("two")).toBeNull();
    h.setNow(100);
    h.choose(reconnected, "b");
    expect(h.groups.groupFor("two")).toBeNull();
    h.tick(100);
    expect(reconnected.sent.at(-1).t).toBe("phase");
    h.choose(a, "b");
    expect(h.groups.groupFor("one")).toBe("a");
    h.engine.adminIdle();
    h.tick(10_000);
    expect(h.engine.lifecycleState).toBe("idle");
    expect(h.ended).toEqual(["visit"]);
    h.engine.stop();
  });

  it("uses media fallback with no group display, and ignores empty groups at reunion", () => {
    const h = setup();
    const main = h.display();
    const b = h.phone("two");
    h.engine.adminStart(); h.choose(b, "b"); h.tick(100);
    h.tick(6_100);
    expect(main.snapshot.phase.id).toBe("together");
    h.engine.stop();
  });

  it("keeps legacy membership-only branches compatible", () => {
    const legacy = scenarioSchema.parse({ ...scenario, phases: scenario.phases.map((phase) => phase.kind === "group-branch"
      ? { ...phase, branches: phase.branches.map(({ next: _next, ...branch }) => branch) } : phase) });
    const h = setup(legacy);
    const main = h.display(); const a = h.phone("one");
    h.engine.adminStart(); h.choose(a, "a"); h.tick(100);
    expect(main.snapshot.phase.id).toBe("together");
    h.engine.stop();
  });

  it("rejects unknown group displays and wrong credentials without replacing main", () => {
    const h = setup();
    const main = h.display();
    expect(h.display("missing").readyState).toBe(3);
    expect(h.display("a", "wrong").readyState).toBe(3);
    expect(main.readyState).toBe(1);
    h.engine.stop();
  });

  it("validates branch-only targets and rejects a second split before reunion", () => {
    expect(validateScenario(scenario).ok).toBe(true);
    const withTarget = (target: string) => scenarioSchema.parse({ ...scenario, phases: scenario.phases.map((phase) => phase.kind === "group-branch"
      ? { ...phase, branches: phase.branches.map((branch) => ({ ...branch, next: target })) } : phase) });
    expect(validateScenario(withTarget("missing")).errors.some((e) => e.code === "broken-target")).toBe(true);
    expect(validateScenario(withTarget("split")).errors.some((e) => e.code === "invalid-group-branch")).toBe(true);
  });
});
