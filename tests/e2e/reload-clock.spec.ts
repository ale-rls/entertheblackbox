import { expect, test } from "@playwright/test";
import { adminAction, adminStatus, startServer, type E2eServer } from "./helpers/server.js";
import { displayUrl, joinPhone, phoneUrl } from "./helpers/clients.js";

/**
 * §16: stale-bundle reload chain (STEP-030/031) and server-time-corrected
 * countdowns under device clock skew (STEP-013).
 */
test.describe("stale bundle reload", () => {
  let server: E2eServer;

  test.beforeEach(async () => {
    // Bundles bake "0.0.0-dev"; a different server BUILD_VERSION makes
    // every join a version mismatch → { t: "reload" } instruction.
    server = await startServer({ BUILD_VERSION: "e2e-newer-build" });
  });

  test.afterEach(async () => {
    await server.stop();
  });

  /**
   * The bundle under test stays stale after reloading (there is no newer
   * bundle to fetch in this harness), so the client re-joins and is told
   * to reload again. Three page loads therefore prove the full §16 chain
   * twice over: join → reload received → app-shell reload → re-join.
   */
  async function countLoads(page: import("@playwright/test").Page, url: string, join = false): Promise<void> {
    await page.addInitScript(() => {
      const count = Number(sessionStorage.getItem("e2eLoads") ?? "0") + 1;
      sessionStorage.setItem("e2eLoads", String(count));
    });
    await page.goto(url);
    if (join) {
      await page.locator("#participant-name").fill("Stale bundle visitor");
      await page.getByRole("button", { name: "Join", exact: true }).click();
    }
    await expect
      .poll(
        // The evaluate can race the very navigation it is counting;
        // a destroyed context just means "count again next poll".
        () =>
          page
            .evaluate(() => Number(sessionStorage.getItem("e2eLoads") ?? "0"))
            .catch(() => 0),
        { timeout: 30_000 },
      )
      .toBeGreaterThanOrEqual(3);
  }

  test("stale display bundle reloads and reconnects", async ({ browser }) => {
    const display = await browser.newPage();
    await countLoads(display, displayUrl(server.baseUrl));
    await display.close();
  });

  test("stale phone bundle reloads and reconnects", async ({ browser }) => {
    const phone = await browser.newPage();
    await countLoads(phone, phoneUrl(server.baseUrl), true);
    await phone.close();
  });
});

test.describe("clock offset", () => {
  let server: E2eServer;

  test.beforeEach(async () => {
    server = await startServer();
  });

  test.afterEach(async () => {
    await server.stop();
  });

  test("display countdown stays correct with a +5 min device clock", async ({ browser }) => {
    const display = await browser.newPage();
    // Skew the kiosk's Date.now() by +5 minutes before any app code runs.
    // A countdown computed from the device clock would render ≈ -294 s;
    // the ServerClock-corrected one must stay inside the real phase window.
    await display.addInitScript(() => {
      const realNow = Date.now.bind(Date);
      const skewMs = 5 * 60 * 1000;
      Date.now = () => realNow() + skewMs;
    });
    await display.goto(displayUrl(server.baseUrl));
    await expect(display.locator(".idle")).toBeVisible();
    await expect.poll(async () => (await adminStatus(server.baseUrl)).displayConnected).toBe(true);

    const phone = await browser.newPage();
    await joinPhone(phone, server.baseUrl, "Clock visitor");
    await adminAction(server.baseUrl, "start");
    await expect
      .poll(async () => (await adminStatus(server.baseUrl)).phaseId, { timeout: 30_000 })
      .toBe("question-fixed");

    // question-fixed runs 6 s: a corrected countdown shows 0..7.
    const countdown = display.locator(".countdown");
    await expect(countdown).toBeVisible({ timeout: 10_000 });
    const value = Number(await countdown.textContent());
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(7);

    await phone.close();
    await display.close();
  });
});
