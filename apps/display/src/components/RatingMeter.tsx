import type { RatingStatusMessage } from "@smartphonecracy/protocol";

/**
 * Live applause/boo tally for a rating-enabled video phase (e.g. a
 * candidate's campaign speech). Purely a displayed signal -- it never
 * drives phase transitions.
 */
export function RatingMeter({ status }: { status: RatingStatusMessage | null }) {
  if (status === null) return null;
  return (
    <div className="rating-meter">
      <span className="rating-meter-candidate">{status.candidateLabel}</span>
      <span className="rating-meter-tally">
        <span className="rating-meter-applause">👏 {status.applause}</span>
        <span className="rating-meter-boo">👎 {status.boo}</span>
      </span>
    </div>
  );
}
