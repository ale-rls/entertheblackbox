import { createHash } from "node:crypto";
import { curtainVoteField, quadrantOfField, resolveCurtainSettings } from "@entertheblackbox/shared";
import { curtainStagePhaseIds, type GroupBranchPhase, type PositionField, type Scenario, type VotingMethod } from "@entertheblackbox/scenario";
import type { ParticipantClient } from "@entertheblackbox/protocol";
import type { FinalVoteSnapshot } from "../votes/vote-engine.js";

export type GroupMembership = { participantId: string; groupId: string | null };

/** Session-scoped cohort membership and the individual answer history used by split rules. */
export class GroupManager {
  private readonly membership = new Map<string, string>();
  private readonly answers = new Map<string, Map<string, string>>();
  private readonly awaitingSelection = new Set<string>();
  /** Survives session boundaries: a device stays the same client for its whole visit. */
  private readonly clients = new Map<string, ParticipantClient>();

  private readonly curtainStages: Set<string>;

  constructor(private readonly scenario: Scenario) {
    this.curtainStages = curtainStagePhaseIds(scenario);
  }

  beginSession(participantIds: readonly string[], preserveMembership = false): void {
    const previous = preserveMembership ? new Map(this.membership) : new Map<string, string>();
    this.membership.clear();
    this.answers.clear();
    this.awaitingSelection.clear();
    for (const participantId of participantIds) { const group = previous.get(participantId); if (group && this.scenario.groups?.some(g => g.id === group)) this.membership.set(participantId, group); else this.ensureParticipant(participantId); }
  }

  endSession(): void {
    this.membership.clear();
    this.answers.clear();
    this.awaitingSelection.clear();
  }

  ensureParticipant(participantId: string, client?: ParticipantClient): string | null {
    if (client !== undefined) this.clients.set(participantId, client);
    if (this.awaitingSelection.has(participantId)) return null;
    const current = this.membership.get(participantId);
    if (current !== undefined) return current;
    const known = this.clients.get(participantId);
    const byClient = known === undefined ? undefined : this.scenario.groupByClient?.[known];
    if (byClient !== undefined && this.scenario.groups?.some((group) => group.id === byClient)) {
      this.membership.set(participantId, byClient);
      return byClient;
    }
    const initial = this.scenario.initialGroupIds;
    if (!initial?.length) return null;
    const groupId = this.leastPopulated(initial, participantId);
    this.membership.set(participantId, groupId);
    return groupId;
  }

  retireParticipant(participantId: string): void { this.clients.delete(participantId); this.membership.delete(participantId); this.awaitingSelection.delete(participantId); }

  groupFor(participantId: string): string | null {
    return this.membership.get(participantId) ?? null;
  }

  votingMethodFor(participantId: string): VotingMethod | undefined {
    return this.scenario.groups?.find((group) => group.id === this.groupFor(participantId))?.votingMethod;
  }

  assign(participantId: string, groupId: string): void {
    if (!this.scenario.groups?.some((group) => group.id === groupId)) throw new Error(`Unknown audience group “${groupId}”`);
    this.awaitingSelection.delete(participantId);
    this.membership.set(participantId, groupId);
  }

  recordAnswers(questionId: string, authoredField: PositionField, snapshot: FinalVoteSnapshot): void {
    // Curtain-light votes count with a neutral gap; a position in the gap is no answer here either.
    const field = this.curtainStages.has(questionId)
      ? curtainVoteField(authoredField, resolveCurtainSettings(this.scenario.curtainLight).neutralGap)
      : authoredField;
    for (const vote of snapshot.votes) {
      if (vote.x === null || vote.y === null) continue;
      const outcome = quadrantOfField(field, vote.x, vote.y);
      if (outcome === null) continue;
      const history = this.answers.get(vote.participantId) ?? new Map<string, string>();
      history.set(questionId, outcome);
      this.answers.set(vote.participantId, history);
    }
  }

  applyBranch(phase: GroupBranchPhase, participantIds: readonly string[]): GroupMembership[] {
    const outputIds = phase.branches.map((branch) => branch.groupId);
    const source = participantIds.filter((participantId) => {
      if (!phase.sourceGroupIds) return true;
      const current = this.groupFor(participantId);
      return current !== null && phase.sourceGroupIds.includes(current);
    });
    const ordered = [...source].sort((a, b) => this.stableRank(`${phase.id}:${a}`) - this.stableRank(`${phase.id}:${b}`));
    const counts = new Map(outputIds.map((id) => [id, 0]));

    for (const participantId of ordered) {
      if (phase.assignment.type === "self-select") {
        this.membership.delete(participantId);
        this.awaitingSelection.add(participantId);
        continue;
      }
      let groupId: string;
      if (phase.assignment.type === "vote") {
        const answer = this.answers.get(participantId)?.get(phase.assignment.questionId);
        groupId = (answer && phase.assignment.map[answer]) ?? phase.assignment.fallbackGroupId;
      } else if (phase.assignment.type === "manual") {
        // Existing live assignments are preserved when they are valid outputs.
        const current = this.groupFor(participantId);
        groupId = current && outputIds.includes(current) ? current : phase.assignment.fallbackGroupId;
      } else {
        groupId = this.leastWeighted(phase, counts);
      }
      this.membership.set(participantId, groupId);
      this.awaitingSelection.delete(participantId);
      counts.set(groupId, (counts.get(groupId) ?? 0) + 1);
    }
    return participantIds.map((participantId) => ({ participantId, groupId: this.groupFor(participantId) }));
  }

  snapshot(participantIds: readonly string[]): GroupMembership[] {
    return participantIds.map((participantId) => ({ participantId, groupId: this.groupFor(participantId) }));
  }

  private leastPopulated(groupIds: readonly string[], seed: string): string {
    const counts = new Map(groupIds.map((id) => [id, 0]));
    for (const groupId of this.membership.values()) if (counts.has(groupId)) counts.set(groupId, counts.get(groupId)! + 1);
    return [...groupIds].sort((a, b) => counts.get(a)! - counts.get(b)! || this.stableRank(`${seed}:${a}`) - this.stableRank(`${seed}:${b}`))[0]!;
  }

  private leastWeighted(phase: GroupBranchPhase, counts: Map<string, number>): string {
    return [...phase.branches].sort((a, b) => {
      const aFill = (counts.get(a.groupId) ?? 0) / a.weight;
      const bFill = (counts.get(b.groupId) ?? 0) / b.weight;
      return aFill - bFill || a.groupId.localeCompare(b.groupId);
    })[0]!.groupId;
  }

  private stableRank(value: string): number {
    return createHash("sha256").update(value).digest().readUInt32BE(0);
  }
}
