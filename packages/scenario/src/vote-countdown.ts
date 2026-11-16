/** Seconds of centred close countdown when a vote names none. */
export const DEFAULT_VOTE_COUNTDOWN_SECONDS = 5;
export const MIN_VOTE_COUNTDOWN_SECONDS = 1;
export const MAX_VOTE_COUNTDOWN_SECONDS = 60;

type VoteCountdownFields = { closeCountdownSeconds?: 5 | 10 | undefined; voteCountdownSeconds?: number | undefined };

/**
 * Length of a vote's centred close countdown. `voteCountdownSeconds` carries any length;
 * the legacy `closeCountdownSeconds` (5 or 10 only) is what installed native apps validate,
 * so lengths other than 5/10 must never be written there.
 */
export function voteCountdownSeconds(phase: VoteCountdownFields): number {
  return phase.voteCountdownSeconds ?? phase.closeCountdownSeconds ?? DEFAULT_VOTE_COUNTDOWN_SECONDS;
}

/** Writes a countdown length in the field old native apps can still parse. */
export function withVoteCountdownSeconds<T extends VoteCountdownFields>(phase: T, seconds: number): T {
  const whole = Math.round(seconds);
  const clamped = Math.min(MAX_VOTE_COUNTDOWN_SECONDS, Math.max(MIN_VOTE_COUNTDOWN_SECONDS, Number.isFinite(whole) ? whole : DEFAULT_VOTE_COUNTDOWN_SECONDS));
  const { closeCountdownSeconds: _legacy, voteCountdownSeconds: _any, ...rest } = phase;
  return (clamped === 5 || clamped === 10
    ? { ...rest, closeCountdownSeconds: clamped }
    : { ...rest, voteCountdownSeconds: clamped }) as T;
}
