import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { compileStudioGraph, parseRuntimeScenario } from "@entertheblackbox/studio-adapter";
import scenario from "../../../../content/scenarios/dev.json";
import manifest from "../../../../content/media-manifest.json";
import { MonitorEditor } from "./MonitorEditor.js";

it("renders the monitor cue controls and preserves the authored cue through Studio", () => {
  const cue = { kind: "text", text: "Question", startMs: 0, durationMs: 12000, countdownSeconds: 5, countdownShowsText: true };
  const project = parseRuntimeScenario({ ...scenario, phases: scenario.phases.map(p => p.id === "intro-video" ? { ...p, monitorCues: { M1: [cue] } } : p) }, manifest);
  const phase = compileStudioGraph(project).scenario.phases.find(p => p.id === "intro-video")!;
  expect(phase.monitorCues?.M1?.[0]).toMatchObject(cue);
  const html = renderToStaticMarkup(<MonitorEditor phase={phase} onChange={vi.fn()} onChooseMedia={vi.fn()} />);
  expect(html).toContain("Final countdown");
  expect(html).toContain("Keep text small under the countdown");
});

it("offers the show colour presets per text cue and keeps the colour through Studio", () => {
  const cue = { kind: "text", text: "Question", startMs: 0, color: "#f76b15" };
  const project = parseRuntimeScenario({ ...scenario, phases: scenario.phases.map(p => p.id === "intro-video" ? { ...p, monitorCues: { M1: [cue] } } : p) }, manifest);
  const phase = compileStudioGraph(project).scenario.phases.find(p => p.id === "intro-video")!;
  expect(phase.monitorCues?.M1?.[0]).toMatchObject(cue);
  const html = renderToStaticMarkup(<MonitorEditor phase={phase} onChange={vi.fn()} onChooseMedia={vi.fn()} />);
  expect(html).toContain("Text colour");
  for (const name of ["Automatic (vote colour, else white)", "White", "Orange", "Green", "Blue", "Red", "Yellow", "Custom…"]) expect(html).toContain(name);
  expect(html).toMatch(/<option value="#f76b15" selected="">Orange<\/option>/);
});

it("offers a background colour on every monitor cue and keeps it through Studio", () => {
  const cues = [{ kind: "blank", startMs: 0, background: "#30a46c" }, { kind: "text", text: "JA", startMs: 1000, color: "#ffffff", background: "#f76b15" }];
  const project = parseRuntimeScenario({ ...scenario, phases: scenario.phases.map(p => p.id === "intro-video" ? { ...p, monitorCues: { M1: cues } } : p) }, manifest);
  const phase = compileStudioGraph(project).scenario.phases.find(p => p.id === "intro-video")!;
  expect(phase.monitorCues?.M1).toMatchObject(cues);
  const html = renderToStaticMarkup(<MonitorEditor phase={phase} onChange={vi.fn()} onChooseMedia={vi.fn()} />);
  expect(html.match(/>Background<select/g)).toHaveLength(2);
  expect(html).toContain("<option value=\"auto\">Black</option>");
  expect(html).toMatch(/<option value="#30a46c" selected="">Green<\/option>/);
});
