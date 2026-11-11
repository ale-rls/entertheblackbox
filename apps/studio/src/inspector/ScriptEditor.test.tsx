// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { ActorScriptEditor, ScriptCueEditor } from "./ScriptEditor.js";
import type { Phase } from "./model.js";

let root: Root | null = null;
beforeAll(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = null; document.body.replaceChildren(); });
async function mount(element: React.ReactElement) {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.querySelector("#root")!);
  await act(async () => root?.render(element));
}
function type(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")!.set!;
  setter.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

it("saves a show script only once it is valid", async () => {
  const onChange = vi.fn();
  await mount(<ActorScriptEditor script={undefined} onChange={onChange} />);
  await act(async () => type(document.querySelector("input")!, "Show"));
  expect(onChange).not.toHaveBeenCalled();
  await act(async () => type(document.querySelector("textarea")!, "One\n\nTwo"));
  expect(onChange).toHaveBeenLastCalledWith({ title: "Show", text: "One\n\nTwo" });
  expect(document.body.textContent).toContain("2 paragraphs");
});

it("adds scene cues that point at script paragraphs and flags missing ones", async () => {
  const onChange = vi.fn();
  const phase = { id: "intro", kind: "narration", text: "Hi", durationMs: 5000, next: "idle", scriptCues: [{ startMs: 0, paragraph: 0 }] } as Phase;
  const script = { title: "Show", text: "First line\n\nSecond line" };
  await mount(<ScriptCueEditor phase={phase} script={script} onChange={onChange} />);
  expect([...document.querySelectorAll("option")].map((option) => option.textContent)).toEqual(["1 — First line", "2 — Second line"]);
  await act(async () => [...document.querySelectorAll("button")].find((button) => button.textContent === "Add script cue")!.click());
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ scriptCues: [{ startMs: 0, paragraph: 0 }, { startMs: 5000, paragraph: 1 }] }));
  await mount(<ScriptCueEditor phase={{ ...phase, scriptCues: [{ startMs: 0, paragraph: 4 }] } as Phase} script={script} onChange={onChange} />);
  expect(document.querySelector("[role=alert]")?.textContent).toContain("Paragraph 5 is not in the actor script");
});
