import {
  FOUR_QUADRANTS,
  quadrantOf,
  quadrantOfField,
  quadrantsOfField,
  type PositionField,
  type PositionQuadrant,
  type PositionQuadrantCounts,
  type Quadrant,
} from "./index.js";

export type QuadrantCounts = Record<Quadrant, number>;

export type PositionedVote<Status extends string = string> = {
  x: number | null;
  y: number | null;
  status: Status;
};

export type PositionStatus = "valid" | "stale" | "disconnected" | "never-moved";

export function materializePositionStatus(vote: {
  connected: boolean;
  x: number | null;
  y: number | null;
  lastHeartbeatAt: number | null;
}, now: number, staleAfterMs: number): PositionStatus {
  if (!vote.connected) return "disconnected";
  if (vote.x === null || vote.y === null) return "never-moved";
  if (vote.lastHeartbeatAt === null || now - vote.lastHeartbeatAt >= staleAfterMs) return "stale";
  return "valid";
}

export type VoteClassification<Status extends string> = {
  quadrantCounts: QuadrantCounts;
  includedByStatus: Partial<Record<Status, number>>;
  excludedByStatus: Partial<Record<Status, number>>;
  includedTotal: number;
  excludedTotal: number;
};

export type FieldVoteClassification<
  Field extends PositionField,
  Status extends string,
> = Omit<VoteClassification<Status>, "quadrantCounts"> & {
  field: Field;
  quadrantCounts: PositionQuadrantCounts<Field>;
};

function emptyPositionQuadrantCounts<Field extends PositionField>(
  field: Field,
): PositionQuadrantCounts<Field> {
  if (field.type === "four-quadrant") {
    return { q1: 0, q2: 0, q3: 0, q4: 0 } as PositionQuadrantCounts<Field>;
  }
  if (field.type === "two-quadrant") {
    return { min: 0, max: 0 } as PositionQuadrantCounts<Field>;
  }
  const counts: Record<string, number> = {};
  for (const zone of field.zones) counts[zone.id] = 0;
  return counts as PositionQuadrantCounts<Field>;
}

/** Canonical vote classifier for both two- and four-quadrant fields. */
export function classifyPositionVotesForField<Field extends PositionField, Status extends string>(
  field: Field,
  votes: readonly PositionedVote<Status>[],
  countedStatuses: ReadonlySet<Status>,
): FieldVoteClassification<Field, Status> {
  const quadrantCounts = emptyPositionQuadrantCounts(field);
  const mutableCounts = quadrantCounts as unknown as Record<PositionQuadrant<Field>, number>;
  const includedByStatus: Partial<Record<Status, number>> = {};
  const excludedByStatus: Partial<Record<Status, number>> = {};
  let includedTotal = 0;
  let excludedTotal = 0;
  for (const vote of votes) {
    const hasCoordinates = vote.x !== null && vote.y !== null;
    // Polygon zones need not tile the whole arena, so a positioned vote can
    // still land outside every zone; treat that the same as not having voted.
    const quadrant = hasCoordinates
      ? (quadrantOfField(field, vote.x!, vote.y!) as PositionQuadrant<Field> | null)
      : null;
    const included = hasCoordinates && quadrant !== null && countedStatuses.has(vote.status);
    const totals = included ? includedByStatus : excludedByStatus;
    totals[vote.status] = (totals[vote.status] ?? 0) + 1;
    if (included) {
      includedTotal += 1;
      mutableCounts[quadrant as PositionQuadrant<Field>] += 1;
    } else {
      excludedTotal += 1;
    }
  }
  return {
    field,
    quadrantCounts,
    includedByStatus,
    excludedByStatus,
    includedTotal,
    excludedTotal,
  };
}

export function classifyPositionVotes<Status extends string>(
  votes: readonly PositionedVote<Status>[], countedStatuses: ReadonlySet<Status>,
): VoteClassification<Status> {
  const quadrantCounts: QuadrantCounts = { q1: 0, q2: 0, q3: 0, q4: 0 };
  const includedByStatus: Partial<Record<Status, number>> = {};
  const excludedByStatus: Partial<Record<Status, number>> = {};
  let includedTotal = 0;
  let excludedTotal = 0;
  for (const vote of votes) {
    const included = vote.x !== null && vote.y !== null && countedStatuses.has(vote.status);
    const totals = included ? includedByStatus : excludedByStatus;
    totals[vote.status] = (totals[vote.status] ?? 0) + 1;
    if (included) {
      includedTotal += 1;
      quadrantCounts[quadrantOf(vote.x!, vote.y!)] += 1;
    } else excludedTotal += 1;
  }
  return { quadrantCounts, includedByStatus, excludedByStatus, includedTotal, excludedTotal };
}

