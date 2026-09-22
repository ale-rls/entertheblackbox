// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type PocketBase from "pocketbase";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DevicePreview } from "./DevicePreview.js";
import { importRuntime } from "../io.js";

vi.mock("qrcode", () => ({ default: { toCanvas: vi.fn(async () => {}) } }));
const draft = importRuntime({ version: "test", entryPhaseId: "first", phases: [
  { kind: "idle", id: "idle" },
  { kind: "narration", id: "first", text: "First", durationMs: 60000, next: "second" },
  { kind: "narration", id: "second", text: "Second", durationMs: 60000, next: "idle" },
] }, { files: [] });
let root: Root;
let container: HTMLDivElement;
const closed = vi.fn();
const request = vi.fn();
const operator = { authStore: { isValid: true, token: "operator" } } as PocketBase;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  sessionStorage.clear();
  request.mockReset().mockImplementation(async () => new Response(JSON.stringify({ id: "id", phaseId: "first", revision: 1, participants: 0, displays: 0, groups: [] })));
  vi.stubGlobal("fetch", request);
  closed.mockReset();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const render = async (count: number, phaseId = "first", nextDraft = draft, auth = operator) => {
  await act(async () => root.render(<DevicePreview draft={nextDraft} phaseId={phaseId} request={count} operator={auth} onClose={closed} />));
};
describe("Preview on devices", () => {
  it("starts automatically and keeps the same device session when triggering an edited draft", async () => {
    await render(1);
    const firstUrl = request.mock.calls[0]![0];
    expect(firstUrl).toMatch(/^\/api\/admin\/rehearsals\//);
    expect(JSON.parse(request.mock.calls[0]![1].body).phaseId).toBe("first");
    const phoneUrl = container.querySelector<HTMLAnchorElement>('a[href*="/phone/"]')!.href;
    const edited = structuredClone(draft);
    const second = edited.project.scenario.phases.find((p) => p.id === "second");
    if (second?.kind === "narration") second.text = "Edited";
    await render(2, "second", edited);
    expect(request.mock.calls[1]![0]).toBe(firstUrl);
    expect(JSON.parse(request.mock.calls[1]![1].body)).toMatchObject({ phaseId: "second", scenario: { phases: expect.arrayContaining([expect.objectContaining({ text: "Edited" })]) } });
    expect(container.querySelector<HTMLAnchorElement>('a[href*="/phone/"]')!.href).toBe(phoneUrl);
    expect(container.textContent).toContain("TouchDesigner connection");
  });
  it("shows validation errors while keeping the existing connection links", async () => {
    await render(1);
    request.mockResolvedValueOnce(new Response(JSON.stringify({ errors: ["Missing media: scene.mp4"] }), { status: 400 }));
    await render(2);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Missing media: scene.mp4");
    expect(container.querySelector('a[href*="/phone/"]')).not.toBeNull();
  });
  it("requires sign-in before submitting a draft", async () => {
    await render(1, "first", draft, { authStore: { isValid: false } } as PocketBase);
    expect(request).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Sign in and preview");
  });
  it("ends the runtime only on the explicit end action", async () => {
    await render(1);
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent === "End device preview")!;
    await act(async () => button.click());
    expect(request.mock.calls.at(-1)![1].method).toBe("DELETE");
    expect(closed).toHaveBeenCalledOnce();
  });
});
