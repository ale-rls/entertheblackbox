import { describe, expect, it } from "vitest";
import type { PhaseSnapshotMessage } from "@entertheblackbox/protocol";
import { monitorVoteResult } from "./voteResult.js";

const cue = { kind: "vote-result" as const, startMs: 0, fallbackText: "No choice" };
const phase = { kind: "narration", lastMonitorVotePhaseId: "latest", monitorVoteResults: {
  topic: { label: "Theater", color: "#e5484d" }, latest: { label: "KI", color: "#3e63dd" }, tie: { label: null },
} } as unknown as PhaseSnapshotMessage;
describe("monitor vote results", () => {
  it("shows the latest winner or keeps an explicitly named topic", () => {
    expect(monitorVoteResult(cue, phase)).toEqual({ text: "KI", color: "#3e63dd" });
    expect(monitorVoteResult({ ...cue, votePhaseId: "topic" }, phase)).toEqual({ text: "Theater", color: "#e5484d" });
  });
  it("uses uncoloured fallback for ties, empty, missing and not-yet-resolved votes", () => {
    expect(monitorVoteResult({ ...cue, votePhaseId: "tie" }, phase)).toEqual({ text: "No choice", color: null });
    expect(monitorVoteResult({ ...cue, votePhaseId: "future" }, phase)).toEqual({ text: "No choice", color: null });
    expect(monitorVoteResult(cue, null)).toEqual({ text: "No choice", color: null });
  });
});
