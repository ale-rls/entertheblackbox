// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { LiveGraph, graphPositions } from "./LiveGraph.js";
import type { Status, SceneFlow } from "./App.js";
const flow: SceneFlow = { entryPhaseId: "split", scenes: [
  { id: "split", kind: "group-branch", title: "Choose", routes: [{ outcome: "a", target: "a1" }, { outcome: "b", target: "b1" }, { outcome: "rejoin", target: "reunion" }] },
  { id: "a1", kind: "video", title: "Scene A", routes: [{ outcome: "next", target: "reunion" }] },
  { id: "b1", kind: "video", title: "Scene B", routes: [{ outcome: "next", target: "reunion" }] },
  { id: "reunion", kind: "video", title: "Reunion", routes: [{ outcome: "next", target: "idle" }] },
] };
const status: Status = { healthy: true, ready: true, uptimeMs: 0, displayConnected: true, displayHeartbeatAgeMs: 0, displayPlaybackIssue: null, connectedParticipants: 2, lifecycle: "active", sessionId: "s", phaseId: "split", phaseEpoch: 4, groupPathsStarted: true,
 participants: ["Alex", "Late"].map((name) => ({ clientId: name, name, color: "red", connected: true, joinedAt: 0, lastSeenAt: 0 })),
 groupPaths: [{ groupId: "a", label: "Actors", color: null, memberIds: ["Alex"], phaseId: "a1", phaseTitle: "Scene A", phaseEpoch: 5, done: false, jumpTargets: ["a1", "reunion"], reunionPhaseId: "reunion" }, { groupId: "b", label: "Builders", color: null, memberIds: [], phaseId: "b1", phaseTitle: "Scene B", phaseEpoch: 6, done: false, jumpTargets: ["b1", "reunion"], reunionPhaseId: "reunion" }] };
let root: Root;
beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => { if (root) await act(() => root.unmount()); document.body.replaceChildren(); });
async function render() {
  const element = document.createElement("div"); document.body.append(element); root = createRoot(element);
  const onJump = vi.fn(); const onAssign = vi.fn(async () => {});
  await act(() => root.render(<LiveGraph flow={flow} status={status} busy={false} onJump={onJump} onAssign={onAssign} />));
  return { onJump, onAssign };
}
const button = (label: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === label || b.getAttribute("aria-label") === label)!;
async function select(label: string, value: string) {
  const node = [...document.querySelectorAll("select")].find((s) => s.getAttribute("aria-label") === label || s.parentElement?.textContent?.startsWith(label))!;
  await act(() => { node.value = value; node.dispatchEvent(new Event("change", { bubbles: true })); });
}
describe("live graph", () => {
  it("puts reunion after both paths and handles loops", () => {
    const positions = graphPositions(flow);
    expect(positions.get("reunion")!.x).toBeGreaterThan(positions.get("a1")!.x);
    expect(positions.get("reunion")!.x).toBeGreaterThan(positions.get("b1")!.x);
    const cyclic = { ...flow, scenes: flow.scenes.map((scene) => scene.id === "reunion" ? { ...scene, routes: [{ outcome: "again", target: "split" }] } : scene) };
    expect(graphPositions(cyclic).size).toBe(4);
  });
  it("inspects without jumping, and scopes a jump to the selected group", async () => {
    const { onJump } = await render();
    await act(() => button("Inspect Scene B").click());
    expect(onJump).not.toHaveBeenCalled();
    await select("Group to move", "a");
    expect(button("Move Actors to this scene").disabled).toBe(true);
    await act(() => button("Inspect Reunion").click());
    expect(button("Move Actors to this scene").disabled).toBe(false);
    await act(() => button("Move Actors to this scene").click());
    expect(onJump).toHaveBeenCalledWith(expect.objectContaining({ id: "reunion" }), expect.any(HTMLButtonElement), "a");
  });
  it("selects a participant from another scene before transferring them", async () => {
    const { onAssign } = await render();
    await act(() => button("Inspect Scene B").click());
    await select("Participant", "Alex");
    await select("Move Alex to group", "b");
    expect(onAssign).toHaveBeenCalledWith("Alex", "b");
  });
  it("exposes waiting participants and moves one to a group's live position", async () => {
    const { onAssign } = await render();
    expect(document.body.textContent).toContain("Waiting / needs assignment · 1");
    await select("Move Late to group", "b");
    expect(onAssign).toHaveBeenCalledWith("Late", "b");
  });
});

it("shows selected subgroup membership while its parent selection is still running", async () => {
  const element = document.createElement("div"); document.body.append(element); root = createRoot(element);
  const choosing: Status = { ...status,
    groups: [{ id: "a", label: "Actors" }, { id: "trade", label: "Chosen trade" }],
    participants: status.participants.map(p => ({ ...p, groupId: "trade" })),
    groupPaths: [{ ...status.groupPaths[0]!, phaseTitle: "Choose a trade" }],
  };
  await act(() => root.render(<LiveGraph flow={flow} status={choosing} busy={false} onJump={vi.fn()} onAssign={vi.fn()} />));
  expect(element.querySelector(".live-roster")?.textContent).toContain("Chosen trade · Choose a trade");
});
