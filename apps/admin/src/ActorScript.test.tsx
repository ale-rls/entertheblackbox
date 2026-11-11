// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ActorScript, ScriptReader } from "./ActorScript.js";

it("renders script literally and lets actors leave and rejoin the shared cue", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const scroll = vi.fn();
  HTMLElement.prototype.scrollIntoView = scroll;
  const host = document.createElement("div"); const root = createRoot(host);
  const script = { title: "Actors", paragraphs: ["<img src=x onerror=alert(1)>", "Next"], cue: 0, revision: "one" };
  try {
    await act(async () => root.render(<ScriptReader script={script} />));
    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toContain(script.paragraphs[0]);
    expect(scroll).toHaveBeenCalledTimes(1);
    await act(async () => host.querySelector<HTMLInputElement>('[type="checkbox"]')!.click());
    await act(async () => root.render(<ScriptReader script={{ ...script, cue: 1 }} />));
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[aria-current="step"]')?.textContent).toContain("Next");
    await act(async () => host.querySelector("button")!.click());
    expect(scroll.mock.calls.length).toBeGreaterThan(1);
    expect(host.querySelector<HTMLInputElement>('[type="checkbox"]')!.checked).toBe(true);
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});

it("fetches with a reader capability and removes the script when access is revoked", async () => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ script: { title: "Private", paragraphs: ["Secret text"], cue: 0, revision: "one" } })).mockResolvedValue(new Response("", { status: 404 }));
  vi.stubGlobal("fetch", fetcher);
  const host = document.createElement("div"); const root = createRoot(host);
  try {
    await act(async () => root.render(<ActorScript token="reader-only" />));
    expect(host.textContent).toContain("Secret text");
    expect(fetcher).toHaveBeenCalledWith("/api/actor-script", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer reader-only" }) }));
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(host.textContent).not.toContain("Secret text");
    expect(host.textContent).toContain("Script unavailable");
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); vi.useRealTimers(); }
});
