import { afterEach, describe, expect, it, vi } from "vitest";
import { scenarioSchema, validateScenario } from "@entertheblackbox/scenario";
import { parseServerMessage, type ClientToServerMessage } from "@entertheblackbox/protocol";
import type { WebSocket } from "ws";
import { ParticipantRegistry } from "../admission/registry.js";
import { CueFeed } from "../cues/feed.js";
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
  const feed = new CueFeed();
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
    onCueEvent: (event) => { cues.push(event); feed.publish(event); },
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
  const phone = (id: string, client?: "web" | "native") => {
    const socket = new Socket();
    const result = registry.admit({ clientId: id, participantLease: id, name: id, leaseExpiresAt: 100_000, socket: socket.ws, now, ...(client ? { client } : {}) });
    if (!result.ok) throw new Error("admission failed");
    groups.ensureParticipant(id, client);
    engine.participantJoined(socket.ws, result.participant);
    return socket;
  };
  const choose = (phone: Socket, groupId: string) => send(phone, { t: "group_selection", v: 2, sessionId: phone.snapshot.sessionId, phaseEpoch: phone.snapshot.phaseEpoch, groupId });
  const tick = (time: number) => { now = time; engine.tick(now); };
  return { engine, groups, registry, votes, audio, cues, feed, ended, send, display, phone, choose, tick, setNow: (time: number) => { now = time; } };
}

