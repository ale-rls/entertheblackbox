import { describe, expect, it } from "vitest";
import { scenarioSchema, validateScenario } from "@entertheblackbox/scenario";
import { parseServerMessage, type ClientToServerMessage } from "@entertheblackbox/protocol";
import type { WebSocket } from "ws";
import { ParticipantRegistry } from "../admission/registry.js";
import { GroupManager } from "../groups/group-manager.js";
import { PhaseEngine, type ShowCueEvent } from "./phase-engine.js";
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
  const cues: ShowCueEvent[] = [];
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
      method: (id) => groups.votingMethodFor(id),
      begin: (phase, ids) => {
        const cohort = ids.filter((id) => !phase.sourceGroupIds || phase.sourceGroupIds.includes(groups.groupFor(id) ?? ""));
        groups.applyBranch(phase, ids);
        return cohort;
      },
    },
    onParticipantPhase: (ids, phase) => audio.push({ ids, phase: phase.id }),
    onCueEvent: (event) => cues.push(event),
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
  return { engine, groups, registry, votes, audio, cues, ended, send, display, phone, choose, tick, setNow: (time: number) => { now = time; } };
}

describe("independent group paths", () => {
  it("moves a late arrival into the live scene without replaying cues or changing its clock", () => {
    const h = setup(); h.display();
    const b = h.phone("two"); h.engine.adminStart(); h.choose(b, "b"); h.tick(100);
    h.setNow(450);
    const late = h.phone("late");
    const before = h.cues.length;
    expect(h.engine.adminAssignGroup("late", "b", h.engine.currentPhaseEpoch)).toEqual({ ok: true });
    expect(late.snapshot.phase).toEqual(b.snapshot.phase);
    expect(late.snapshot.phase.startedAt).toBe(100);
    expect(late.snapshot.phaseEpoch).toBe(b.snapshot.phaseEpoch);
    expect(late.snapshot.routingEpoch).toBe(1);
    expect(h.cues).toHaveLength(before);
    expect(h.engine.groupPaths.find(p => p.groupId === "b")?.memberIds).toEqual(["two", "late"]);
    h.engine.socketClosed(late.ws); h.registry.releaseSocket(late.ws, 450);
    const restored = h.phone("late");
    expect(restored.snapshot.phase.id).toBe("film");
    expect(restored.snapshot.routingEpoch).toBe(1);
    h.engine.stop();
  });

  it("transfers open votes and sockets without leaving a vote in the source group", () => {
    const h = setup(); h.display();
    const a = h.phone("one"); const other = h.phone("other"); const b = h.phone("two");
    h.engine.adminStart(); h.choose(a, "a"); h.choose(other, "a"); h.choose(b, "b"); h.tick(100);
    const oldEpoch = a.snapshot.phaseEpoch;
    h.send(a, { t: "input", v: 2, sessionId: "visit", phaseEpoch: oldEpoch, seq: 1, x: 0.8, y: 0.5 });
    h.setNow(150);
    expect(h.engine.adminAssignGroup("one", "b")).toEqual({ ok: true });
    expect(h.groups.groupFor("one")).toBe("b");
    expect(a.snapshot.phase.id).toBe("film");
    h.send(a, { t: "input", v: 2, sessionId: "visit", phaseEpoch: oldEpoch, seq: 2, x: 0.2, y: 0.5 });
    h.tick(200);
    expect(h.votes[0]?.votes.map((v) => v.participantId)).toEqual(["other"]);
    expect(a.snapshot.phase.id).toBe("film"); // Source completion cannot deliver to the transferred socket.
    h.engine.stop();
  });

  it("admits a transfer to an open vote, silences waiting destinations, and lets empty sources finish", () => {
    const h = setup(); h.display();
    const a = h.phone("one"); const b = h.phone("two"); const c = h.phone("three");
    h.engine.adminStart(); h.choose(a, "a"); h.choose(b, "b"); h.choose(c, "c"); h.tick(100);
    h.setNow(150);
    expect(h.engine.adminAssignGroup("two", "a")).toEqual({ ok: true });
    h.send(b, { t: "input", v: 2, sessionId: "visit", phaseEpoch: b.snapshot.phaseEpoch, seq: 1, x: 0.8, y: 0.5 });
    expect(h.engine.groupPaths.find((p) => p.groupId === "b")?.done).toBe(true);
    h.tick(200);
    expect(h.votes[0]?.votes.map((v) => v.participantId)).toEqual(["one", "two"]);
    const late = h.phone("late");
    expect(h.engine.adminAssignGroup("late", "a")).toEqual({ ok: true });
    expect(late.snapshot.phase.title).toBe("Waiting for other groups");
    expect(h.audio.at(-1)).toEqual({ ids: ["late"], phase: "idle" });
    expect(h.engine.adminSkipGroup("c")).toEqual({ ok: true });
    h.tick(201);
    expect(h.engine.currentPhaseId).toBe("together");
    h.engine.stop();
  });

  it("rejects stale transfers, unknown groups, and jumps outside a group's route", () => {
    const h = setup(); h.display(); const a = h.phone("one");
    h.engine.adminStart(); h.choose(a, "a"); h.tick(100);
    expect(h.engine.adminAssignGroup("one", "a", -1)).toEqual({ ok: false, reason: "stale" });
    expect(h.engine.adminAssignGroup("one", "unknown")).toEqual({ ok: false, reason: "invalid-target" });
    expect(h.engine.adminJumpGroup("a", "film")).toEqual({ ok: false, reason: "invalid-target" });
    expect(h.engine.adminJumpGroup("a", "split")).toEqual({ ok: false, reason: "invalid-target" });
    expect(h.groups.groupFor("one")).toBe("a");
    expect(h.engine.groupPaths[0]?.jumpTargets).toEqual(["vote", "together"]);
    h.engine.stop();
  });

  it("lists main, group and signage displays with their own heartbeat ages", () => {
    const h = setup();
    const main = h.display();
    const screenA = h.display("a");
    const lobby = new Socket();
    h.send(lobby, { t: "display_join", v: 2, clientVersion: "test", installationId: "inst", roomId: "room", displayToken: "secret", signageId: "entrance" });
    const a = h.phone("one");
    expect(h.engine.mainDisplayNeeded).toBe(true);
    h.engine.adminStart(); h.choose(a, "a"); h.tick(100);
    expect(h.engine.mainDisplayNeeded).toBe(false);

    const beat = (socket: Socket) => h.send(socket, { t: "display_heartbeat", v: 2, sessionId: "stale", phaseId: "stale", phaseEpoch: 0, clientTime: 0 });
    beat(main); beat(lobby);
    h.setNow(150);
    beat(screenA); // routed to group a's path, but still recorded here
    h.setNow(160);
    expect(h.engine.connectedDisplays).toEqual([
      { kind: "main", id: null, heartbeatAgeMs: 60 },
      { kind: "group", id: "a", heartbeatAgeMs: 10 },
      { kind: "signage", id: "entrance", heartbeatAgeMs: 60 },
    ]);
    h.engine.socketClosed(main.ws);
    expect(h.engine.connectedDisplays.map((display) => display.kind)).toEqual(["group", "signage"]);
    h.engine.stop();
  });

  it("keeps disconnected transfers on their destination when they reconnect", () => {
    const h = setup(); h.display(); const a = h.phone("one"); const b = h.phone("two");
    h.engine.adminStart(); h.choose(a, "a"); h.choose(b, "b"); h.tick(100);
    h.engine.socketClosed(a.ws); h.registry.releaseSocket(a.ws, 110); a.close();
    h.engine.adminAssignGroup("one", "b");
    expect(h.phone("one").snapshot.phase.id).toBe("film");
    h.engine.stop();
  });

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
    h.send(main, endFilm); // Displays only play along; the server clock ends media.
    h.send(screenB, endFilm);
    h.tick(1_099);
    expect(b.snapshot.phase.id).toBe("film");
    const lastLocalEpoch = reconnected.snapshot.phaseEpoch;
    h.tick(1_100);
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

  it("keeps selection open past the deadline until everyone chooses, including reconnects", () => {
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
    h.tick(100);
    expect(h.engine.groupPathsStarted).toBe(false);
    expect(h.engine.adminStartGroupPaths()).toEqual({ ok: false, reason: "unassigned-participants" });
    h.choose(reconnected, "b");
    expect(h.groups.groupFor("two")).toBe("b");
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

  it("ends group media on the server clock with no group display, and ignores empty groups at reunion", () => {
    const h = setup();
    const main = h.display();
    const b = h.phone("two");
    h.engine.adminStart(); h.choose(b, "b"); h.tick(100);
    h.tick(1_100);
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

  it("applies each group's voting method inside its independent path", () => {
    const configured = scenarioSchema.parse({
      ...scenario,
      groups: [
        { id: "a", label: "Actors", votingMethod: "phone-buttons" },
        { id: "b", label: "Builders", votingMethod: "physical" },
        { id: "c", label: "Chorus", votingMethod: "phone-cursor" },
      ],
      phases: scenario.phases.map((phase) => phase.kind === "group-branch"
        ? { ...phase, outgoingCues: ["split"], branches: phase.branches.map((output) => ({ ...output, next: "vote" })) }
        : phase.id === "vote" ? { ...phase, outgoingCues: ["vote-open"] } : phase),
    });
    const h = setup(configured);
    h.display();
    const a = h.phone("one");
    const b = h.phone("two");
    h.engine.adminStart();
    h.choose(a, "a"); h.choose(b, "b"); h.tick(100);

    expect(a.sent.at(-1)).toMatchObject({ t: "voting_options", method: "phone-buttons" });
    expect(b.sent.at(-1)).toMatchObject({ t: "voting_options", method: "physical" });
    h.send(a, { t: "button_vote", v: 2, sessionId: "visit", phaseEpoch: a.snapshot.phaseEpoch, outcome: "max" });
    h.send(a, { t: "input", v: 2, sessionId: "visit", phaseEpoch: a.snapshot.phaseEpoch, seq: 1, x: 0.1, y: 0.5 });
    h.send(b, { t: "button_vote", v: 2, sessionId: "visit", phaseEpoch: b.snapshot.phaseEpoch, outcome: "max" });
    h.engine.applyTrackingActions([{ type: "join", gid: 42 }], 110);
    h.engine.claimTrackedBody("two", 42, 111);
    h.engine.applyTrackingActions([{ type: "position", gid: 42, x: 0.1, y: 0.5 }], 112);
    h.tick(200);

    const byParticipant = Object.fromEntries(h.votes.flatMap((snapshot) => snapshot.votes)
      .filter((vote) => vote.x !== null)
      .map((vote) => [vote.participantId, vote.x]));
    expect(byParticipant.one).toBeGreaterThanOrEqual(0.5);
    expect(byParticipant.two).toBeLessThan(0.5);
    expect(h.cues).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "cue", timelineId: "main", phaseId: "split", payload: { cue: "split" } }),
      expect.objectContaining({ type: "cue", timelineId: "a", phaseId: "vote", payload: { cue: "vote-open" } }),
      expect.objectContaining({ type: "cue", timelineId: "b", phaseId: "vote", payload: { cue: "vote-open" } }),
    ]));
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

  it("validates branch-only targets and permits a second split inside one group path", () => {
    expect(validateScenario(scenario).ok).toBe(true);
    const withTarget = (target: string) => scenarioSchema.parse({ ...scenario, phases: scenario.phases.map((phase) => phase.kind === "group-branch"
      ? { ...phase, branches: phase.branches.map((branch) => ({ ...branch, next: target })) } : phase) });
    expect(validateScenario(withTarget("missing")).errors.some((e) => e.code === "broken-target")).toBe(true);
    expect(validateScenario(withTarget("split")).errors.some((e) => e.code === "invalid-group-branch")).toBe(false);
  });

  it("runs a second three-way selection while the other outer group continues", () => {
    const nested = scenarioSchema.parse({
      ...scenario,
      groups: [
        ...scenario.groups!,
        { id: "d", label: "Direction" },
        { id: "e", label: "Decision", votingMethod: "phone-buttons" },
      ],
      phases: [
        ...scenario.phases.map((phase) => phase.kind === "group-branch"
          ? { ...phase, branches: phase.branches.map((output) => output.groupId === "a" ? { ...output, next: "roles" } : output) }
          : phase),
        { kind: "group-branch", id: "roles", title: "Choose KI role", sourceGroupIds: ["a"], durationMs: 100,
          assignment: { type: "self-select" },
          branches: [{ groupId: "a", next: "role-vote" }, { groupId: "d", next: "role-vote" }, { groupId: "e", next: "role-vote" }], next: "ki-after" },
        { kind: "position-question", id: "role-vote", text: "Choose", durationMs: 100, freezeMs: 0,
          connectionStaleAfterMs: 1_000, showLiveCounts: true,
          field: { type: "two-quadrant", axis: "x", variant: "split", labels: { minLabel: "No", maxLabel: "Yes" } },
          next: { type: "fixed", target: "ki-after" } },
        { kind: "video", id: "ki-after", src: "ki-after.mp4", expectedDurationMs: 1_000, next: "together" },
      ],
    });
    expect(validateScenario(nested).ok).toBe(true);
    const h = setup(nested);
    h.display();
    const decisionScreen = h.display("e");
    const ki = h.phone("one");
    const theater = h.phone("two");
    h.engine.adminStart();
    h.choose(ki, "a"); h.choose(theater, "b"); h.tick(100);
    expect(ki.snapshot.phase.id).toBe("roles");
    expect(theater.snapshot.phase.id).toBe("film");
    expect(ki.sent.at(-1).groups.map((group: { label: string }) => group.label)).toEqual(["Actors", "Direction", "Decision"]);
    h.choose(ki, "e");
    expect(ki.snapshot.currentGroup).toMatchObject({ id: "e", label: "Decision" });
    expect(theater.snapshot.currentGroup).toMatchObject({ id: "b", label: "Builders" });
    h.tick(200);
    expect(h.groups.groupFor("one")).toBe("e");
    expect(ki.snapshot.phase.id).toBe("role-vote");
    expect(ki.sent.at(-1)).toMatchObject({ t: "voting_options", method: "phone-buttons" });
    expect(decisionScreen.snapshot.phase.id).toBe("role-vote");
    const late = h.phone("late");
    expect(h.engine.adminAssignGroup("late", "e")).toEqual({ ok: true });
    expect(late.snapshot.phase.id).toBe("role-vote");
    expect(late.snapshot.currentGroup).toMatchObject({ id: "e", label: "Decision" });
    expect(h.audio.at(-1)).toEqual({ ids: ["late"], phase: "role-vote" });
    expect(h.engine.groupPaths.find((p) => p.groupId === "e")?.memberIds).toEqual(["one", "late"]);
    expect(h.engine.groupPaths.find((p) => p.groupId === "a")?.memberIds).toEqual([]);
    expect(h.engine.adminAssignGroup("late", "b")).toEqual({ ok: true });
    expect(late.snapshot.phase.id).toBe("film");
    expect(h.engine.groupPaths.find((p) => p.groupId === "e")?.memberIds).toEqual(["one"]);
    expect(h.audio.at(-1)).toEqual({ ids: ["late"], phase: "film" });
    expect(theater.snapshot.phase.id).toBe("film");
    h.send(ki, { t: "button_vote", v: 2, sessionId: "visit", phaseEpoch: ki.snapshot.phaseEpoch, outcome: "max" });
    h.tick(300);
    expect(h.votes.at(-1)?.votes.find((vote) => vote.participantId === "one")?.x).toBeGreaterThanOrEqual(0.5);
    expect(ki.snapshot.phase.id).toBe("ki-after");
    expect(theater.snapshot.phase.id).toBe("film");
    h.engine.stop();

    // The nested branch can retain the parent's catalogue group ID.
    const reused = setup(nested); reused.display();
    const original = reused.phone("original"); const other = reused.phone("other");
    reused.engine.adminStart(); reused.choose(original, "a"); reused.choose(other, "b"); reused.tick(100);
    reused.choose(original, "a"); reused.tick(200);
    const newcomer = reused.phone("newcomer");
    expect(reused.engine.adminAssignGroup("newcomer", "a")).toEqual({ ok: true });
    expect(newcomer.snapshot.phase.id).toBe("role-vote");
    expect(reused.engine.groupPaths.filter((p) => p.groupId === "a" && p.state !== "split")).toHaveLength(1);
    expect(reused.engine.adminJumpGroup("a", "ki-after")).toEqual({ ok: true });
    reused.tick(201);
    expect(original.snapshot.phase.id).toBe("ki-after");
    reused.engine.stop();
  });

  it("rejects the ambiguous generic skip during a group-branch phase, before and after paths start", () => {
    const h = setup();
    h.display();
    const a = h.phone("one");
    const b = h.phone("two");
    h.engine.adminStart();
    h.choose(a, "a");
    h.choose(b, "b");
    // Selection still open -- paths haven't started yet.
    expect(h.engine.adminSkip()).toEqual({ ok: false, reason: "wrong-phase" });
    expect(h.engine.currentPhaseId).toBe("split");
    h.tick(100);
    expect(h.engine.groupPathsStarted).toBe(true);
    // Paths running -- the generic skip must not collapse them or end the show.
    expect(h.engine.adminSkip()).toEqual({ ok: false, reason: "wrong-phase" });
    expect(h.engine.currentPhaseId).toBe("split");
    expect(h.engine.lifecycleState).toBe("active");
    expect(a.snapshot.phase.id).toBe("vote");
    expect(b.snapshot.phase.id).toBe("film");
    expect(h.ended).toEqual([]);
    h.engine.stop();
  });

  it("starts group paths immediately via adminStartGroupPaths, without waiting for the selection deadline", () => {
    const h = setup();
    h.display();
    const a = h.phone("one");
    h.engine.adminStart();
    h.choose(a, "a");
    expect(h.engine.groupPathsStarted).toBe(false);
    expect(h.engine.adminStartGroupPaths()).toEqual({ ok: true });
    expect(h.engine.groupPathsStarted).toBe(true);
    expect(a.snapshot.phase.id).toBe("vote");
    // Only valid once, from the group-branch phase, before paths have started.
    expect(h.engine.adminStartGroupPaths()).toEqual({ ok: false, reason: "wrong-phase" });
    h.engine.stop();
  });

  it("skips only one group's current scene via adminSkipGroup, leaving the other group running", () => {
    const h = setup();
    h.display();
    const a = h.phone("one");
    const b = h.phone("two");
    h.engine.adminStart();
    h.choose(a, "a");
    h.choose(b, "b");
    h.tick(100);
    expect(a.snapshot.phase.id).toBe("vote");
    expect(b.snapshot.phase.id).toBe("film");
    expect(h.engine.adminSkipGroup("b")).toEqual({ ok: true });
    expect(b.snapshot.phase).toMatchObject({ id: "split", title: "Waiting for other groups" });
    expect(a.snapshot.phase.id).toBe("vote");
    expect(h.engine.currentPhaseId).toBe("split");
    expect(h.engine.lifecycleState).toBe("active");
    expect(h.engine.adminSkipGroup("missing-group")).toEqual({ ok: false, reason: "wrong-phase" });
    h.engine.stop();
  });

  it("forces reunion via adminForceReunion, ending every running group path at once", () => {
    const h = setup();
    const main = h.display();
    const a = h.phone("one");
    const b = h.phone("two");
    h.engine.adminStart();
    h.choose(a, "a");
    h.choose(b, "b");
    h.tick(100);
    expect(h.engine.adminForceReunion()).toEqual({ ok: true });
    expect(h.engine.currentPhaseId).toBe("together");
    expect(main.snapshot.phase.id).toBe("together");
    expect(h.engine.groupPathsStarted).toBe(false);
    // No longer a running group-branch phase, so this is refused too.
    expect(h.engine.adminForceReunion()).toEqual({ ok: false, reason: "wrong-phase" });
    h.engine.stop();
  });

  it("rejects a whole-timeline jump while group paths are running, but allows jumping a single group", () => {
    const h = setup();
    h.display();
    const a = h.phone("one");
    const b = h.phone("two");
    h.engine.adminStart();
    h.choose(a, "a");
    h.choose(b, "b");
    h.tick(100);
    expect(h.engine.adminJump("together")).toEqual({ ok: false, reason: "wrong-phase" });
    expect(h.engine.currentPhaseId).toBe("split");
    expect(h.engine.adminJumpGroup("b", "together")).toEqual({ ok: true });
    expect(b.snapshot.phase).toMatchObject({ id: "split", title: "Waiting for other groups" });
    expect(a.snapshot.phase.id).toBe("vote");
    h.engine.stop();
  });

  it("rejects stale commands whose expectedPhaseId no longer matches the running phase", () => {
    const h = setup();
    h.display();
    const a = h.phone("one");
    h.engine.adminStart();
    expect(h.engine.currentPhaseId).toBe("split");
    expect(h.engine.adminSkip(undefined, "wrong-id")).toEqual({ ok: false, reason: "stale" });
    expect(h.engine.adminJump("together", undefined, "wrong-id")).toEqual({ ok: false, reason: "stale" });
    expect(h.engine.adminStartGroupPaths(undefined, "wrong-id")).toEqual({ ok: false, reason: "stale" });
    h.choose(a, "a");
    h.tick(100);
    expect(h.engine.adminForceReunion(undefined, "wrong-id")).toEqual({ ok: false, reason: "stale" });
    expect(h.engine.adminSkipGroup("a", undefined, "wrong-id")).toEqual({ ok: false, reason: "stale" });
    h.engine.stop();
  });
});

it("sends each phone its own selected group and audio state, including waiting and reconnect", () => {
  const configured = scenarioSchema.parse({ ...scenario, phases: scenario.phases.map((phase) =>
    phase.kind === "group-branch" ? { ...phase, branches: phase.branches.map((branch) => ({ ...branch, phoneAudioSrc: "intro.mp3" })) }
    : phase.id === "film" ? { ...phase, phoneAudioSrc: "film.mp3" } : phase) });
  const h = setup(configured); h.display();
  const a = h.phone("one"), b = h.phone("two"); h.engine.adminStart();
  h.choose(a, "a"); h.choose(b, "b");
  expect(a.snapshot).toMatchObject({ currentGroup: { id: "a", label: "Actors" }, phoneAudioActive: true });
  expect(b.snapshot).toMatchObject({ currentGroup: { id: "b", label: "Builders" }, phoneAudioActive: true });
  h.tick(100);
  expect(a.snapshot).toMatchObject({ currentGroup: { id: "a" }, phoneAudioActive: false, phase: { id: "vote" } });
  expect(b.snapshot).toMatchObject({ currentGroup: { id: "b" }, phoneAudioActive: true, phase: { id: "film" } });
  h.engine.adminSkipGroup("b");
  expect(b.snapshot).toMatchObject({ currentGroup: { id: "b" }, phoneAudioActive: false });
  expect(h.phone("two").snapshot).toMatchObject({ currentGroup: { id: "b" }, phoneAudioActive: false });
  h.engine.stop();
});

const nestedRecovery = () => scenarioSchema.parse({ ...scenario, phases: [
  ...scenario.phases.map(p => p.id === "split" && p.kind === "group-branch" ? { ...p, branches: p.branches.map(b => b.groupId === "a" ? { ...b, next: "roles" } : b) } : p),
  { id: "roles", kind: "group-branch", title: "Choose a trade", sourceGroupIds: ["a"], durationMs: 100,
    assignment: { type: "self-select" }, branches: [{ groupId: "a", next: "vote" }, { groupId: "c", next: "film" }], next: "together" },
] });

it("admin assigns and starts a nested selection and reunites only its children", () => {
  const h = setup(nestedRecovery()); h.display();
  const a = h.phone("one"), b = h.phone("two"); h.engine.adminStart(); h.choose(a, "a"); h.choose(b, "b"); h.tick(100);
  const selectionEpoch = a.snapshot.phaseEpoch;
  expect(a.snapshot.participantState).toBe("choosing");
  expect(h.engine.groupDestinations).toContain("c");
  expect(h.engine.adminAssignGroup("one", "c")).toEqual({ ok: true });
  expect(a.snapshot.currentGroup.id).toBe("c");
  expect(h.engine.adminStartGroupPaths(undefined, "wrong", "a")).toEqual({ ok: false, reason: "stale" });
  expect(h.engine.adminStartGroupPaths(undefined, "roles", "a", -1)).toEqual({ ok: false, reason: "stale" });
  expect(h.engine.adminStartGroupPaths(undefined, "roles", "a")).toEqual({ ok: true });
  expect(a.snapshot.phaseEpoch).toBeGreaterThan(selectionEpoch);
  expect(h.engine.groupPaths.filter(p => p.groupId === "c")).toEqual([expect.objectContaining({ state: "active", acceptingParticipants: true })]);
  expect(a.snapshot.phase.id).toBe("film");
  expect(b.snapshot.phase.id).toBe("film");
  expect(h.engine.adminForceReunion(undefined, "roles", "a")).toEqual({ ok: true });
  expect(a.snapshot.participantState).toBe("finished");
  expect(b.snapshot.participantState).toBe("active");
  h.engine.stop();
});

it("starts an empty group from its beginning when a late phone chooses it", () => {
  const h = setup(); h.display(); const a = h.phone("one"); h.engine.adminStart(); h.choose(a, "a"); h.tick(100);
  expect(h.engine.groupPaths.find(p => p.groupId === "c")?.state).toBe("empty");
  const screen = h.display("c"); expect(screen.snapshot.phase.kind).toBe("idle");
  h.setNow(150); const late = h.phone("late");
  expect(late.snapshot.participantState).toBe("unassigned");
  expect(late.sent.at(-1)).toMatchObject({ t: "group_selection_options", selectedGroupId: null });
  h.choose(late, "c");
  expect(late.snapshot).toMatchObject({ participantState: "active", currentGroup: { id: "c" }, phase: { id: "film", startedAt: 150 } });
  expect(a.snapshot.phase.id).toBe("vote");
  expect(h.engine.groupPaths.find(p => p.groupId === "c")?.state).toBe("active");
  expect(screen.snapshot.phase).toMatchObject({ id: "film", startedAt: 150 });
  h.engine.stop();
});

it("does not replay a selected legacy instruction and gives a late choice its full window", () => {
  const h = setup(scenarioSchema.parse({ ...scenario, phases: scenario.phases.map(p => p.kind === "group-branch" ? { ...p, branches: p.branches.map(b => ({ ...b, phoneAudioSrc: "instruction.mp3" })) } : p) }));
  h.display(); const a = h.phone("one"); h.engine.adminStart(); h.setNow(90); h.choose(a, "a");
  const count = h.audio.length; h.choose(a, "a"); expect(h.audio.length).toBe(count);
  h.tick(100); expect(h.engine.groupPathsStarted).toBe(false);
  h.tick(190); expect(h.engine.groupPathsStarted).toBe(true);
  h.engine.stop();
});

it("retains the parent cohort when a trade selection is revisited", () => {
  const repeated = scenarioSchema.parse({ ...nestedRecovery(), phases: nestedRecovery().phases.map(p => p.id === "roles" ? { ...p, next: "film" } : p) });
  const h = setup(repeated); h.display(); const a = h.phone("one"), b = h.phone("two"); h.engine.adminStart(); h.choose(a, "a"); h.choose(b, "b"); h.tick(100);
  h.choose(a, "c"); expect(h.engine.adminStartGroupPaths(undefined, "roles", "a")).toEqual({ ok: true });
  expect(h.engine.adminForceReunion(undefined, "roles", "a")).toEqual({ ok: true });
  expect(h.engine.adminJumpGroup("a", "roles")).toEqual({ ok: true });
  expect(h.groups.groupFor("one")).toBeNull();
  expect(a.sent.at(-1).t).toBe("group_selection_options");
  h.choose(a, "c"); expect(h.groups.groupFor("one")).toBe("c");
  h.engine.stop();
});

it("moves an outsider into a nested selection that reuses its parent group ID", () => {
  const h = setup(nestedRecovery()); h.display(); const a = h.phone("one"), b = h.phone("two");
  h.engine.adminStart(); h.choose(a, "a"); h.choose(b, "b"); h.tick(100);
  expect(h.engine.adminAssignGroup("two", "c")).toEqual({ ok: true });
  expect(b.snapshot).toMatchObject({ participantState: "choosing", currentGroup: { id: "c" }, phase: { id: "roles" } });
  expect(h.engine.groupPaths.find(p => p.groupId === "a")?.memberIds).toEqual(["one", "two"]);
  h.engine.stop();
});

it("warns when a group entry immediately reaches its reunion", () => {
  const value = scenarioSchema.parse({ ...scenario, phases: scenario.phases.map(p => p.kind === "group-branch" ? { ...p, branches: p.branches.map(b => ({ ...b, next: p.next })) } : p) });
  expect(validateScenario(value).warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "immediate-group-reunion", phaseId: "split" })]));
});
