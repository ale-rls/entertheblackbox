/**
 * Applause/boo tally for a rating-enabled video phase. Deliberately simpler
 * than VoteEngine: taps are unlimited per participant (pure increment
 * counters, no per-participant vote slot), there is no deadline/freeze
 * concept, and the result is only ever a displayed live signal -- it never
 * drives `next`.
 */
export type RatingIdentity = {
  sessionId: string;
  phaseId: string;
  phaseEpoch: number;
};

export type RatingStatus = {
  candidateLabel: string;
  applause: number;
  boo: number;
};

export class RatingEngine {
  private active: (RatingIdentity & { candidateLabel: string; applause: number; boo: number }) | null = null;

  begin(options: RatingIdentity & { candidateLabel: string }): void {
    this.active = { ...options, applause: 0, boo: 0 };
  }

  recordReaction(sessionId: string, phaseEpoch: number, kind: "applause" | "boo"): boolean {
    const active = this.active;
    if (!active || active.sessionId !== sessionId || active.phaseEpoch !== phaseEpoch) return false;
    if (kind === "applause") active.applause += 1;
    else active.boo += 1;
    return true;
  }

  liveStatus(): RatingStatus | null {
    if (!this.active) return null;
    const { candidateLabel, applause, boo } = this.active;
    return { candidateLabel, applause, boo };
  }

  clear(): void {
    this.active = null;
  }
}