describe("independent group paths", () => {
  it.each(["deadline", "operator command"])("starts an automatic split by %s despite an unassigned late arrival", (start) => {
    const automatic = scenarioSchema.parse({
      ...scenario,
      initialGroupIds: undefined,
      phases: scenario.phases.map((phase) => phase.kind === "group-branch" ? {
        ...phase,
        assignment: { type: "manual", fallbackGroupId: "a" },
        branches: phase.branches.filter((branch) => branch.groupId !== "c"),
      } : phase),
    });
    const h = setup(automatic);
    const present = h.phone("present");
    h.engine.adminStart();
    h.setNow(50);
    h.groups.assign("preassigned", "b");
    const preassigned = h.phone("preassigned");
    const late = h.phone("late");
    expect(h.groups.groupFor("late")).toBeNull();

    if (start === "deadline") h.tick(100);
    else expect(h.engine.adminStartGroupPaths()).toEqual({ ok: true });

    expect(h.engine.groupPathsStarted).toBe(true);
    expect(present.snapshot.phase.id).toBe("vote");
    expect(preassigned.snapshot.phase.id).toBe("film");
    expect(late.snapshot).toMatchObject({ participantState: "unassigned", phase: { id: "split" } });
    h.engine.stop();
  });

  it.each([
    { occupied: false, reunites: true },
    { occupied: true, reunites: false },
  ])("reunites past a path waiting for GO only when nobody is in it (occupied: $occupied)", ({ occupied, reunites }) => {
    const holding = scenarioSchema.parse({
      ...scenario,
      phases: [
        ...scenario.phases.map((phase) => phase.kind === "group-branch"
          ? { ...phase, branches: [{ groupId: "a", next: "vote" }, { groupId: "b", next: "hold" }] }
          : phase),
        { kind: "narration", id: "hold", text: "Wait for the actors", durationMs: 1_000, waitForGo: true, next: "together" },
      ],
    });
    const h = setup(holding);
    const a = h.phone("one");
    const b = occupied ? h.phone("two") : null;
    h.engine.adminStart();
    h.choose(a, "a");
    if (b) h.choose(b, "b");
    h.tick(100);
    expect(h.engine.groupPathsStarted).toBe(true);
    h.tick(250);
    h.tick(400);
    // An occupied path waiting for GO still holds the others; they wait at the split.
    expect(a.snapshot.phase.id).toBe(reunites ? "together" : "split");
    expect(h.engine.currentPhaseId).toBe(reunites ? "together" : "split");
    h.engine.stop();
  });

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
    // Admin sees each member on its path's cue, not the shared split scene.
    expect(h.engine.participantPresence.find(p => p.clientId === "late")).toMatchObject({ phaseId: b.snapshot.phase.id, phaseStartedAt: 100 });
    expect(h.engine.currentPhaseId).not.toBe(b.snapshot.phase.id);
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
    expect(h.engine.groupPaths.find((p) => p.groupId === "b")?.done).toBe(false);
    h.tick(200);
    expect(h.votes[0]?.votes.map((v) => v.participantId)).toEqual(["one", "two"]);
    const late = h.phone("late");
    expect(h.engine.adminAssignGroup("late", "a")).toEqual({ ok: true });
    expect(late.snapshot.phase.title).toBe("Waiting for other groups");
    expect(h.audio.at(-1)).toEqual({ ids: ["late"], phase: "idle" });
    expect(h.engine.adminSkipGroup("c")).toEqual({ ok: true });
    h.tick(201);
    expect(h.engine.currentPhaseId).toBe("split");
    h.tick(1_100);
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
    expect(screenC.snapshot.phase).toMatchObject({ id: "film", startedAt: 100 });
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

  it("ends group media on the server clock with no group display, including empty groups at reunion", () => {
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

  it("retires a waiting path without replaying the split scene or its cues", () => {
    const h = setup(scenarioSchema.parse({
      ...scenario,
      phases: scenario.phases.map(phase => phase.id === "split" ? { ...phase, outgoingCues: ["intro"] } : phase),
    }));
    const phone = h.phone("one");
    h.engine.adminStart();
    h.choose(phone, "a");
    h.tick(100);
    const vote = h.cues.find(event => event.type === "phase" && event.timelineId === "a");

    h.tick(200);
    expect(phone.snapshot.participantState).toBe("finished");
    expect(h.cues.filter(event => event.phaseId === "split").map(({ type, timelineId }) => [type, timelineId]))
      .toEqual([["phase", "main"], ["cue", "main"]]);
    expect(h.cues.at(-1)).toMatchObject({ type: "retire", timelineId: "a", phaseId: "vote", phaseEpoch: vote?.phaseEpoch });
    expect(h.feed.snapshot()).toMatchObject({ timelines: [
      { timelineId: "main", phaseId: "split" },
      { timelineId: "b", phaseId: "film" },
      { timelineId: "c", phaseId: "film" },
    ] });
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

  it("plays task audio for the winner of a vote cast inside a group path, after the reunion", () => {
    const clip = (src: string) => ({ src, durationMs: 1_000 });
    const withTask = scenarioSchema.parse({
      ...scenario,
      participantTasks: [{ id: "chore", title: "Chore", question: "Ready?", notificationBody: "Please answer", groupIds: [], durationMs: 5_000,
        options: [{ id: "go", label: "Go", audioByVote: { questionId: "vote", clips: { max: clip("max.mp3") }, fallback: clip("fallback.mp3") } }] }],
    });
    const h = setup(withTask);
    const a = h.phone("one");
    h.engine.adminStart();
    h.choose(a, "a");
    h.tick(100);
    expect(a.snapshot.phase.id).toBe("vote");
    h.send(a, { t: "input", v: 2, sessionId: "visit", phaseEpoch: a.snapshot.phaseEpoch, seq: 1, x: 0.9, y: 0.5 });
    h.tick(200);
    h.tick(1_200);
    h.tick(1_300);
    expect(h.engine.currentPhaseId).toBe("together");

    h.engine.taskCommand({ action: "open", templateId: "chore", sessionId: "visit", phaseId: "together", phaseEpoch: h.engine.currentPhaseEpoch });
    const task = h.engine.taskStatus.instances.at(-1)!;
    h.send(a, { t: "participant_task_response", v: 2, sessionId: "visit", instanceId: task.id, optionId: "go" });
    const recipient = h.engine.taskStatus.instances.at(-1)!.recipients.find((r) => r.participantId === "one");
    expect(recipient?.audio?.src).toBe("max.mp3");
    h.engine.stop();
  });

  it("keeps a group path's scene task, even one that persists, off the other path's tablets", () => {
    const withTask = scenarioSchema.parse({
      ...scenario,
      participantTasks: [{ id: "shared", title: "Shared", question: "Ready?", notificationBody: "Please answer", groupIds: [], durationMs: 10_000,
        persistAcrossPhases: true, options: [{ id: "ok", label: "OK" }] }],
      phases: [
        ...scenario.phases.map((phase) => phase.kind === "group-branch"
          ? { ...phase, branches: [{ groupId: "a", next: "brief" }, { groupId: "b", next: "film" }] }
          : phase),
        { kind: "narration", id: "brief", text: "Actors only", durationMs: 1_000, taskId: "shared", next: "together" },
      ],
    });
    const h = setup(withTask);
    const actor = h.phone("one");
    const builder = h.phone("two", "native");
    h.engine.adminStart();
    h.choose(actor, "a");
    h.choose(builder, "b");
    h.tick(100);
    h.tick(200);
    h.tick(300);
    const task = h.engine.taskStatus.instances.find((t) => t.template.id === "shared")!;
    expect(task.recipients.map((r) => r.participantId)).toEqual(["one"]);
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
    expect(h.cues.some(event => event.type === "reset" && event.phaseId === "ki-after")).toBe(false);
    expect(h.feed.snapshot()).toMatchObject({ timelines: [
      { timelineId: "main", phaseId: "split" },
      { timelineId: "a", phaseId: "ki-after" },
      { timelineId: "b", phaseId: "film" },
      { timelineId: "c", phaseId: "film" },
    ] });
    h.tick(1_300);
    expect(h.cues.at(-2)).toMatchObject({ type: "reset", timelineId: "main", phaseId: "together" });
    expect(h.feed.snapshot()).toMatchObject({ timelines: [{ timelineId: "main", phaseId: "together" }] });
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
    expect(original.snapshot.participantState).toBe("finished");
    reused.tick(300);
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
  expect(h.feed.snapshot()).toMatchObject({ timelines: [
    { timelineId: "main", phaseId: "split" },
    { timelineId: "a", phaseId: "roles" },
    { timelineId: "b", phaseId: "film" },
    { timelineId: "c", phaseId: "film" },
    { timelineId: "a", timelineKey: "a/a", phaseId: "vote" },
    { timelineId: "c", timelineKey: "a/c", phaseId: "film" },
  ] });
  expect(h.engine.adminForceReunion(undefined, "roles", "a")).toEqual({ ok: true });
  expect(a.snapshot.participantState).toBe("finished");
  expect(b.snapshot.participantState).toBe("active");
  expect(h.feed.snapshot()).toMatchObject({ timelines: [
    { timelineId: "main", phaseId: "split" },
    { timelineId: "b", phaseId: "film" },
    { timelineId: "c", phaseId: "film" },
  ] });
  expect(h.engine.adminForceReunion(undefined, "split")).toEqual({ ok: true });
  expect(h.cues.at(-2)).toMatchObject({ type: "reset", timelineId: "main", phaseId: "together" });
  expect(h.feed.snapshot()).toMatchObject({ timelines: [{ timelineId: "main", phaseId: "together" }] });
  h.engine.stop();
});

it("joins the running clock when the first late phone chooses an empty group", () => {
  const h = setup(); h.display(); const a = h.phone("one"); h.engine.adminStart(); h.choose(a, "a"); h.tick(100);
  expect(h.engine.groupPaths.find(p => p.groupId === "c")?.state).toBe("active");
  const screen = h.display("c"); expect(screen.snapshot.phase).toMatchObject({ id: "film", startedAt: 100 });
  h.setNow(150); const late = h.phone("late");
  expect(late.snapshot.participantState).toBe("unassigned");
  expect(late.sent.at(-1)).toMatchObject({ t: "group_selection_options", selectedGroupId: null });
  h.choose(late, "c");
  expect(late.snapshot).toMatchObject({ participantState: "active", currentGroup: { id: "c" }, phase: { id: "film", startedAt: 100 } });
  expect(a.snapshot.phase.id).toBe("vote");
  expect(h.engine.groupPaths.find(p => p.groupId === "c")?.state).toBe("active");
  expect(screen.snapshot.phase).toMatchObject({ id: "film", startedAt: 100 });
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

it("scopes display and phone telemetry to the active group and invalidates transferred reports", () => {
  const h = setup(); h.display();
  const a = h.phone("one"), b = h.phone("two");
  h.engine.adminStart(); h.choose(a, "a"); h.choose(b, "b"); h.tick(100);
  const screen = h.display("b");
  const timing = { calibrated: true, offsetMs: -50, roundTripMs: 12, sampleAgeMs: 10, elapsedMs: 100, mode: "display" as const, media: [] };
  h.send(screen, { t: "display_heartbeat", v: 2, sessionId: screen.snapshot.sessionId, phaseId: screen.snapshot.phase.id, phaseEpoch: screen.snapshot.phaseEpoch, clientTime: 100, timing });
  const phoneReport = { t: "ping" as const, v: 2 as const, clientTime: 100, timing: { sessionId: b.snapshot.sessionId, phaseId: b.snapshot.phase.id, phaseEpoch: b.snapshot.phaseEpoch, routingEpoch: 0, timing: { ...timing, mode: "stream" as const } } };
  h.send(b, phoneReport);
  expect(h.engine.timingMonitors.find((r) => r.id === "display:b")?.timing).toEqual(timing);
  expect(h.engine.timingMonitors.find((r) => r.id === "display:a")?.timing).toBeNull();
  expect(h.engine.timingMonitors.find((r) => r.id === "phone:two")?.timing?.mode).toBe("stream");
  h.engine.adminAssignGroup("two", "a", h.engine.currentPhaseEpoch);
  h.send(b, phoneReport);
  expect(h.engine.timingMonitors.find((r) => r.id === "phone:two")?.timing).toBeNull(); h.engine.stop();
});


it("advances every empty branch through decisions and media before the show's first phone arrives", () => {
  const h = setup(scenarioSchema.parse({ ...scenario, phases: [
    ...scenario.phases.map(p => p.id === "film" ? { ...p, next: "second-film" } : p),
    { kind: "video", id: "second-film", src: "second.mp4", phoneAudioSrc: "second.mp3", expectedDurationMs: 1_000, next: "together" },
  ] }));
  h.display();
  const earlyScreen = h.display("b");
  expect(h.engine.adminStart()).toEqual({ ok: true });
  h.tick(100);
  expect(h.engine.groupPaths).toHaveLength(3);
  expect(h.engine.groupPaths.every(p => p.startedAt === 100 && p.memberIds.length === 0)).toBe(true);
  expect(earlyScreen.snapshot.phase).toMatchObject({ id: "film", startedAt: 100 });
  h.tick(200);
  expect(h.engine.groupPaths.find(p => p.groupId === "a")?.done).toBe(true);
  expect(h.engine.currentPhaseId).toBe("split");
  h.tick(1_100);
  h.tick(1_500);
  expect(h.engine.timingMonitors).toContainEqual(expect.objectContaining({
    id: "display:c", phaseId: "second-film", connected: false, mediaExpected: true,
  }));
  const before = h.cues.length;
  const lateScreen = h.display("c");
  const first = h.phone("first");
  h.choose(first, "c");
  expect(first.snapshot).toMatchObject({
    phoneAudioActive: true, serverTime: 1_500,
    phase: { id: "second-film", startedAt: 1_100, deadlineAt: 2_100 },
  });
  expect(first.snapshot.phase).toEqual(lateScreen.snapshot.phase);
  expect(earlyScreen.snapshot.phase).toMatchObject({ id: "second-film", startedAt: 1_100 });
  expect(h.cues).toHaveLength(before);
  h.tick(2_100);
  expect(h.engine.currentPhaseId).toBe("together");
  h.engine.stop();
});

it("keeps an emptied group's clock when its last participant leaves and later returns", () => {
  const h = setup(); h.display();
  const phone = h.phone("one");
  h.engine.adminStart(); h.choose(phone, "b"); h.tick(100);
  const original = phone.snapshot;
  h.setNow(150); h.engine.adminAssignGroup("one", "a");
  h.tick(200); h.setNow(450);
  expect(h.engine.adminAssignGroup("one", "b")).toEqual({ ok: true });
  expect(phone.snapshot.phase).toEqual(original.phase);
  expect(phone.snapshot.phaseEpoch).toBe(original.phaseEpoch);
  expect(phone.snapshot.serverTime - phone.snapshot.phase.startedAt).toBe(350);
  h.tick(1_100);
  expect(h.engine.currentPhaseId).toBe("together");
  h.engine.stop();
});


it("lets Admin recover a nested selection blocked by a disconnected phone and starts instruction audio", () => {
  const value = scenarioSchema.parse({ ...scenario,
    groups: [...scenario.groups!, { id: "d", label: "Stage" }, { id: "e", label: "Decision" }],
    phases: [
      ...scenario.phases.map(p => p.id === "split" && p.kind === "group-branch" ? { ...p, branches: p.branches.map(b => b.groupId === "a" ? { ...b, next: "roles" } : b) } : p),
      { id: "roles", kind: "group-branch", sourceGroupIds: ["a"], durationMs: 100, assignment: { type: "self-select" }, branches: [{ groupId: "d", next: "instructions" }, { groupId: "e", next: "instructions" }], next: "together" },
      { id: "instructions", kind: "narration", text: "Listen", durationMs: 1000, phoneAudioSrc: "instructions.mp3", next: "together" },
    ],
  });
  const h = setup(value); h.display();
  const ready = h.phone("ready"), missing = h.phone("missing");
  h.engine.adminStart(); h.choose(ready, "a"); h.choose(missing, "a"); h.tick(100);
  h.choose(ready, "d");
  // An explicit override cannot skip connected people, even if the UI was stale.
  expect(h.engine.adminStartGroupPaths(undefined, "roles", "a", undefined, true)).toEqual({ ok: false, reason: "unassigned-participants" });
  h.engine.socketClosed(missing.ws); h.registry.releaseSocket(missing.ws, 100); missing.close();
  h.tick(200);
  expect(h.engine.groupPaths.find(p => p.groupId === "a")).toMatchObject({ state: "choosing", pendingAssignments: 1, pendingDisconnectedAssignments: 1 });
  expect(h.engine.adminStartGroupPaths(undefined, "roles", "a")).toEqual({ ok: false, reason: "unassigned-participants" });
  expect(h.engine.adminStartGroupPaths(undefined, "roles", "a", -1, true)).toEqual({ ok: false, reason: "stale" });
  expect(h.engine.adminStartGroupPaths(undefined, "roles", "a", undefined, true)).toEqual({ ok: true });
  expect(ready.snapshot).toMatchObject({ phase: { id: "instructions", startedAt: 200 }, phoneAudioActive: true });
  expect(h.audio).toContainEqual({ ids: ["ready"], phase: "instructions" });
  h.setNow(500);
  const restored = h.phone("missing");
  expect(restored.snapshot.participantState).toBe("unassigned");
  expect(restored.sent.at(-1).t).toBe("group_selection_options");
  h.choose(restored, "e");
  expect(restored.snapshot).toMatchObject({ phase: { id: "instructions", startedAt: 200 }, phoneAudioActive: true });
  h.engine.stop();
});


describe("group-following stage monitors", () => {
  const joinMonitor = (h: ReturnType<typeof setup>) => {
    const screen = new Socket();
    h.send(screen, { t: "display_join", v: 2, clientVersion: "test",
      installationId: "inst", roomId: "room", displayToken: "secret", monitorId: "M1" });
    return screen;
  };
  const cast = (h: ReturnType<typeof setup>, phone: Socket, x: number, seq = 1) => {
    h.send(phone, { t: "input", v: 2, seq, sessionId: "visit", phaseEpoch: phone.snapshot.phaseEpoch, x, y: 0.4 });
  };

  it.each(["natural", "forced"] as const)("keeps the followed vote through a %s reunion", (reunion) => {
    const vote = scenario.phases.find(phase => phase.kind === "position-question")!;
    const value = scenarioSchema.parse({
      ...scenario,
      monitorGroupId: "a",
      entryPhaseId: "opening",
      phases: [
        ...scenario.phases.map(phase => {
          if (phase.id === "together") return { ...phase, next: "closing",
            monitorCues: { M1: [{ kind: "vote-result", votePhaseId: "vote", startMs: 0, fallbackText: "No answer" }] } };
          if (phase.kind === "group-branch") return { ...phase,
            branches: phase.branches.map(branch => branch.groupId === "b" ? { ...branch, next: "sibling" } : branch) };
          if (phase.id === "vote") return { ...phase, answerColors: { max: "#ff3300" } };
          return phase;
        }),
        { ...vote, id: "opening", next: { type: "fixed", target: "split" } },
        { ...vote, id: "sibling", durationMs: 200, next: { type: "fixed", target: "film" } },
        { ...vote, id: "closing", next: { type: "fixed", target: "final" } },
        { kind: "video", id: "final", src: "film.mp4", expectedDurationMs: 1_000, next: "idle" },
      ],
    });
    expect(validateScenario(value).ok).toBe(true);
    const h = setup(value);
    const a = h.phone("one"), b = h.phone("two");
    const screen = joinMonitor(h);
    h.engine.adminStart();
    cast(h, a, 0.1);
    h.tick(100);
    h.choose(a, "a"); h.choose(b, "b");
    h.tick(200);
    expect(screen.snapshot.phase).toMatchObject({
      id: "vote", monitorVoteResults: { opening: { label: "No" } }, lastMonitorVotePhaseId: "opening",
    });
    cast(h, a, 0.9, 2);
    cast(h, b, 0.1);
    h.tick(300);
    h.tick(400);
    if (reunion === "forced") expect(h.engine.adminForceReunion()).toEqual({ ok: true });
    else h.tick(1400);
    const expected = { opening: { label: "No" }, vote: { label: "Yes", color: "#ff3300" } };
    expect(screen.snapshot.phase.id).toBe("together");
    expect(screen.snapshot.phase.monitorVoteResults).toEqual(expected);
    expect(screen.snapshot.phase.lastMonitorVotePhaseId).toBe("vote");
    expect(joinMonitor(h).snapshot.phase.monitorVoteResults).toEqual(expected);

    const togetherAt = reunion === "forced" ? 400 : 1400;
    h.tick(togetherAt + 1000);
    cast(h, a, 0.9, 3);
    h.tick(togetherAt + 1100);
    expect(h.engine.getSnapshot().lastMonitorVotePhaseId).toBe("closing");
    expect(h.engine.getSnapshot().monitorVoteResults).toEqual({ ...expected, closing: { label: "Yes" } });
    h.tick(togetherAt + 2100);
    expect(h.engine.getSnapshot()).toMatchObject({ id: "idle", monitorVoteResults: {} });
    expect(h.engine.getSnapshot().lastMonitorVotePhaseId).toBeUndefined();
    h.engine.stop();
  });

  it("carries a nested followed vote to the outer reunion after its path is cleared", () => {
    const vote = scenario.phases.find(phase => phase.kind === "position-question")!;
    const value = scenarioSchema.parse({
      ...scenario,
      monitorGroupId: "c",
      phases: [
        ...scenario.phases.map(phase => phase.kind === "group-branch" ? { ...phase,
          branches: phase.branches.map(branch => branch.groupId === "a" ? { ...branch, next: "roles" } : branch) } : phase),
        { kind: "group-branch", id: "roles", title: "Choose a trade", sourceGroupIds: ["a"], durationMs: 100,
          assignment: { type: "self-select" }, branches: [{ groupId: "a" }, { groupId: "c", next: "nested-vote" }], next: "parent-vote" },
        { ...vote, id: "nested-vote", next: { type: "fixed", target: "parent-vote" } },
        { ...vote, id: "parent-vote" },
      ],
    });
    const h = setup(value);
    const a = h.phone("one"), b = h.phone("two");
    const screen = joinMonitor(h);
    h.engine.adminStart();
    h.choose(a, "a"); h.choose(b, "b");
    h.tick(100);
    h.choose(a, "c");
    h.tick(200);
    expect(screen.snapshot.phase.id).toBe("nested-vote");
    cast(h, a, 0.9);
    h.tick(300);
    expect(h.engine.currentPhaseId).toBe("split");
    expect(a.snapshot.phase.id).toBe("parent-vote");
    cast(h, a, 0.1, 2);
    h.tick(400);
    expect(h.cues.find(cue => cue.type === "result" && cue.phaseId === "parent-vote")?.payload.quadrantCounts).toEqual({ min: 1, max: 0 });
    h.tick(1100);
    expect(screen.snapshot.phase.id).toBe("together");
    expect(screen.snapshot.phase.monitorVoteResults).toEqual({ "nested-vote": { label: "Yes" } });
    expect(screen.snapshot.phase.lastMonitorVotePhaseId).toBe("nested-vote");
    h.engine.stop();
  });

  it("follows the chosen group, restores its clock on reconnect, clears while waiting and rejoins", () => {
    const value = scenarioSchema.parse({ ...scenario, monitorGroupId: "a", phases: scenario.phases.map(p => p.id === "vote"
      ? { ...p, monitorCues: { M1: [{ kind: "text", text: "Choose now", startMs: 0 }] } } : p) });
    const h = setup(value); const a = h.phone("one"); const b = h.phone("two");
    const theater = h.display("b");
    const join = () => { const screen = new Socket(); h.send(screen, { t: "display_join", v: 2, clientVersion: "test",
      installationId: "inst", roomId: "room", displayToken: "secret", monitorId: "M1" }); return screen; };
    const screen = join(); h.engine.adminStart(); h.choose(a, "a"); h.choose(b, "b"); h.tick(100);
    expect(screen.snapshot.phase).toMatchObject({ id: "vote", startedAt: 100, monitorCues: { M1: [{ text: "Choose now" }] } });
    expect(theater.snapshot.phase.id).toBe("film");
    h.setNow(150); const replacement = join();
    expect(replacement.snapshot.phase).toMatchObject({ id: "vote", startedAt: 100 });
    expect(h.engine.adminJumpGroup("a", "vote", 150)).toEqual({ ok: true });
    h.tick(150);
    expect(replacement.snapshot.phase.startedAt).toBe(150);
    h.tick(250); h.tick(251);
    expect(replacement.snapshot.phase.monitorCues).toBeUndefined();
    expect(theater.snapshot.phase.id).toBe("film");
    h.tick(1100);
    expect(replacement.snapshot.phase.id).toBe("together");
    h.engine.stop();
  });
  it("rejects an unknown monitor group", () => {
    const value = scenarioSchema.parse({ ...scenario, monitorGroupId: "missing" });
    expect(validateScenario(value).errors.some(e => e.code === "unknown-group" && e.message.includes("monitorGroupId"))).toBe(true);
  });
});

it("sends the tablet script excerpt only to the groups a scene names, with their speaker", () => {
  const configured = scenarioSchema.parse({ ...scenario,
    actorScript: { title: "Act 1", text: "Prologue\n\nBUILDER: First line\n\nACTOR: Reply\n\nEpilogue", speakersByGroup: { b: "BUILDER" } },
    phases: scenario.phases.map((phase) => phase.id === "film" ? { ...phase, tabletScript: { fromParagraph: 1, toParagraph: 2, groupIds: ["b", "c"] } } : phase) });
  expect(validateScenario(configured).errors).toEqual([]);
  const h = setup(configured); const display = h.display();
  const a = h.phone("one"), b = h.phone("two"), c = h.phone("three"); h.engine.adminStart();
  h.choose(a, "a"); h.choose(b, "b"); h.choose(c, "c");
  h.tick(100);
  expect(b.snapshot).toMatchObject({ phase: { id: "film" }, tabletScript: { title: "Act 1", paragraphs: ["BUILDER: First line", "ACTOR: Reply"], speaker: "BUILDER" } });
  expect(c.snapshot.tabletScript).toEqual({ title: "Act 1", paragraphs: ["BUILDER: First line", "ACTOR: Reply"] });
  expect(a.snapshot.phase.id).toBe("vote");
  // Nobody outside the named groups, and no display, ever receives the script text.
  for (const socket of [a, display]) expect(JSON.stringify(socket.sent)).not.toContain("First line");
  h.engine.stop();
});

it("sends another group its own script range in the same scene, with its lines as its speaker", () => {
  const configured = scenarioSchema.parse({ ...scenario,
    actorScript: { title: "Act 1", text: "Prologue\n\nBUILDER: First line\n\nACTOR: Reply\n\nCHOR:\nWir sehen euch!", speakersByGroup: { b: "BUILDER", c: "CHOR" } },
    phases: scenario.phases.map((phase) => phase.id === "film" ? { ...phase,
      tabletScript: { fromParagraph: 1, toParagraph: 2, groupIds: ["b"] },
      moreTabletScripts: [{ fromParagraph: 3, toParagraph: 3, groupIds: ["c"] }] } : phase) });
  expect(validateScenario(configured).errors).toEqual([]);
  const h = setup(configured);
  const a = h.phone("one"), b = h.phone("two"), c = h.phone("three"); h.engine.adminStart();
  h.choose(a, "a"); h.choose(b, "b"); h.choose(c, "c");
  h.tick(100);
  expect(b.snapshot.tabletScript).toEqual({ title: "Act 1", paragraphs: ["BUILDER: First line", "ACTOR: Reply"], speaker: "BUILDER" });
  expect(c.snapshot.tabletScript).toEqual({ title: "Act 1", paragraphs: ["CHOR:\nWir sehen euch!"], speaker: "CHOR" });
  expect(JSON.stringify(c.sent)).not.toContain("First line");
  expect(JSON.stringify(b.sent)).not.toContain("Wir sehen euch");
  h.engine.stop();
});

it("rejects a further tablet script range past the end of the script", () => {
  const configured = scenarioSchema.parse({ ...scenario,
    actorScript: { title: "Act 1", text: "Prologue\n\nCHOR: Line" },
    phases: scenario.phases.map((phase) => phase.id === "film" ? { ...phase, moreTabletScripts: [{ fromParagraph: 1, toParagraph: 5, groupIds: ["c"] }] } : phase) });
  expect(validateScenario(configured).errors.some((error) => error.phaseId === "film" && error.message.includes("paragraph 6"))).toBe(true);
});

it("counts a phone button vote in the curtain-light field", () => {
  const value = scenarioSchema.parse({
    ...scenario,
    curtainLight: { src: "curtain.mp4" },
    groups: scenario.groups!.map(group => ({ ...group, votingMethod: "phone-buttons" })),
    phases: scenario.phases.map(phase => phase.id === "vote" ? { ...phase, curtainLightVote: true } : phase),
  });
  expect(validateScenario(value).ok).toBe(true);
  const h = setup(value);
  const phone = h.phone("one");
  h.engine.adminStart();
  h.choose(phone, "a");
  h.tick(100);
  h.send(phone, { t: "button_vote", v: 2, sessionId: "visit", phaseEpoch: phone.snapshot.phaseEpoch, outcome: "max" });
  h.tick(200);
  expect(h.cues.find(cue => cue.type === "result")?.payload.quadrantCounts).toEqual({ min: 0, max: 1 });
  h.engine.stop();
});

describe("late arrivals with a device-fixed group", () => {
  const byDevice = scenarioSchema.parse({
    version: "by-device", entryPhaseId: "split", cyclesAllowed: false,
    groups: [{ id: "ki", label: "KI" }, { id: "theater", label: "Theater" }],
    groupByClient: { native: "ki", web: "theater" },
    phases: [
      { kind: "idle", id: "idle" },
      { kind: "group-branch", id: "split", title: "Split", durationMs: 100,
        assignment: { type: "manual", fallbackGroupId: "theater" }, branches: [{ groupId: "ki", next: "ki-film" }, { groupId: "theater", next: "scale" }], next: "together" },
      { kind: "video", id: "ki-film", src: "ki.mp4", expectedDurationMs: 600_000, next: "together" },
      { kind: "position-question", id: "scale", text: "How often?", durationMs: 600_000, freezeMs: 0,
        connectionStaleAfterMs: 1_000_000, showLiveCounts: true,
        field: { type: "two-quadrant", axis: "x", variant: "split", labels: { minLabel: "Never", maxLabel: "Daily" } },
        next: { type: "fixed", target: "together" } },
      { kind: "video", id: "together", src: "together.mp4", expectedDurationMs: 1_000, next: "idle" },
    ],
  });

  afterEach(() => vi.useRealTimers());

  it("puts a browser that joins after the split into the theater scene, with its cursor on the theater display and its vote counted", () => {
    vi.useFakeTimers();
    const h = setup(byDevice); h.display();
    const projector = h.display("theater");
    h.phone("tablet", "native"); h.phone("early", "web");
    h.engine.start(); h.engine.adminStart(); h.tick(100);
    h.setNow(30_000);
    const guest = h.phone("guest", "web");
    expect(guest.snapshot.phase.id).toBe("scale");
    expect(h.engine.groupPaths.find((p) => p.groupId === "theater")?.memberIds).toEqual(["early", "guest"]);
    expect(h.audio.at(-1)).toEqual({ ids: ["guest"], phase: "scale" });
    h.send(guest, { t: "input", v: 2, sessionId: guest.snapshot.sessionId, phaseEpoch: guest.snapshot.phaseEpoch, seq: 1, x: 0.9, y: 0.5 });
    vi.advanceTimersByTime(100);
    const cursors = projector.sent.filter((m) => m.t === "cursors").at(-1);
    expect(cursors?.cursors.map((c: { clientId: string }) => c.clientId)).toContain("guest");
    h.tick(600_100);
    expect(h.votes[0]?.votes.find((v) => v.participantId === "guest")).toMatchObject({ x: 0.9 });
    h.engine.stop();
  });

  it("puts a tablet that joins after the split into the KI scene", () => {
    const h = setup(byDevice); h.display();
    h.phone("tablet", "native"); h.phone("early", "web");
    h.engine.adminStart(); h.tick(100);
    const late = h.phone("late-tablet", "native");
    expect(late.snapshot.phase.id).toBe("ki-film");
    expect(h.engine.groupPaths.find((p) => p.groupId === "ki")?.memberIds).toEqual(["tablet", "late-tablet"]);
    h.engine.stop();
  });

  it("leaves a late arrival whose group is not fixed by its device waiting for the operator", () => {
    const h = setup(); h.display();
    const b = h.phone("two"); h.engine.adminStart(); h.choose(b, "b"); h.tick(100);
    const late = h.phone("late", "web");
    expect(late.snapshot.phase.id).toBe("split");
    expect(h.engine.groupPaths.flatMap((p) => p.memberIds)).not.toContain("late");
    expect(h.audio.at(-1)).toEqual({ ids: ["late"], phase: "idle" });
    h.engine.stop();
  });
});

it("reports expected phone audio for per-group tracks and excludes unassigned late arrivals", () => {
  const value = scenarioSchema.parse({ ...scenario, phases: scenario.phases.map(p => p.id === "film" ? { ...p, phoneAudioByGroup: { b: "builders.mp3" } } : p) });
  const h = setup(value); h.display(); const one = h.phone("one"); const two = h.phone("two");
  h.engine.adminStart(); h.choose(one, "a"); h.choose(two, "b"); h.tick(100);
  expect(two.snapshot.phase.id).toBe("film");
  expect(h.engine.timingMonitors.find(r => r.id === "phone:two")?.mediaExpected).toBe(true);
  expect(h.engine.timingMonitors.find(r => r.id === "phone:one")?.mediaExpected).toBe(false);
  h.phone("late");
  expect(h.engine.timingMonitors.find(r => r.id === "phone:late")?.mediaExpected).toBe(false);
  h.engine.stop();
});
