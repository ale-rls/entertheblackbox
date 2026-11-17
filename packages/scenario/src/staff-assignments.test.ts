import { describe, expect, it } from "vitest";
import { scenarioSchema, validateScenario } from "./index.js";

const scenario = (pick: object) => ({
  version: "staff", entryPhaseId: "hold",
  groups: [{ id: "stage", label: "Stage" }, { id: "vector", label: "VECTOR" }],
  participantRoles: [{ id: "lead-vector", label: "VECTOR", capacity: 1 }],
  staffAssignments: [{ id: "vector", label: "VECTOR", ...pick }],
  phases: [{ kind: "idle", id: "idle" }, { kind: "narration", id: "hold", text: "Hold", durationMs: 1000, next: "idle" }],
});

describe("staffAssignments", () => {
  it("accepts a pick with a known role and group", () => {
    expect(validateScenario(scenarioSchema.parse(scenario({ roleId: "lead-vector", groupId: "vector" }))).errors).toEqual([]);
  });
  it("rejects a pick with neither role nor group", () => {
    expect(scenarioSchema.safeParse(scenario({})).success).toBe(false);
  });
  it("reports unknown roles and groups", () => {
    const codes = validateScenario(scenarioSchema.parse(scenario({ roleId: "ghost", groupId: "nowhere" }))).errors.map((e) => e.code);
    expect(codes).toEqual(expect.arrayContaining(["broken-target", "unknown-group"]));
  });
});
