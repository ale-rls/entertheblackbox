import { describe, expect, it } from "vitest";
import { scenarioSchema, type PositionQuestionPhase } from "@smartphonecracy/scenario";
import { VoteEngine, resolveSnapshot, type FinalVoteSnapshot } from "./vote-engine.js";

const question = scenarioSchema.parse({
  version: "votes-test",
  entryPhaseId: "question",
  phases: [
    { kind: "idle", id: "idle" },
    {
      kind: "position-question",
      id: "question",
      text: "Choose",
      xAxis: { minLabel: "left", maxLabel: "right" },
      yAxis: { minLabel: "up", maxLabel: "down" },
      durationMs: 1_000,
      freezeMs: 30,
      connectionStaleAfterMs: 100,
      showLiveCounts: true,
      next: {
        type: "quadrant-plurality",
        map: { q1: "q1-target", q2: "q2-target", q3: "q3-target", q4: "q4-target" },
        tie: "tie-target",
        empty: "empty-target",
        countedStatuses: ["valid", "stale", "disconnected"],
      },
    },
  ],
}).phases[1] as PositionQuestionPhase;

function begin(
  voteEngine: VoteEngine,
  participants: string[] = ["valid", "never", "stale", "disconnected"],
  next: PositionQuestionPhase["next"] = question.next,
): void {
  voteEngine.beginQuestion({
    sessionId: "session-1",
    question: { ...question, next } as PositionQuestionPhase,
    phaseEpoch: 4,
    phaseStartedAt: 0,
    phaseDeadline: 1_000,
    participants: participants.map((participantId) => ({
      participantId,
      connected: true,
      lastHeartbeatAt: 0,
    })),
  });
}

