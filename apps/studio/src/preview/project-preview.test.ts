// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import scenario from "../../../../content/scenarios/dev.json";
import manifest from "../../../../content/media-manifest.json";
import { importRuntime } from "../io.js";
import { projectPreviewUrl, readProjectPreview, storeProjectPreview } from "./project-preview.js";

const project = importRuntime(scenario, manifest).project;

describe("project preview handoff", () => {
  beforeEach(() => localStorage.clear());

  it("stores the current project and selected starting phase for a new preview page", () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000000");
    const token = storeProjectPreview("Draft show", project, "question-quadrant");
    expect(readProjectPreview(token)).toMatchObject({ draftName: "Draft show", startPhaseId: "question-quadrant", project: { scenario: { version: project.scenario.version } } });
    expect(projectPreviewUrl(token, "https://example.test/studio/")).toBe("https://example.test/studio/preview.html?preview=00000000-0000-4000-8000-000000000000");
  });

  it("rejects a starting node that is not a project phase", () => {
    expect(() => storeProjectPreview("Draft show", project, "__entry__")).toThrow("is not in this show");
  });
});
