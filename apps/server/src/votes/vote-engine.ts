import type {
  CountablePositionVoteStatus,
  PositionQuestionPhase,
  PositionVoteStatus,
} from "@smartphonecracy/scenario";
import {
  countPositionQuadrants,
  DEFAULT_INSTALLATION_POLICY,
  materializePositionStatus,
  resolvePositionPlurality,
  resolvePositionFixedTransition,
  type FourQuadrant,
  type FourQuadrantField,
  type PositionField,
  type PositionQuadrantCounts,
  type TwoQuadrant,
  type TwoQuadrantField,
} from "@smartphonecracy/shared";

export type VoteParticipantSeed = {
  participantId: string;
  connected: boolean;
  lastHeartbeatAt: number | null;
};

export type PositionVote = {
  sessionId: string;
  questionId: string;
  participantId: string;
  x: number | null;
  y: number | null;
  status: PositionVoteStatus;
  lastInputAt: number | null;
  lastHeartbeatAt: number | null;
  currentPhaseStartedAt: number;
  currentPhaseDeadline: number;
  recordedAt: number;
};

export type FinalVoteSnapshot = {
  sessionId: string;
  questionId: string;
  phaseEpoch: number;
  recordedAt: number;
  votes: readonly PositionVote[];
};

type FourQuadrantResolution = {
  field: FourQuadrantField;
  quadrantCounts: PositionQuadrantCounts<FourQuadrantField>;
  winner: FourQuadrant | "tie" | "empty" | "fixed";
  resolvedTarget: string;
};

type TwoQuadrantResolution = {
  field: TwoQuadrantField;
  quadrantCounts: PositionQuadrantCounts<TwoQuadrantField>;
  winner: TwoQuadrant | "tie" | "empty" | "fixed";
  resolvedTarget: string;
};

export type VoteResolution = (FourQuadrantResolution | TwoQuadrantResolution) & {
  snapshot: FinalVoteSnapshot;
};

export type LiveQuestionStatus = (Pick<FourQuadrantResolution, "field" | "quadrantCounts"> | Pick<TwoQuadrantResolution, "field" | "quadrantCounts">) & {
  connectedCount: number;
  positionedCount: number;
};

type MutableVote = {
  participantId: string;
  connected: boolean;
  x: number | null;
  y: number | null;
  lastInputAt: number | null;
  lastHeartbeatAt: number | null;
};