describe("VoteEngine", () => {
  it("takes one immutable final snapshot with heartbeat staleness and coordinate rules", () => {
    const enqueued: FinalVoteSnapshot[] = [];
    const votes = new VoteEngine({ onSnapshotEnqueued: (snapshot) => enqueued.push(snapshot) });
    begin(votes);

    votes.recordInput("valid", 0.5, 0.25, 10);
    votes.recordHeartbeat("valid", 150);
    votes.recordInput("stale", 0.25, 0.25, 10);
    votes.recordInput("disconnected", 0.25, 0.75, 10);
    votes.setConnected("disconnected", false, 50);

    const resolution = votes.finalize(200)!;
    expect(enqueued).toEqual([resolution.snapshot]);
    expect(resolution.snapshot.votes.map(({ participantId, status, x, y }) => ({ participantId, status, x, y }))).toEqual([
      { participantId: "valid", status: "valid", x: 0.5, y: 0.25 },
      { participantId: "never", status: "never-moved", x: null, y: null },
      { participantId: "stale", status: "stale", x: 0.25, y: 0.25 },
      { participantId: "disconnected", status: "disconnected", x: 0.25, y: 0.75 },
    ]);
    expect(resolution.quadrantCounts).toEqual({ q1: 1, q2: 1, q3: 1, q4: 0 });
    expect(resolution.winner).toBe("tie");
    expect(Object.isFrozen(resolution.snapshot)).toBe(true);
    expect(Object.isFrozen(resolution.snapshot.votes)).toBe(true);
    expect(Object.isFrozen(resolution.snapshot.votes[0])).toBe(true);

    expect(votes.recordInput("valid", 0, 1, 201)).toBe(false);
    expect(votes.finalize(202)).toBe(resolution);
    expect(resolution.snapshot.votes[0]?.x).toBe(0.5);
  });

  it("treats input as participant liveness", () => {
    const votes = new VoteEngine();
    begin(votes, ["active"]);
    votes.recordInput("active", 0.25, 0.25, 150);

    expect(votes.finalize(200)!.snapshot.votes[0]).toMatchObject({
      status: "valid",
      lastHeartbeatAt: 150,
      lastInputAt: 150,
    });
  });

  it("forgets heartbeat IDs past the participant lease TTL while retaining active IDs", () => {
    const votes = new VoteEngine({ heartbeatRetentionMs: 100 });
    begin(votes, ["expired", "active"]);
    votes.recordHeartbeat("expired", 1);
    votes.recordHeartbeat("active", 90);
    votes.clearQuestion();

    votes.beginQuestion({
      sessionId: "session-2",
      question,
      phaseEpoch: 5,
      phaseStartedAt: 102,
      phaseDeadline: 1_102,
      participants: [
        { participantId: "expired", connected: true, lastHeartbeatAt: 80 },
        { participantId: "active", connected: true, lastHeartbeatAt: 80 },
      ],
    });

    expect(votes.finalize(102)!.snapshot.votes.map(({ participantId, lastHeartbeatAt }) => ({
      participantId,
      lastHeartbeatAt,
    }))).toEqual([
      { participantId: "expired", lastHeartbeatAt: 80 },
      { participantId: "active", lastHeartbeatAt: 90 },
    ]);
  });

  it("filters excluded statuses before counting, including a parked cursor", () => {
    const votes = new VoteEngine();
    begin(votes, ["included", "excluded-stale", "excluded-disconnected"], {
      type: "quadrant-plurality",
      map: { q1: "q1-target", q2: "q2-target", q3: "q3-target", q4: "q4-target" },
      tie: "tie-target",
      empty: "empty-target",
      countedStatuses: ["valid"],
    });
    votes.recordInput("included", 0.1, 0.1, 10);
    votes.recordHeartbeat("included", 150);
    votes.recordInput("excluded-stale", 0.9, 0.1, 10);
    votes.recordInput("excluded-disconnected", 0.9, 0.9, 10);
    votes.setConnected("excluded-disconnected", false, 50);

    const result = votes.finalize(200)!;
    expect(result.quadrantCounts).toEqual({ q1: 0, q2: 1, q3: 0, q4: 0 });
    expect(result.winner).toBe("q2");
    expect(result.resolvedTarget).toBe("q2-target");
  });

  it("uses shared quadrantOf boundaries: x=.5 right, y=.5 bottom, center q4", () => {
    const votes = new VoteEngine();
    begin(votes, ["x-boundary", "y-boundary", "center"]);
    for (const participantId of ["x-boundary", "y-boundary", "center"]) votes.recordHeartbeat(participantId, 900);
    votes.recordInput("x-boundary", 0.5, 0.25, 10);
    votes.recordInput("y-boundary", 0.25, 0.5, 10);
    votes.recordInput("center", 0.5, 0.5, 10);

    const result = votes.finalize(950)!;
    expect(result.quadrantCounts).toEqual({ q1: 1, q2: 0, q3: 1, q4: 1 });
    expect(result.winner).toBe("tie");
  });

  it("resolves fixed transitions with real counts but no quadrant winner", () => {
    const votes = new VoteEngine();
    begin(votes, ["participant"], { type: "fixed", target: "fixed-target" });
    votes.recordInput("participant", 0.5, 0.5, 10);
    const snapshot = votes.finalize(20)!.snapshot;
    const resolved = resolveSnapshot({ ...question, next: { type: "fixed", target: "fixed-target" } }, snapshot);
    expect(resolved).toEqual({
      field: question.field,
      quadrantCounts: { q1: 0, q2: 0, q3: 0, q4: 1 },
      winner: "fixed",
      resolvedTarget: "fixed-target",
    });
  });

  it("uses the empty target when no counted participant has a position", () => {
    const votes = new VoteEngine();
    begin(votes, ["never"]);
    const result = votes.finalize(200)!;
    expect(result.quadrantCounts).toEqual({ q1: 0, q2: 0, q3: 0, q4: 0 });
    expect(result.winner).toBe("empty");
    expect(result.resolvedTarget).toBe("empty-target");
  });

  it("computes live counts internally while the caller can omit them from the wire", () => {
    const votes = new VoteEngine();
    begin(votes, ["participant"]);
    votes.recordHeartbeat("participant", 10);
    votes.recordInput("participant", 0.5, 0.5, 10);
    expect(votes.liveStatus(20)?.quadrantCounts).toEqual({ q1: 0, q2: 0, q3: 0, q4: 1 });
  });

  it("resolves a two-quadrant x field with the center boundary on max/right", () => {
    const twoQuestion = scenarioSchema.parse({
      version: "two-x",
      entryPhaseId: "question",
      phases: [{ kind: "idle", id: "idle" }, {
        kind: "position-question",
        id: "question",
        text: "Agree?",
        field: {
          type: "two-quadrant",
          axis: "x",
          labels: { minLabel: "Disagree", maxLabel: "Agree" },
        },
        durationMs: 1_000,
        freezeMs: 30,
        connectionStaleAfterMs: 100,
        showLiveCounts: true,
        next: {
          type: "quadrant-plurality",
          map: { min: "min-target", max: "max-target" },
          tie: "tie-target",
          empty: "empty-target",
          countedStatuses: ["valid"],
        },
      }],
    }).phases[1] as PositionQuestionPhase;
    const votes = new VoteEngine();
    votes.beginQuestion({
      sessionId: "session-1",
      question: twoQuestion,
      phaseEpoch: 1,
      phaseStartedAt: 0,
      phaseDeadline: 1_000,
      participants: ["left", "boundary", "right"].map((participantId) => ({
        participantId,
        connected: true,
        lastHeartbeatAt: 0,
      })),
    });
    votes.recordInput("left", 0.49, 0.1, 900);
    votes.recordInput("boundary", 0.5, 0.1, 900);
    votes.recordInput("right", 0.9, 0.9, 900);

    expect(votes.liveStatus(950)).toMatchObject({
      field: { type: "two-quadrant", axis: "x" },
      quadrantCounts: { min: 1, max: 2 },
    });
    expect(votes.finalize(950)).toMatchObject({
      quadrantCounts: { min: 1, max: 2 },
      winner: "max",
      resolvedTarget: "max-target",
    });
  });

  it("uses y for a two-quadrant y field while preserving both input coordinates", () => {
    const twoQuestion = scenarioSchema.parse({
      version: "two-y",
      entryPhaseId: "question",
      phases: [{ kind: "idle", id: "idle" }, {
        kind: "position-question",
        id: "question",
        text: "Where?",
        field: {
          type: "two-quadrant",
          axis: "y",
          labels: { minLabel: "Top", maxLabel: "Bottom" },
        },
        durationMs: 1_000,
        freezeMs: 0,
        connectionStaleAfterMs: 100,
        showLiveCounts: true,
        next: { type: "fixed", target: "fixed-target" },
      }],
    }).phases[1] as PositionQuestionPhase;
    const votes = new VoteEngine();
    votes.beginQuestion({
      sessionId: "session-1",
      question: twoQuestion,
      phaseEpoch: 1,
      phaseStartedAt: 0,
      phaseDeadline: 1_000,
      participants: [{ participantId: "boundary", connected: true, lastHeartbeatAt: 0 }],
    });
    votes.recordInput("boundary", 0.17, 0.5, 900);

    expect(votes.finalize(950)).toMatchObject({
      quadrantCounts: { min: 0, max: 1 },
      winner: "fixed",
      resolvedTarget: "fixed-target",
      snapshot: { votes: [{ x: 0.17, y: 0.5 }] },
    });
  });
});
