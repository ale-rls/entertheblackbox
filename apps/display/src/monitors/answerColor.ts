import { MONITOR_IDS, type MonitorId } from "@entertheblackbox/scenario";
import type { PhaseSnapshotMessage } from "@entertheblackbox/protocol";
import { curtainOutcomes } from "@entertheblackbox/shared";

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * The answer colour a stage monitor shows its text in: monitor N carries the
 * phase's Nth answer (M1 = first zone in outcome order). Only authored colours
 * count — the phase's `answerColors`, or the curtain treatment the server
 * resolved for it — so phases without colour coding stay white.
 */
export function monitorAnswerColor(phase: PhaseSnapshotMessage | null, monitorId: MonitorId): string | null {
  if (!phase || !("field" in phase) || !phase.field) return null;
  const answerId = curtainOutcomes(phase.field)[MONITOR_IDS.indexOf(monitorId)];
  if (answerId === undefined) return null;
  const authored = "answerColors" in phase ? phase.answerColors?.[answerId] : undefined;
  const color = authored ?? phase.voteTreatment?.answerColors[answerId];
  return color !== undefined && HEX.test(color) ? color : null;
}
