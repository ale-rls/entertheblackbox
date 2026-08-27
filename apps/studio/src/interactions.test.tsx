// @vitest-environment jsdom
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Draft } from "./model.js";

const database = vi.hoisted(() => ({ drafts: [] as Draft[], deleted: [] as string[] }));
const media = vi.hoisted(() => ({ load: vi.fn(), upload: vi.fn(), remove: vi.fn() }));

vi.mock("./drafts.js", () => ({
  Autosave: class {
    schedule(_draft: Draft, changed?: (status: "saved") => void) { changed?.("saved"); }
  },
  recoverDraft: async () => undefined,
}));

vi.mock("./pocketbase-drafts.js", () => ({
  PocketbaseDraftDatabase: class {
    async list() { return database.drafts; }
    async delete(id: string) {
      database.deleted.push(id);
      database.drafts = database.drafts.filter((draft) => draft.id !== id);
    }
  },
}));

vi.mock("./media/local.js", () => ({
  refreshDraftLocalMedia: (draft: Draft) => draft,
  runtimeMediaManifest: (manifest: { files: Array<{ src: string; bytes: number; hash: string }> }) => ({
    files: manifest.files.map(({ src, bytes, hash }) => ({ src, bytes, hash })),
  }),
}));

vi.mock("./media/pocketbase-media.js", () => ({
  PocketbaseMediaLibrary: class {
    list = media.load;
    upload = media.upload;
    remove = media.remove;
  },
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
  media.load.mockReset().mockResolvedValue(undefined);
  media.upload.mockReset().mockResolvedValue(undefined);
  media.remove.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("DOMMatrixReadOnly", class { m22 = 1; });
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
    expect(input.getAttribute("aria-label")).toBe("Import show or backup");
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

  it("reports upload progress and refreshes media after partial multi-file failure", async () => {
    media.load
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ files: [
        { src: "first.mp4", bytes: 10, hash: "first", durationMs: 1_000 },
        { src: "third.webm", bytes: 20, hash: "third", durationMs: 2_000 },
      ] });
    let releaseFirst!: () => void;
    media.upload
      .mockImplementationOnce(() => new Promise<void>((resolve) => { releaseFirst = resolve; }))
      .mockRejectedValueOnce(new Error("A media file named “duplicate.mp4” already exists."))
      .mockResolvedValueOnce(undefined);
    await render(<App />);
    await act(async () => { button("New show").click(); });
    await act(async () => { button("Media").click(); });

    const input = document.querySelector<HTMLInputElement>('input[aria-label="Upload media to media library"]')!;
    expect(input.accept).toContain("audio/mpeg");
    expect(input.accept).toContain("image/png");
    const files = [
      new File(["first"], "first.mp4", { type: "video/mp4" }),
      new File(["duplicate"], "duplicate.mp4", { type: "video/mp4" }),
      new File(["third"], "third.webm", { type: "video/webm" }),
    ];
    Object.defineProperty(input, "files", { configurable: true, value: files });
    act(() => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    await flush();
    expect(document.body.textContent).toContain("Adding first.mp4 (1 of 3)…");

    await act(async () => {
      releaseFirst();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();
    expect(media.upload.mock.calls.map(([file]) => (file as File).name)).toEqual(["first.mp4", "duplicate.mp4", "third.webm"]);
    expect(media.load).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain("Added 2: first.mp4, third.webm.");
    expect(document.body.textContent).toContain("Failed 1: duplicate.mp4");
  });

  it("shows media usage and confirms permanent removal from the shared library", async () => {
    media.load
      .mockResolvedValueOnce({ files: [{ src: "unused.mp4", bytes: 1_048_576, hash: "unused", durationMs: 12_000 }] })
      .mockResolvedValueOnce({ files: [] });
    await render(<App />);
    await act(async () => { button("Media library").click(); });

    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("unused.mp4");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("1.0 MB");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Shared");
    await act(async () => { button("Remove").click(); });
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("permanently deletes the shared PocketBase media file");
    await act(async () => { button("Remove media").click(); });
    await flush();

    expect(media.remove).toHaveBeenCalledWith("unused.mp4");
    expect(document.body.textContent).toContain("Removed unused.mp4 from the media library.");
  });

  it("uses the media library picker when adding and changing a video phase", async () => {
    media.load.mockResolvedValue({ files: [
      { src: "opening.mp4", bytes: 1_000, hash: "opening", durationMs: 1_000 },
      { src: "conclusion.webm", bytes: 2_000, hash: "conclusion", durationMs: 2_500 },
    ] });
    await render(<App />);
    await act(async () => { button("New show").click(); });
    await act(async () => { button("Add").click(); });
    await act(async () => { button("Video phase").click(); });

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Choose media");
    expect(dialog.textContent).toContain("opening.mp4");
    expect(dialog.textContent).toContain("conclusion.webm");
    const conclusionRow = Array.from(dialog.querySelectorAll<HTMLElement>(".media-row"))
      .find((row) => row.textContent?.includes("conclusion.webm"))!;
    await act(async () => { conclusionRow.querySelector<HTMLButtonElement>("button")?.click(); });
    await flush();

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    const sourceButton = document.querySelector<HTMLButtonElement>('.media-source-picker')!;
    expect(sourceButton.textContent).toContain("conclusion.webm");
    expect(sourceButton.getAttribute("aria-label")).toContain("Current media: conclusion.webm");
    expect(document.body.textContent).toContain("Playback duration: 2.500 seconds");
    expect(document.body.textContent).toContain("Selected conclusion.webm for video-");

    await act(async () => { sourceButton.click(); });
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Choose media");
    expect(document.querySelector('.media-row[data-selected="true"]')?.textContent).toContain("conclusion.webm");
  });

  it("authors a still image + MP3 phase with type-filtered library pickers", async () => {
    media.load.mockResolvedValue({ files: [
      { src: "opening.mp4", bytes: 1_000, hash: "video", durationMs: 1_000 },
      { src: "portrait.png", bytes: 2_000, hash: "image" },
      { src: "voice.mp3", bytes: 3_000, hash: "voice", durationMs: 12_000 },
      { src: "alternate.mp3", bytes: 4_000, hash: "alternate", durationMs: 25_000 },
    ] });
    await render(<App />);
    await act(async () => { button("New show").click(); });
    await act(async () => { button("Add").click(); });
    await act(async () => { button("Image + MP3 phase").click(); });
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("portrait.png");
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("opening.mp4");
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("voice.mp3");
    await act(async () => { button("Cancel").click(); });

    const playbackFormat = Array.from(document.querySelectorAll("label"))
      .find((label) => label.textContent?.includes("Playback format"))
      ?.querySelector<HTMLSelectElement>("select")!;
    expect(playbackFormat.value).toBe("image-audio");

    expect(document.body.textContent).toContain("portrait.png");
    expect(document.body.textContent).toContain("voice.mp3");
    const audioPicker = document.querySelector<HTMLButtonElement>('button[aria-label^="Choose audio"]')!;
    await act(async () => { audioPicker.click(); });
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain("voice.mp3");
    expect(dialog.textContent).toContain("alternate.mp3");
    expect(dialog.textContent).not.toContain("portrait.png");
    expect(dialog.textContent).not.toContain("opening.mp4");

    const alternate = Array.from(dialog.querySelectorAll<HTMLElement>(".media-row"))
      .find((row) => row.textContent?.includes("alternate.mp3"))!;
    await act(async () => { alternate.querySelector<HTMLButtonElement>("button")?.click(); });
    await flush();
    expect(document.body.textContent).toContain("Playback duration: 25.000 seconds");
    expect(document.querySelector<HTMLButtonElement>('button[aria-label^="Choose audio"]')?.textContent).toContain("alternate.mp3");
  });

  it("opens the live display and admin as clearly named external tools", async () => {
    await render(<App />);
    await act(async () => { button("New show").click(); });

    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("a"));
    const display = links.find((link) => link.textContent === "Display")!;
    const admin = links.find((link) => link.textContent === "Admin")!;
    expect(display.getAttribute("href")).toBe("/display/");
    expect(display.getAttribute("target")).toBe("_blank");
    expect(admin.getAttribute("href")).toBe("/admin/");
    expect(admin.getAttribute("target")).toBe("_blank");
    expect(document.body.textContent).not.toContain("Monitor show");
    expect(Array.from(document.querySelectorAll("button")).some((item) => item.textContent === "Preview")).toBe(false);
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
