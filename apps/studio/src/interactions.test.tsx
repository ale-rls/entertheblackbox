// @vitest-environment jsdom
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Draft } from "./model.js";

const database = vi.hoisted(() => ({ drafts: [] as Draft[], deleted: [] as string[] }));

vi.mock("./drafts.js", () => ({
  Autosave: class {
    schedule(_draft: Draft, changed?: (status: "saved") => void) { changed?.("saved"); }
  },
  IndexedDbDraftDatabase: class {
    async list() { return database.drafts; }
    async delete(id: string) {
      database.deleted.push(id);
      database.drafts = database.drafts.filter((draft) => draft.id !== id);
    }
  },
  recoverDraft: async () => undefined,
}));

vi.mock("./media/local.js", () => ({
  loadLocalMediaManifest: async () => undefined,
  refreshDraftLocalMedia: (draft: Draft) => draft,
  runtimeMediaManifest: () => ({ files: [] }),
}));

import { App } from "./App.js";
import { ConfirmationDialog, type ConfirmationDetails } from "./chrome/ConfirmationDialog.js";
import { Menu } from "./chrome/Menu.js";
import { SaveStatus } from "./chrome/SaveStatus.js";

let root: Root | null = null;

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  database.drafts = [];
  database.deleted = [];
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
  vi.stubGlobal("scrollTo", vi.fn());
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(element: ReactNode) {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.querySelector("#root")!);
  await act(async () => { root?.render(element); });
  await flush();
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function button(label: string): HTMLButtonElement {
  const match = Array.from(document.querySelectorAll("button")).find((candidate) => candidate.textContent === label);
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Button not found: ${label}`);
  return match;
}

describe("Studio confirmations", () => {
  it("traps focus, closes on Escape, and restores the delete trigger", async () => {
    database.drafts = [{ id: "draft-1", name: "Museum Show", updatedAt: 1 } as Draft];
    await render(<App />);

    const trigger = button("Delete");
    trigger.focus();
    await act(async () => { trigger.click(); });
    const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]')!;
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement?.textContent).toBe("Keep draft");
    expect(dialog.textContent).toContain("permanently removes the local draft");

    await act(async () => { dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true })); });
    expect(document.activeElement?.textContent).toBe("Delete draft");
    await act(async () => { dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })); });
    expect(document.activeElement?.textContent).toBe("Keep draft");

    await act(async () => { dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await flush();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    await act(async () => { trigger.click(); });
    await act(async () => { button("Keep draft").click(); });
    await flush();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("executes destructive deletion and moves focus to a safe fallback when its trigger disappears", async () => {
    database.drafts = [{ id: "draft-2", name: "Gallery Show", updatedAt: 2 } as Draft];
    await render(<App />);

    await act(async () => { button("Delete").click(); });
    await act(async () => { button("Delete draft").click(); });
    await flush();

    expect(database.deleted).toEqual(["draft-2"]);
    expect(document.querySelectorAll(".home article")).toHaveLength(0);
    expect(document.body.textContent).toContain("Deleted “Gallery Show”");
    expect(document.activeElement?.textContent).toBe("Show Studio");
    expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(0);
  });

  it("executes a non-destructive connection-replacement callback with primary hierarchy", async () => {
    const changed = vi.fn();
    const details: ConfirmationDetails = {
      title: "Change “question-2” to left / right quadrants?",
      description: "This replaces the question’s outcome connections. You can undo this change during this editing session.",
      confirmLabel: "Replace connections",
      cancelLabel: "Keep current layout",
      tone: "primary",
      trigger: null,
      onConfirm: changed,
    };
    await render(<ConfirmationDialog details={details} onClose={() => undefined} />);

    const confirmButton = button("Replace connections");
    expect(confirmButton.dataset.scToolVariant).toBe("primary");
    await act(async () => { confirmButton.click(); });
    await flush();
    expect(changed).toHaveBeenCalledOnce();
  });

  it("closes from the scrim without creating a second dialog in the accessibility tree", async () => {
    const closed = vi.fn();
    const details: ConfirmationDetails = {
      title: "Change phase type?",
      description: "This replaces fields and outgoing connections.",
      confirmLabel: "Change phase type",
      cancelLabel: "Keep current type",
      tone: "primary",
      trigger: null,
      onConfirm: vi.fn(),
    };
    await render(<ConfirmationDialog details={details} onClose={closed} />);
    expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);
    const scrim = document.querySelector<HTMLElement>(".sc-tool-dialog-scrim")!;
    await act(async () => { scrim.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
    expect(closed).toHaveBeenCalledOnce();
  });
});

describe("Studio feedback and keyboard entry", () => {
  it("uses one real import button and reports an invalid file inline", async () => {
    await render(<App />);
    const importButton = button("Import show or backup");
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const inputClick = vi.spyOn(input, "click");

    expect(importButton.tagName).toBe("BUTTON");
    expect(input.hidden).toBe(true);
    expect(document.querySelectorAll('button, input:not([hidden])')).toContain(importButton);
    importButton.focus();
    await act(async () => {
      const keydown = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
      importButton.dispatchEvent(keydown);
      if (!keydown.defaultPrevented) importButton.click();
      importButton.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
    });
    expect(inputClick).toHaveBeenCalledOnce();

    const invalidFile = { text: async () => "not-json" } as File;
    Object.defineProperty(input, "files", { configurable: true, value: [invalidFile] });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    await flush();
    const feedback = document.querySelector<HTMLElement>('[role="alert"]')!;
    expect(feedback.textContent).toContain("Import failed");
    expect(feedback.textContent).toContain("scenario.json and media-manifest.json together");
    expect(importButton.getAttribute("aria-describedby")).toBe(feedback.id);
  });

  it("returns focus to a menu trigger after a normal selection", async () => {
    const selected = vi.fn();
    await render(<Menu label="View" items={[{ label: "Save layout", onSelect: selected }]} />);
    const trigger = button("View");
    await act(async () => { trigger.click(); });
    expect(document.activeElement?.textContent).toBe("Save layout");
    await act(async () => { button("Save layout").click(); });
    expect(selected).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes an open menu when a pointer interaction starts outside it", async () => {
    await render(<><Menu label="View" items={[{ label: "Save layout", onSelect: vi.fn() }]} /><button>Outside</button></>);
    const trigger = button("View");
    await act(async () => { trigger.click(); });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    await act(async () => {
      button("Outside").dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("coalesces save announcements until editing has settled", async () => {
    vi.useFakeTimers();
    function Harness() {
      const [status, setStatus] = useState<"saving" | "saved" | "error">("saved");
      return <><SaveStatus status={status} /><button onClick={() => setStatus("saving")}>Saving</button><button onClick={() => setStatus("saved")}>Saved</button></>;
    }
    await render(<Harness />);
    const live = document.querySelector<HTMLElement>("[data-save-announcement]")!;
    expect(live.textContent).toBe("");

    await act(async () => { button("Saving").click(); });
    await act(async () => { button("Saved").click(); });
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(live.textContent).toBe("");
    await act(async () => { button("Saving").click(); });
    await act(async () => { button("Saved").click(); });
    await act(async () => { vi.advanceTimersByTime(749); });
    expect(live.textContent).toBe("");
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(live.textContent).toBe("Changes saved.");
    expect(document.querySelector("[data-save-status]")?.getAttribute("aria-hidden")).toBe("true");
  });
});
