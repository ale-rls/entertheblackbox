import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  adminStatus,
  startServer,
  REPO_ROOT,
  type E2eServer,
} from "./helpers/server.js";
import { displayUrl } from "./helpers/clients.js";

/**
 * §16: media failure shows a visible retry state and recovers without
 * intervention. Server readiness hashes media once at boot, so the file
 * is corrupted on disk *after* boot — the display's own byte+sha256
 * verification (STEP-014) is what must catch it and keep retrying.
 */
test.describe("media failure retry", () => {
  let server: E2eServer;
  let mediaDir: string;
  let goodBytes: Buffer;

  test.beforeEach(async () => {
    mediaDir = await mkdtemp(join(tmpdir(), "e2e-media-"));
    await cp(join(REPO_ROOT, "content/media"), mediaDir, { recursive: true });
    goodBytes = await readFile(join(mediaDir, "intro.mp4"));
    server = await startServer({ MEDIA_DIR: mediaDir });
  });

  test.afterEach(async () => {
    await server.stop();
  });

  test("corrupt media → visible retry; restored media → ready", async ({ browser }) => {
    // Corrupt after boot (readiness already passed) so /media serves
    // bytes whose hash no longer matches the manifest.
    await writeFile(join(mediaDir, "intro.mp4"), Buffer.from("corrupted-not-an-mp4"));

    // Fresh context = empty Cache Storage: the display must download,
    // fail verification, and show its retry state instead of ready.
    // Assert the explicit "retrying" wording — the bare .media-status
    // element also covers ordinary first-sync progress, which would let
    // this test pass without ever exercising a failed verification.
    const context = await browser.newContext();
    const display = await context.newPage();
    await display.goto(displayUrl(server.baseUrl));
    await expect(display.locator(".media-status")).toContainText(/retrying/, { timeout: 20_000 });
    await expect.poll(async () => (await adminStatus(server.baseUrl)).displayConnected).toBe(false);

    // Restore the good bytes; capped-backoff retry (1s, 2s, 4s…) must
    // reach ready on its own — no reload, no operator action.
    await writeFile(join(mediaDir, "intro.mp4"), goodBytes);
    await expect(display.locator(".media-status")).toBeHidden({ timeout: 30_000 });
    await expect(display.locator(".idle")).toBeVisible();
    await expect.poll(async () => (await adminStatus(server.baseUrl)).displayConnected).toBe(true);

    await context.close();
  });
});
