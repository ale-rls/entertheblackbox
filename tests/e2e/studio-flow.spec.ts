import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { REPO_ROOT } from "./helpers/server.js";
import { startStudio, type StudioServer } from "./helpers/studio.js";

const fixture = (path: string) => readFile(`${REPO_ROOT}/${path}`);

test.describe("Show Studio v1", () => {
  let studio: StudioServer;
  test.beforeEach(async () => { studio = await startStudio(); });
  test.afterEach(async () => { if (studio) await studio.stop(); });

  test("discovers content/media automatically for locally created shows", async ({ page }) => {
    await page.goto(studio.baseUrl);
    const localMediaStatus = page.getByText(/Local media: \d+ files? found in content\/media\./);
    await expect(localMediaStatus).toBeVisible();
    const localMediaCount = Number((await localMediaStatus.textContent())?.match(/\d+/)?.[0]);
    await page.getByRole("button", { name: "New show" }).click();
    await expect(page.getByRole("cell", { name: "intro.mp4" })).toBeVisible();

    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("menuitem", { name: "Video phase" }).click();
    await page.locator('.react-flow__node[data-id^="video-"]').click();
    await expect(page.getByLabel("Media source").locator("option")).toHaveCount(localMediaCount);
    await expect(page.getByLabel("Media source").getByRole("option", { name: "intro.mp4" })).toBeAttached();
    await page.getByLabel("Media source").selectOption("intro.mp4");
    await expect(page.getByLabel("Media source")).toHaveValue("intro.mp4");
  });

  test("imports, edits, validates, previews, and exports a gated package", async ({ page }) => {
    await page.goto(studio.baseUrl);
    const localMediaStatus = page.getByText(/Local media: \d+ files? found in content\/media\./);
    await expect(localMediaStatus).toBeVisible();
    const localMediaCount = Number((await localMediaStatus.textContent())?.match(/\d+/)?.[0]);
    await page.getByLabel("Import show or backup").setInputFiles([
      { name: "scenario.json", mimeType: "application/json", buffer: await fixture("content/scenarios/dev.json") },
      { name: "media-manifest.json", mimeType: "application/json", buffer: await fixture("content/media-manifest.json") },
    ]);
    await expect(page.getByLabel("Show name")).toHaveValue("Imported show");
    await page.getByLabel("Show name").fill("Curator regression");
    await expect(page.locator(".diagnostics tbody tr")).toHaveCount(localMediaCount);
    const acknowledgements = page.getByLabel("Acknowledge");
    await expect(acknowledgements.first()).toBeVisible();
    for (const checkbox of await acknowledgements.all()) await checkbox.check();
    await expect(page.getByRole("button", { name: "Export for deployment" })).toBeEnabled();

    await page.getByRole("button", { name: "Preview" }).click();
    await expect(page.getByLabel("Show preview")).toBeVisible();
    await page.getByRole("button", { name: "Next phase" }).click();
    await page.getByRole("button", { name: "Resolve fixed" }).click();
    await expect(page.getByText(/Winner:/)).toBeVisible();
    await page.getByRole("button", { name: "Close preview" }).click();

    const downloads: string[] = [];
    page.on("download", (download) => downloads.push(download.suggestedFilename()));
    await page.getByRole("button", { name: "Export for deployment" }).click();
    await expect.poll(() => downloads.length).toBe(5);
    expect(downloads.some((name) => name.includes("validation-report.json"))).toBe(true);
    expect(downloads.some((name) => name.endsWith("README.txt"))).toBe(true);
    expect(new Set(downloads.map((name) => name.match(/^(.*)-(?:scenario|media-manifest|\.studio|validation-report|README)/)?.[1])).size).toBe(1);
  });

  test("supports every recent-draft action, including deleting persisted drafts", async ({ page }) => {
    await page.goto(studio.baseUrl);

    await page.getByRole("button", { name: "New show" }).click();
    await page.getByLabel("Show name").fill("Landing actions");
    await expect(page.getByText("saved", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "File" }).click();
    await page.getByRole("menuitem", { name: "Close show" }).click();

    const draft = page.getByRole("button", { name: "Landing actions", exact: true }).locator("..");
    await expect(draft).toBeVisible();
    await draft.getByRole("button", { name: "Landing actions" }).click();
    await expect(page.getByLabel("Show name")).toHaveValue("Landing actions");
    await page.getByRole("button", { name: "File" }).click();
    await page.getByRole("menuitem", { name: "Close show" }).click();

    await draft.getByRole("button", { name: "Duplicate" }).click();
    await expect(page.getByLabel("Show name")).toHaveValue("Landing actions copy");
    await expect(page.getByText("saved", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "File" }).click();
    await page.getByRole("menuitem", { name: "Close show" }).click();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Landing actions", exact: true }).locator("..").getByRole("button", { name: "Export backup" }).click();
    expect((await downloadPromise).suggestedFilename()).toBe("Landing actions.studio-backup.json");

    await page.getByRole("button", { name: "Landing actions copy", exact: true }).locator("..").getByRole("button", { name: "Delete" }).click();
    await page.getByRole("alertdialog", { name: "Delete “Landing actions copy”?" }).getByRole("button", { name: "Delete draft" }).click();
    await expect(page.getByRole("button", { name: "Landing actions copy", exact: true })).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("button", { name: "Landing actions copy", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Landing actions", exact: true })).toHaveCount(1);
  });

  test("restores node positions and connections after saving and reopening a show", async ({ page }) => {
    const savedEdgeCount = () => page.evaluate(() => new Promise<number>((resolve, reject) => {
      const open = indexedDB.open("smartphonecracy-studio", 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const read = open.result.transaction("drafts").objectStore("drafts").getAll();
        read.onerror = () => reject(read.error);
        read.onsuccess = () => resolve((read.result.find(({ key }) => key.endsWith(":latest"))?.draft.document.edges ?? []).length);
      };
    }));
    await page.goto(studio.baseUrl);
    await page.getByLabel("Import show or backup").setInputFiles([
      { name: "scenario.json", mimeType: "application/json", buffer: await fixture("content/scenarios/dev.json") },
      { name: "media-manifest.json", mimeType: "application/json", buffer: await fixture("content/media-manifest.json") },
    ]);

    const node = page.locator('.react-flow__node[data-id="intro-video"]');
    const transform = () => node.evaluate((element) => (element as HTMLElement).style.transform);
    const before = await transform();
    const edgeCount = await page.locator(".react-flow__edge").count();
    const box = await node.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + 140, box!.y + box!.height / 2 + 80, { steps: 8 });
    await page.mouse.up();

    await expect.poll(transform).not.toBe(before);
    const moved = await transform();
    await expect(page.getByText("saved", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "View", exact: true }).click();
    await page.getByRole("menuitem", { name: "Save layout" }).click();
    await expect(page.locator(".react-flow__edge")).toHaveCount(edgeCount);
    await expect(page.getByText("saving", { exact: true })).toBeVisible();
    await expect(page.getByText("saved", { exact: true })).toBeVisible();
    await expect.poll(savedEdgeCount).toBe(edgeCount);

    await page.getByRole("button", { name: "File" }).click();
    await page.getByRole("menuitem", { name: "Close show" }).click();
    await page.getByRole("button", { name: "Imported show", exact: true }).click();

    await expect.poll(transform).toBe(moved);
    await expect.poll(savedEdgeCount).toBe(edgeCount);
    await expect(page.locator(".react-flow__edge")).toHaveCount(edgeCount);
  });

  test("supports keyboard entry and renders a large graph within the interaction budget", async ({ page }) => {
    await page.goto(studio.baseUrl);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "New show" })).toBeFocused();

    const phases = Array.from({ length: 150 }, (_, index) => ({
      id: `video-${index}`, kind: "video", src: "media/intro.mp4", expectedDurationMs: 1000,
      next: index === 149 ? "idle" : `video-${index + 1}`,
    }));
    const scenario = { version: "large-1", entryPhaseId: "video-0", cyclesAllowed: false, phases: [...phases, { id: "idle", kind: "idle" }] };
    const started = Date.now();
    await page.getByLabel("Import show or backup").setInputFiles([
      { name: "scenario.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(scenario)) },
      { name: "media-manifest.json", mimeType: "application/json", buffer: await fixture("content/media-manifest.json") },
    ]);
    await expect(page.getByLabel("Show name")).toBeVisible({ timeout: 10_000 });
    expect(Date.now() - started).toBeLessThan(10_000);
    await expect(page.locator(".react-flow__node")).toHaveCount(152);
  });

  test("switches question handles and restores them with undo and redo", async ({ page }) => {
    await page.goto(studio.baseUrl);
    await page.getByLabel("Import show or backup").setInputFiles([
      { name: "scenario.json", mimeType: "application/json", buffer: await fixture("content/scenarios/dev.json") },
      { name: "media-manifest.json", mimeType: "application/json", buffer: await fixture("content/media-manifest.json") },
    ]);
    const node = page.locator('.react-flow__node[data-id="question-quadrant"]');
    await node.click();
    const handles = () => node.locator(".port-out .port-name").allTextContents();
    await expect.poll(handles).toEqual(["q1 · top right", "q2 · top left", "q3 · bottom left", "q4 · bottom right / center", "tie", "no votes"]);

    await page.getByLabel("Quadrant layout").selectOption("two-quadrant-x");
    await page.getByRole("alertdialog", { name: "Change “question-quadrant” to left / right quadrants?" }).getByRole("button", { name: "Replace connections" }).click();
    await expect(page.getByLabel("Quadrant layout")).toHaveValue("two-quadrant-x");
    await expect.poll(handles).toEqual(["min · left · Deregulate", "max · right · Regulate", "tie", "no votes"]);

    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByRole("menuitem", { name: "Undo" }).click();
    await expect.poll(handles).toEqual(["q1 · top right", "q2 · top left", "q3 · bottom left", "q4 · bottom right / center", "tie", "no votes"]);

    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByRole("menuitem", { name: "Redo" }).click();
    await expect.poll(handles).toEqual(["min · left · Deregulate", "max · right · Regulate", "tie", "no votes"]);
  });
});