export type PluralityOutcome =
  | { winner: Quadrant; quadrantCounts: QuadrantCounts }
  | { winner: "tie" | "empty"; quadrantCounts: QuadrantCounts };

export type PositionPluralityOutcome<Field extends PositionField> = {
  field: Field;
  winner: PositionQuadrant<Field> | "tie" | "empty";
  quadrantCounts: PositionQuadrantCounts<Field>;
  tiedCandidates?: PositionQuadrant<Field>[];
};

export function countPositionQuadrants<Field extends PositionField, Status extends string>(
  field: Field,
  votes: readonly PositionedVote<Status>[],
  countedStatuses?: ReadonlySet<Status>,
): PositionQuadrantCounts<Field> {
  const counts = emptyPositionQuadrantCounts(field);
  const mutableCounts = counts as unknown as Record<PositionQuadrant<Field>, number>;
  for (const vote of votes) {
    if (vote.x === null || vote.y === null) continue;
    if (countedStatuses !== undefined && !countedStatuses.has(vote.status)) continue;
    const quadrant = quadrantOfField(field, vote.x, vote.y) as PositionQuadrant<Field> | null;
    if (quadrant === null) continue;
    mutableCounts[quadrant] += 1;
  }
  return counts;
}

export function resolvePositionPlurality<Field extends PositionField, Status extends string>(
  field: Field,
  votes: readonly PositionedVote<Status>[],
  countedStatuses: ReadonlySet<Status>,
): PositionPluralityOutcome<Field> {
  const quadrantCounts = classifyPositionVotesForField(field, votes, countedStatuses).quadrantCounts;
  const quadrants = quadrantsOfField(field) as unknown as readonly PositionQuadrant<Field>[];
  const readableCounts = quadrantCounts as unknown as Record<PositionQuadrant<Field>, number>;
  const highest = Math.max(...quadrants.map((quadrant) => readableCounts[quadrant]));
  if (highest === 0) return { field, winner: "empty", quadrantCounts };
  const winners = quadrants.filter((quadrant) => readableCounts[quadrant] === highest);
  return winners.length === 1
    ? { field, winner: winners[0]!, quadrantCounts }
    : { field, winner: "tie", quadrantCounts, tiedCandidates: [...winners] };
}

export function resolvePositionFixedTransition<Field extends PositionField, Status extends string>(
  field: Field,
  votes: readonly PositionedVote<Status>[],
  resolvedTarget: string,
): {
  field: Field;
  winner: "fixed";
  quadrantCounts: PositionQuadrantCounts<Field>;
  resolvedTarget: string;
} {
  return {
    field,
    winner: "fixed",
    quadrantCounts: countPositionQuadrants(field, votes),
    resolvedTarget,
  };
}

export function resolveFixedTransition<Status extends string>(
  votes: readonly PositionedVote<Status>[], resolvedTarget: string,
): { winner: "fixed"; quadrantCounts: QuadrantCounts; resolvedTarget: string } {
  return { winner: "fixed", quadrantCounts: countQuadrants(votes), resolvedTarget };
}

export function countQuadrants<Status extends string>(
  votes: readonly PositionedVote<Status>[],
  countedStatuses?: ReadonlySet<Status>,
): QuadrantCounts {
  const counts: QuadrantCounts = { q1: 0, q2: 0, q3: 0, q4: 0 };
  for (const vote of votes) {
    if (vote.x === null || vote.y === null) continue;
    if (countedStatuses !== undefined && !countedStatuses.has(vote.status)) continue;
    counts[quadrantOf(vote.x, vote.y)] += 1;
  }
  return counts;
}

export function resolveQuadrantPlurality<Status extends string>(
  votes: readonly PositionedVote<Status>[],
  countedStatuses: ReadonlySet<Status>,
): PluralityOutcome {
  const quadrantCounts = classifyPositionVotes(votes, countedStatuses).quadrantCounts;
  const highest = Math.max(...FOUR_QUADRANTS.map((quadrant) => quadrantCounts[quadrant]));
  if (highest === 0) return { winner: "empty", quadrantCounts };

  const winners = FOUR_QUADRANTS.filter((quadrant) => quadrantCounts[quadrant] === highest);
  return winners.length === 1
    ? { winner: winners[0]!, quadrantCounts }
    : { winner: "tie", quadrantCounts };
}
