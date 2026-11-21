// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CueList } from "./CueList.js";
import { buildCueList, optionsAt } from "./cue-list-model.js";
import type { SceneFlow, Status } from "./App.js";

const next = (target: string) => [{ outcome: "next", target }];
/** Same shape as a show with a hand-continued waiting loop, three hand-picked endings and a variant scene. */
const flow: SceneFlow = { entryPhaseId: "welcome", scenes: [
  { id: "welcome", kind: "video", title: "Welcome", routes: next("wait") },
  { id: "wait", kind: "video", title: "Waiting loop", routes: next("wait") },
  { id: "split", kind: "group-branch", title: "Assign groups", routes: [{ outcome: "a", target: "intro" }, { outcome: "b", target: "intro" }, { outcome: "rejoin", target: "intro" }] },
  { id: "intro", kind: "video", title: "Intro", routes: next("vote") },
  { id: "vote", kind: "video-position-question", title: "The vote", routes: next("a1") },
  { id: "a1", kind: "video", title: "Ending A1", routes: next("a2") },
  { id: "a2", kind: "video", title: "Ending A2", routes: next("a3") },
  { id: "a2-alt", kind: "video", title: "Ending A2 variant", routes: next("a3") },
  { id: "a3", kind: "video", title: "Ending A3", routes: next("idle") },
  { id: "b1", kind: "video", title: "Ending B1", routes: next("b2") },
  { id: "b2", kind: "video", title: "Ending B2", routes: next("idle") },
  { id: "c1", kind: "video", title: "Ending C1", routes: next("idle") },
] };

describe("cue list model", () => {
  const list = buildCueList(flow);
  it("continues a waiting loop by hand into the longest unrouted chain", () => {
    expect(list.items.map((item) => item.type === "scene" ? item.row.scene.id : `go:${item.target.id}`))
      .toEqual(["welcome", "wait", "go:split", "split", "intro", "vote"]);
    expect(list.items[1]).toMatchObject({ type: "scene", row: { loops: true } });
    expect(optionsAt(list, "wait")).toEqual([{ reason: "Continue the show", scene: expect.objectContaining({ id: "split" }) }]);
  });
  it("puts hand-picked endings side by side after the last vote", () => {
    expect(list.endings?.afterSceneId).toBe("vote");
    expect(list.endings?.tracks.map((track) => [track.label, track.automatic, track.rows.map((row) => row.scene.id)])).toEqual([
      ["A", true, ["a1", "a2", "a3"]], ["B", false, ["b1", "b2"]], ["C", false, ["c1"]],
    ]);
    expect(optionsAt(list, "vote").map((option) => option.scene.id)).toEqual(["a1", "b1", "c1"]);
    expect(optionsAt(list, "a1").map((option) => option.scene.id)).toEqual(["b1", "c1", "a2-alt"]);
  });
  it("shows a scene that rejoins as a variant of the scene it replaces", () => {
    const a2 = list.endings!.tracks[0]!.rows[1]!;
    expect(a2.variants.map((rows) => rows.map((row) => row.scene.id))).toEqual([["a2-alt"]]);
    expect(list.others).toEqual([]);
  });
  it("nests vote outcomes that lead elsewhere", () => {
    const routed = buildCueList({ entryPhaseId: "q", scenes: [
      { id: "q", kind: "position-question", title: "Q", routes: [{ outcome: "left", target: "l" }, { outcome: "right", target: "r" }, { outcome: "mid", target: "r" }] },
      { id: "l", kind: "video", title: "Left", routes: next("r") },
      { id: "r", kind: "video", title: "Right", routes: next("idle") },
    ] });
    expect(routed.items.map((item) => item.type === "scene" && item.row.scene.id)).toEqual(["q", "r"]);
    const q = routed.items[0]!;
    expect(q.type === "scene" && q.row.branches.map((branch) => [branch.outcome, branch.rows.map((row) => row.scene.id)])).toEqual([["left", ["l"]]]);
  });
});

const status: Status = { healthy: true, ready: true, phoneJoinUrl: null, uptimeMs: 0, displayConnected: true, displayHeartbeatAgeMs: 0, displayPlaybackIssue: null,
  connectedParticipants: 1, lifecycle: "active", sessionId: "s", phaseId: "wait", phaseEpoch: 3, groupPathsStarted: false, groupPaths: [],
  participants: [{ clientId: "p", name: "Pat", color: "red", connected: true, joinedAt: 0, lastSeenAt: 0 }] };
