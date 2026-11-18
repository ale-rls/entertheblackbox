import type { MonitorCue } from "@entertheblackbox/scenario";
import type { PhaseSnapshotMessage } from "@entertheblackbox/protocol";

export function monitorVoteResult(cue: Extract<MonitorCue, { kind: "vote-result" }>, phase: PhaseSnapshotMessage | null) {
  const id = cue.votePhaseId ?? phase?.lastMonitorVotePhaseId;
  const result = id ? phase?.monitorVoteResults?.[id] : undefined;
  return {
    text: result?.label ?? cue.fallbackText,
    color: result?.label != null && result.color && /^#[0-9a-f]{6}$/i.test(result.color) ? result.color : null,
  };
}
