import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  RuntimeImportError,
  compileStudioGraph,
  parseRuntimeScenario,
  validateStudioProject,
} from "./index.js";

const fixture = (relativePath: string): unknown =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../../../${relativePath}`, import.meta.url)), "utf8"),
  );

describe("Studio runtime adapter", () => {
  it("round-trips the real dev scenario and manifest without semantic changes", () => {
    const scenario = fixture("content/scenarios/dev.json");
    const manifest = fixture("content/media-manifest.json");

    expect(compileStudioGraph(parseRuntimeScenario(scenario, manifest))).toEqual({
      scenario,
      manifest,
    });
  });

  it("raw-carries unknown fields at every runtime nesting level", () => {
    const scenario = fixture("content/scenarios/dev.json") as Record<string, any>;
    const manifest = fixture("content/media-manifest.json") as Record<string, any>;
    scenario.futureTop = { enabled: true };
    scenario.phases[1].futureVideo = "kept";
    scenario.phases[2].field.xAxis.futureAxis = 42;
    scenario.phases[3].next.futureResolver = ["kept"];
    manifest.futureManifest = true;
    manifest.files[0].futureFile = "kept";

    const compiled = compileStudioGraph(parseRuntimeScenario(scenario, manifest));
    expect(compiled).toEqual({ scenario, manifest });
  });

  it("canonicalizes legacy top-level axes without leaking them through the extension sidecar", () => {
    const scenario = fixture("content/scenarios/dev.json") as Record<string, any>;
    const manifest = fixture("content/media-manifest.json");
    const question = scenario.phases.find((phase: any) => phase.id === "question-fixed");
    const { field, ...legacyQuestion } = question;
    Object.assign(legacyQuestion, { xAxis: field.xAxis, yAxis: field.yAxis });
    scenario.phases[scenario.phases.indexOf(question)] = legacyQuestion;

    const compiled = compileStudioGraph(parseRuntimeScenario(scenario, manifest)) as Record<string, any>;
    const normalized = compiled.scenario.phases.find((phase: any) => phase.id === "question-fixed");
    expect(normalized.field).toEqual(field);
    expect(normalized).not.toHaveProperty("xAxis");
    expect(normalized).not.toHaveProperty("yAxis");
  });

  it("uses edited known fields while retaining unknown sidecar fields", () => {
    const scenario = fixture("content/scenarios/dev.json") as Record<string, any>;
    const manifest = fixture("content/media-manifest.json");
    scenario.futureTop = "kept";
    const project = parseRuntimeScenario(scenario, manifest);
    project.scenario.version = "edited-version";

    expect(compileStudioGraph(project).scenario).toMatchObject({
      version: "edited-version",
      futureTop: "kept",
    });
  });

  it("keeps phase and manifest extensions attached by stable identity after edits", () => {
    const scenario = fixture("content/scenarios/dev.json") as Record<string, any>;
    const manifest = fixture("content/media-manifest.json") as Record<string, any>;
    scenario.phases.splice(2, 0, {
      kind: "video",
      id: "remove-me",
      src: "remove.mp4",
      expectedDurationMs: 1000,
      next: "idle",
    });
    scenario.phases.find((phase: any) => phase.id === "question-fixed").futurePhase = "kept";
    manifest.files.push({ src: "remove.mp4", bytes: 1, hash: "a".repeat(64) });
    manifest.files[0].futureFile = "kept";

    const project = parseRuntimeScenario(scenario, manifest);
    const reorderedPhases = project.scenario.phases
      .filter((phase) => phase.id !== "remove-me")
      .reverse();
    project.scenario.phases.splice(0, project.scenario.phases.length, ...reorderedPhases);
    project.scenario.phases.splice(1, 0, {
      kind: "video",
      id: "inserted",
      src: "intro.mp4",
      expectedDurationMs: 1000,
      next: "idle",
    });
    project.manifest.files = project.manifest.files
      .filter((file) => file.src !== "remove.mp4")
      .reverse();
    project.manifest.files.push({ src: "new.mp4", bytes: 2, hash: "b".repeat(64) });

    const compiled = compileStudioGraph(project) as Record<string, any>;
    expect(
      compiled.scenario.phases.find((phase: any) => phase.id === "question-fixed"),
    ).toHaveProperty("futurePhase", "kept");
    expect(compiled.scenario.phases.find((phase: any) => phase.id === "inserted")).not.toHaveProperty(
      "futurePhase",
    );
    expect(compiled.manifest.files.find((file: any) => file.src === "intro.mp4")).toHaveProperty(
      "futureFile",
      "kept",
    );
    expect(compiled.manifest.files.find((file: any) => file.src === "new.mp4")).not.toHaveProperty(
      "futureFile",
    );
  });

  it("reports structural import errors and graph validation errors", () => {
    const manifest = fixture("content/media-manifest.json");
    expect(() => parseRuntimeScenario({ version: "bad" }, manifest)).toThrow(RuntimeImportError);

    const project = parseRuntimeScenario(fixture("content/scenarios/dev.json"), manifest);
    project.scenario.entryPhaseId = "missing";
    expect(validateStudioProject(project)).toContainEqual(
      expect.objectContaining({ severity: "error", code: "invalid-scenario" }),
    );
    expect(() => compileStudioGraph(project)).toThrow(/entryPhaseId/);
  });
});

it('round-trips admission, roles, templates, replacement tasks and scene gates together', () => {
  const raw = {
    version: 'workflow-test', entryPhaseId: 'welcome', cyclesAllowed: false,
    groups: [{id:'ki',label:'Stage'},{id:'audience',label:'Audience'}],
    admission: {assignment:'self-select',paths:[{groupId:'ki',intro:[{src:'intro.mp3',durationMs:1000}],loop:[{durationMs:1000}]}]},
    participantRoles:[{id:'helper',label:'Helper',capacity:2}],
    participantTasks:[{id:'volunteer',title:'Volunteer',question:'Join?',notificationBody:'Please respond',durationMs:1000,groupIds:['ki'],fullMessage:'Full',options:[{id:'yes',label:'Yes',message:'Assigned',roleId:'helper',capacity:2}]}],
    handoverTaskId:'volunteer',
    phases:[{kind:'idle',id:'idle'},{kind:'narration',id:'welcome',text:'Welcome',durationMs:1000,next:'idle',taskId:'volunteer',waitForGo:true}],
  };
  const manifest={files:[{src:'intro.mp3',bytes:10,hash:'test'}]};
  const project=parseRuntimeScenario(raw,manifest);
  expect(validateStudioProject(project).filter(i=>i.severity==='error')).toEqual([]);
  expect(compileStudioGraph(project)).toEqual({scenario:raw,manifest});
});
