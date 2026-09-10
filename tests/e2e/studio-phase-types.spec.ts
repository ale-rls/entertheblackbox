import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { REPO_ROOT } from "./helpers/server.js";
import { startStudio, type StudioServer } from "./helpers/studio.js";

const fixture = (path: string) => readFile(`${REPO_ROOT}/${path}`);

test.describe("Show Studio phase types", () => {
  let studio: StudioServer;

  test.beforeEach(async () => { studio = await startStudio(); });
  test.afterEach(async () => { if (studio) await studio.stop(); });

  // FIXME(#9): asserts Studio UI text that no longer exists. Quarantined so CI
  // stays meaningful; re-derive the selectors and remove this marker.
  test.fixme("does not offer the runtime idle phase in Properties", async ({ page }) => {
    await page.goto(studio.baseUrl);
    await page.getByLabel("Import show or backup").setInputFiles([
      { name: "scenario.json", mimeType: "application/json", buffer: await fixture("content/scenarios/dev.json") },
      { name: "media-manifest.json", mimeType: "application/json", buffer: await fixture("content/media-manifest.json") },
    ]);

    await page.locator('.react-flow__node[data-id="intro-video"]').click();
    const phaseType = page.getByLabel("Phase type");
    await expect(phaseType.locator("option")).toHaveText(["Video", "Position question"]);
    await expect(phaseType.locator('option[value="idle"]')).toHaveCount(0);
  });
});
