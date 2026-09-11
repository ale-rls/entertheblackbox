import { createHash } from "node:crypto";
import { quadrantOfField } from "@entertheblackbox/shared";
import type { GroupBranchPhase, PositionField, Scenario } from "@entertheblackbox/scenario";
import type { FinalVoteSnapshot } from "../votes/vote-engine.js";

export type GroupMembership = { participantId: string; groupId: string | null };

/** Session-scoped cohort membership and the individual answer history used by split rules. */
export class GroupManager {
  private readonly membership = new Map<string, string>();
  private readonly answers = new Map<string, Map<string, string>>();

  constructor(private readonly scenario: Scenario) {}

  beginSession(participantIds: readonly string[]): void {
    this.membership.clear();
    this.answers.clear();
    for (const participantId of participantIds) this.ensureParticipant(participantId);
  }

  endSession(): void {
    this.membership.clear();
    this.answers.clear();
  }

  ensureParticipant(participantId: string): string | null {
    const current = this.membership.get(participantId);
    if (current !== undefined) return current;
    const initial = this.scenario.initialGroupIds;
    if (!initial?.length) return null;
    const groupId = this.leastPopulated(initial, participantId);
    this.membership.set(participantId, groupId);
    return groupId;
  }

  groupFor(participantId: string): string | null {
    return this.membership.get(participantId) ?? null;
  }

  assign(participantId: string, groupId: string): void {
    if (!this.scenario.groups?.some((group) => group.id === groupId)) throw new Error(`Unknown audience group “${groupId}”`);
    this.membership.set(participantId, groupId);
  }

  recordAnswers(questionId: string, field: PositionField, snapshot: FinalVoteSnapshot): void {
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
