import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { compileStudioGraph, parseRuntimeScenario } from "@entertheblackbox/studio-adapter";
import scenario from "../../../../content/scenarios/dev.json";
import manifest from "../../../../content/media-manifest.json";
import { MonitorEditor } from "./MonitorEditor.js";

it("renders the monitor cue controls and preserves the authored cue through Studio", () => {
  const cue = { kind: "vote-result", votePhaseId: "topic", fallbackText: "No topic", startMs: 0 };
  const project = parseRuntimeScenario({ ...scenario, phases: scenario.phases.map(p => p.id === "intro-video" ? { ...p, monitorCues: { M1: [cue] } } : p) }, manifest);
  const phase = compileStudioGraph(project).scenario.phases.find(p => p.id === "intro-video")!;
  expect(phase.monitorCues?.M1?.[0]).toMatchObject(cue);
  const html = renderToStaticMarkup(<MonitorEditor phase={phase} onChange={vi.fn()} onChooseMedia={vi.fn()} />);
  expect(html).toContain("Vote scene ID");
});