function clampCoordinate(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function statusOf(vote: MutableVote, now: number, staleAfterMs: number): PositionVoteStatus {
  return materializePositionStatus(vote, now, staleAfterMs);
}

function freezeVote(vote: PositionVote): PositionVote {
  return Object.freeze(vote);
}

/**
 * Resolve an immutable final snapshot. This is deliberately a pure resolver:
 * Fixed transitions retain real positional counts but deliberately produce no
 * quadrant winner; plurality transitions additionally apply status filtering.
 */
export function resolveSnapshot(
  question: PositionQuestionPhase,
  snapshot: FinalVoteSnapshot,
): Omit<VoteResolution, "snapshot"> {
  if (question.next.type === "fixed") {
    return question.field.type === "four-quadrant"
      ? resolvePositionFixedTransition(question.field, snapshot.votes, question.next.target)
      : resolvePositionFixedTransition(question.field, snapshot.votes, question.next.target);
  }

  const counted = new Set<CountablePositionVoteStatus>(question.next.countedStatuses);
  if (question.field.type === "four-quadrant") {
    const outcome = resolvePositionPlurality(question.field, snapshot.votes, counted);
    const resolvedTarget = outcome.winner === "empty"
      ? question.next.empty
      : outcome.winner === "tie"
        ? question.next.tie
        : (question.next.map as Record<FourQuadrant, string>)[outcome.winner];
    return { ...outcome, resolvedTarget };
  }
  const outcome = resolvePositionPlurality(question.field, snapshot.votes, counted);
  const resolvedTarget = outcome.winner === "empty"
    ? question.next.empty
    : outcome.winner === "tie"
      ? question.next.tie
      : (question.next.map as Record<TwoQuadrant, string>)[outcome.winner];
  return { ...outcome, resolvedTarget };
}

export class VoteEngine {
  private readonly onSnapshotEnqueued: ((snapshot: FinalVoteSnapshot) => void) | undefined;
  private readonly heartbeatRetentionMs: number;
  private readonly heartbeatTimes = new Map<string, number>();
  private nextHeartbeatPruneAt: number | null = null;
  private question: {
    sessionId: string;
    question: PositionQuestionPhase;
    phaseEpoch: number;
    phaseStartedAt: number;
    phaseDeadline: number;
    votes: Map<string, MutableVote>;
    finalized: FinalVoteSnapshot | null;
    resolution: VoteResolution | null;
  } | null = null;
  private _lastSnapshot: FinalVoteSnapshot | null = null;

  constructor(options: {
    heartbeatRetentionMs?: number;
    onSnapshotEnqueued?: (snapshot: FinalVoteSnapshot) => void;
  } = {}) {
    this.heartbeatRetentionMs = options.heartbeatRetentionMs
      ?? DEFAULT_INSTALLATION_POLICY.participantLeaseTtlMs;
    if (this.heartbeatRetentionMs <= 0) throw new Error("heartbeatRetentionMs must be positive");
    this.onSnapshotEnqueued = options.onSnapshotEnqueued;
  }

  get lastSnapshot(): FinalVoteSnapshot | null {
    return this._lastSnapshot;
  }

  beginQuestion(options: {
    sessionId: string;
    question: PositionQuestionPhase;
    phaseEpoch: number;
    phaseStartedAt: number;
    phaseDeadline: number;
    participants: readonly VoteParticipantSeed[];
  }): void {
    this.pruneHeartbeatTimes(options.phaseStartedAt);
    const votes = new Map<string, MutableVote>();
    for (const participant of options.participants) {
      const heartbeat = this.heartbeatTimes.get(participant.participantId) ?? participant.lastHeartbeatAt;
      if (heartbeat !== null) this.rememberHeartbeat(participant.participantId, heartbeat);
      votes.set(participant.participantId, {
        participantId: participant.participantId,
        connected: participant.connected,
        x: null,
        y: null,
        lastInputAt: null,
        lastHeartbeatAt: heartbeat,
      });
    }
    this.question = {
      sessionId: options.sessionId,
      question: options.question,
      phaseEpoch: options.phaseEpoch,
      phaseStartedAt: options.phaseStartedAt,
      phaseDeadline: options.phaseDeadline,
      votes,
      finalized: null,
      resolution: null,
    };
  }

  addParticipant(participant: VoteParticipantSeed, now: number): void {
    this.pruneHeartbeatTimes(now);
    const question = this.question;
    if (!question || question.finalized !== null || now >= question.phaseDeadline) return;
    const heartbeat = this.heartbeatTimes.get(participant.participantId)
      ?? participant.lastHeartbeatAt
      ?? now;
    this.rememberHeartbeat(participant.participantId, heartbeat);
    const existing = question.votes.get(participant.participantId);
    if (existing) {
      existing.connected = participant.connected;
      existing.lastHeartbeatAt = heartbeat;
      return;
    }
    question.votes.set(participant.participantId, {
      participantId: participant.participantId,
      connected: participant.connected,
      x: null,
      y: null,
      lastInputAt: null,
      lastHeartbeatAt: heartbeat,
    });
  }

  recordHeartbeat(participantId: string, now: number): boolean {
    this.pruneHeartbeatTimes(now);
    this.rememberHeartbeat(participantId, now);
    const question = this.question;
    if (!question || question.finalized !== null || now >= question.phaseDeadline) return false;
    const vote = question.votes.get(participantId);
    if (!vote) return false;
    vote.connected = true;
    vote.lastHeartbeatAt = now;
    return true;
  }

  recordInput(participantId: string, x: number, y: number, now: number): boolean {
    const question = this.question;
    if (!question || question.finalized !== null || now >= question.phaseDeadline) return false;
    const vote = question.votes.get(participantId);
    if (!vote) return false;
    vote.connected = true;
    vote.x = clampCoordinate(x);
    vote.y = clampCoordinate(y);
    vote.lastInputAt = now;
    vote.lastHeartbeatAt = now;
    this.pruneHeartbeatTimes(now);
    this.rememberHeartbeat(participantId, now);
    return true;
  }

  setConnected(participantId: string, connected: boolean, now: number): boolean {
    const question = this.question;
    if (!question || question.finalized !== null || now >= question.phaseDeadline) return false;
    const vote = question.votes.get(participantId);
    if (!vote) return false;
    vote.connected = connected;
    return true;
  }

  liveStatus(now: number): LiveQuestionStatus | null {
    const question = this.question;
    if (!question) return null;
    const status = this.statusForVotes(question.votes.values(), now, question.question.connectionStaleAfterMs);
    const counts = this.countVotes(
      question.votes.values(),
      status,
      question.question.field,
      question.question.next,
    );
    let connectedCount = 0;
    let positionedCount = 0;
    for (const vote of question.votes.values()) {
      if (vote.connected) connectedCount += 1;
      if (vote.x !== null && vote.y !== null) positionedCount += 1;
    }
    return { field: question.question.field, connectedCount, positionedCount, quadrantCounts: counts } as LiveQuestionStatus;
  }

  finalize(now: number): VoteResolution | null {
    const question = this.question;
    if (!question) return null;
    if (question.resolution) return question.resolution;

    const recordedAt = Math.min(now, question.phaseDeadline);
    const votes = [...this.snapshotVotes(question.votes.values(), recordedAt, question.question.connectionStaleAfterMs, question)];
    const snapshot: FinalVoteSnapshot = Object.freeze({
      sessionId: question.sessionId,
      questionId: question.question.id,
      phaseEpoch: question.phaseEpoch,
      recordedAt,
      votes: Object.freeze(votes),
    });
    // Mark it final before the hook so a synchronous snapshot consumer cannot
    // accidentally re-enter and mutate the live question.
    question.finalized = snapshot;
    this._lastSnapshot = snapshot;
    this.onSnapshotEnqueued?.(snapshot);

    const resolved = resolveSnapshot(question.question, snapshot);
    const resolution = { snapshot, ...resolved } as VoteResolution;
    question.resolution = resolution;
    return resolution;
  }

  currentResolution(): VoteResolution | null {
    return this.question?.resolution ?? null;
  }

  currentQuestion(): PositionQuestionPhase | null {
    return this.question?.question ?? null;
  }

  clearQuestion(): void {
    this.question = null;
  }

  private rememberHeartbeat(participantId: string, heartbeatAt: number): void {
    this.heartbeatTimes.set(participantId, heartbeatAt);
    const expiresAt = heartbeatAt + this.heartbeatRetentionMs;
    if (this.nextHeartbeatPruneAt === null || expiresAt < this.nextHeartbeatPruneAt) {
      this.nextHeartbeatPruneAt = expiresAt;
    }
  }

  private pruneHeartbeatTimes(now: number): void {
    if (this.nextHeartbeatPruneAt === null || now < this.nextHeartbeatPruneAt) return;
    const cutoff = now - this.heartbeatRetentionMs;
    let nextPruneAt: number | null = null;
    for (const [participantId, heartbeatAt] of this.heartbeatTimes) {
      if (heartbeatAt <= cutoff) {
        this.heartbeatTimes.delete(participantId);
        continue;
      }
      const expiresAt = heartbeatAt + this.heartbeatRetentionMs;
      if (nextPruneAt === null || expiresAt < nextPruneAt) nextPruneAt = expiresAt;
    }
    this.nextHeartbeatPruneAt = nextPruneAt;
  }

  private statusForVotes(
    votes: Iterable<MutableVote>,
    now: number,
    staleAfterMs: number,
  ): Map<string, PositionVoteStatus> {
    const statuses = new Map<string, PositionVoteStatus>();
    for (const vote of votes) statuses.set(vote.participantId, statusOf(vote, now, staleAfterMs));
    return statuses;
  }

  private countVotes(
    votes: Iterable<MutableVote>,
    statuses: Map<string, PositionVoteStatus>,
    field: PositionField,
    next: PositionQuestionPhase["next"],
  ): PositionQuadrantCounts {
    const counted = next.type === "quadrant-plurality"
      ? new Set<CountablePositionVoteStatus>(next.countedStatuses)
      : undefined;
    const positioned = [...votes].map((vote) => ({
      x: vote.x,
      y: vote.y,
      status: statuses.get(vote.participantId) ?? "never-moved",
    }));
    return countPositionQuadrants(field, positioned, counted);
  }

  private snapshotVotes(
    votes: Iterable<MutableVote>,
    recordedAt: number,
    staleAfterMs: number,
    question: NonNullable<VoteEngine["question"]>,
  ): PositionVote[] {
    const materialized = [...votes];
    const statuses = this.statusForVotes(materialized, recordedAt, staleAfterMs);
    return materialized.map((vote) => freezeVote({
      sessionId: question.sessionId,
      questionId: question.question.id,
      participantId: vote.participantId,
      x: vote.x,
      y: vote.y,
      status: statuses.get(vote.participantId)!,
      lastInputAt: vote.lastInputAt,
      lastHeartbeatAt: vote.lastHeartbeatAt,
      currentPhaseStartedAt: question.phaseStartedAt,
      currentPhaseDeadline: question.phaseDeadline,
      recordedAt,
    }));
  }
}