let root: Root;
beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => { if (root) await act(() => root.unmount()); document.body.replaceChildren(); });
async function render(current: Partial<Status> = {}) {
  const element = document.createElement("div"); document.body.append(element); root = createRoot(element);
  const onJump = vi.fn();
  await act(() => root.render(<CueList flow={flow} status={{ ...status, ...current }} busy={false} onJump={onJump} />));
  return onJump;
}
const byLabel = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

describe("cue list view", () => {
  it("shows now, next and the manual continuation of a loop", async () => {
    const onJump = await render();
    const now = document.querySelector(".cue-now")!.textContent!;
    expect(now).toContain("Waiting loop");
    expect(now).toContain("Loops until you continue");
    expect(now).toContain("Continue the show");
    expect(document.querySelector(".cue-manual")?.textContent).toContain("Assign groups");
    expect(document.querySelector('.cue-row[data-past="true"]')?.textContent).toContain("Welcome");
    await act(() => byLabel("Go: Assign groups").click());
    expect(onJump).toHaveBeenCalledWith(expect.objectContaining({ id: "split" }), expect.any(HTMLButtonElement), undefined);
  });
  it("offers the endings at the vote and lets the operator pick one", async () => {
    const onJump = await render({ phaseId: "vote" });
    expect(document.querySelector(".cue-endings")?.textContent).toContain("after “The vote”");
    await act(() => byLabel("Go B: Ending B1").click());
    expect(onJump).toHaveBeenCalledWith(expect.objectContaining({ id: "b1" }), expect.any(HTMLButtonElement), undefined);
    expect(byLabel("Jump: The vote").disabled).toBe(true);
    // Finished scenes fold away except the last two.
    expect(document.querySelector(".cue-track")?.textContent).not.toContain("Welcome");
    const unfold = [...document.querySelectorAll("button")].find((b) => b.textContent === "Show 2 earlier scenes")!;
    await act(() => unfold.click());
    expect(document.querySelector(".cue-track")?.textContent).toContain("Welcome");
  });
  it("names cues and endings by their script cue names, keeping the title and ID visible", async () => {
    const named: SceneFlow = { ...flow, scenes: flow.scenes.map((scene) => scene.id === "b1" ? { ...scene, cueName: "T6.3.C – JA / HACK GELUNGEN" } : scene) };
    const element = document.createElement("div"); document.body.append(element); root = createRoot(element);
    await act(() => root.render(<CueList flow={named} status={{ ...status, phaseId: "vote" }} busy={false} onJump={vi.fn()} />));
    const ending = [...document.querySelectorAll(".cue-ending")].find((node) => node.textContent?.includes("HACK GELUNGEN"))!;
    expect(ending.querySelector("header strong")?.textContent).toBe("B · T6.3.C – JA / HACK GELUNGEN");
    const row = [...ending.querySelectorAll(".cue-row")].find((node) => node.textContent?.includes("b1"))!;
    expect(row.querySelector("strong")?.textContent).toBe("T6.3.C – JA / HACK GELUNGEN");
    expect(row.querySelector("small")?.textContent).toContain("Ending B1");
    expect(byLabel("Go B: T6.3.C – JA / HACK GELUNGEN")).not.toBeNull();
  });
  it("lets the operator light a field and step the counter in a scene with operator fields", async () => {
    const hack: SceneFlow = { ...flow, scenes: flow.scenes.map((scene) => scene.id === "wait" ? { ...scene, operatorFields: { zones: [{ id: "rot", label: "ROT", color: "#e5484d" }, { id: "blau", label: "BLAU" }], total: 12 } } : scene) };
    const onOperatorField = vi.fn();
    const element = document.createElement("div"); document.body.append(element); root = createRoot(element);
    await act(() => root.render(<CueList flow={hack} status={{ ...status, operatorField: { target: "rot", count: 4 } }} busy={false} onJump={vi.fn()} onOperatorField={onOperatorField} />));
    const panel = document.querySelector(".cue-operator-fields")!;
    expect(panel.textContent).toContain("4 / 12");
    const buttons = [...panel.querySelectorAll("button")];
    expect(buttons.find((b) => b.textContent === "ROT")?.getAttribute("aria-pressed")).toBe("true");
    await act(() => buttons.find((b) => b.textContent === "BLAU")!.click());
    await act(() => buttons.find((b) => b.textContent === "+1")!.click());
    expect(onOperatorField.mock.calls).toEqual([[{ target: "blau" }], [{ countDelta: 1 }]]);
  });
});

