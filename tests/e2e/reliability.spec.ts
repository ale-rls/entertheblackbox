import { expect, test } from "@playwright/test";
import { adminAction, adminStatus, startServer, type E2eServer } from "./helpers/server.js";
import { displayUrl, dragTrackpad, joinPhone } from "./helpers/clients.js";

/**
 * §16 reliability drills: server-kill recovery, display-kill abort to
 * idle, and second-display replacement. Real server processes, real
 * bundles, real reconnect timers — so generous poll timeouts.
 */
test.describe("reliability", () => {
  let server: E2eServer;

  test.beforeEach(async () => {
    server = await startServer();
  });

  test.afterEach(async () => {
    await server.stop();
  });

  test("server kill mid-session: display reconnects and returns to idle attract", async ({ browser }) => {
    const display = await browser.newPage();
    await display.goto(displayUrl(server.baseUrl));
    await expect(display.locator(".idle")).toBeVisible();
    await expect.poll(async () => (await adminStatus(server.baseUrl)).displayConnected).toBe(true);

    // Drive into an active session so the kill hits mid-experience.
    const phone = await browser.newPage();
    await joinPhone(phone, server.baseUrl, "Reliability visitor");
    await expect(phone.locator(".trackpad")).toBeVisible();
    await adminAction(server.baseUrl, "start");
    await expect
      .poll(async () => (await adminStatus(server.baseUrl)).lifecycle, { timeout: 20_000 })
      .toBe("active");

    // SIGKILL — no graceful shutdown, no goodbye frames. The phone page
    // is closed too (visitor walks away during the outage); a phone that
    // stays would legitimately re-join with its still-valid grant and
    // start a fresh lobby, which would mask the idle-recovery assertion.
    server.kill();
    await phone.close();
    await server.restart();

    // Display client owns reconnect w/ backoff (STEP-013): it must come
    // back on its own — no page reload here — and land on idle attract,
    // because the restarted process boots with no session state.
    await expect
      .poll(async () => (await adminStatus(server.baseUrl)).displayConnected, { timeout: 30_000 })
      .toBe(true);
    expect((await adminStatus(server.baseUrl)).lifecycle).toBe("idle");
    await expect(display.locator(".idle")).toBeVisible();

    // A fresh phone can join the recovered system and start a session.
    const phone2 = await browser.newPage();
    await joinPhone(phone2, server.baseUrl, "Recovery visitor");
    await expect(phone2.locator(".trackpad")).toBeVisible();
    await expect
      .poll(async () => (await adminStatus(server.baseUrl)).lifecycle, { timeout: 20_000 })
      .toBe("lobby");

    await phone2.close();
    await display.close();
  });

  test("display kill mid-session: server aborts to idle and a new display recovers", async ({ browser }) => {
    const display = await browser.newPage();
    await display.goto(displayUrl(server.baseUrl));
    await expect.poll(async () => (await adminStatus(server.baseUrl)).displayConnected).toBe(true);

    const phone = await browser.newPage();
    await joinPhone(phone, server.baseUrl, "Display recovery visitor");
    await adminAction(server.baseUrl, "start");
    await expect
      .poll(async () => (await adminStatus(server.baseUrl)).lifecycle, { timeout: 20_000 })
      .toBe("active");

    // Kill the kiosk (close the page → socket drop, no heartbeat).
    await display.close();
    await expect.poll(async () => (await adminStatus(server.baseUrl)).displayConnected).toBe(false);

    // Display-disconnect policy: abort to idle after the 30 s timeout.
    await expect
      .poll(async () => (await adminStatus(server.baseUrl)).lifecycle, {
        timeout: 60_000,
        intervals: [1_000],
      })
      .toBe("idle");

    // A replacement kiosk joins clean and shows the attract screen.
    const display2 = await browser.newPage();
    await display2.goto(displayUrl(server.baseUrl));
    await expect(display2.locator(".idle")).toBeVisible();
    await expect.poll(async () => (await adminStatus(server.baseUrl)).displayConnected).toBe(true);

    await display2.close();
    await phone.close();
  });

  test("second display replaces the first, which shows a prominent notice", async ({ browser }) => {
    const display1 = await browser.newPage();
    await display1.goto(displayUrl(server.baseUrl));
    await expect(display1.locator(".idle")).toBeVisible();
    await expect.poll(async () => (await adminStatus(server.baseUrl)).displayConnected).toBe(true);

    const display2 = await browser.newPage();
    await display2.goto(displayUrl(server.baseUrl));
    await expect(display2.locator(".idle")).toBeVisible();

    // Single-display policy: the newcomer wins, the old kiosk is told.
    await expect(display1.locator(".notice-prominent")).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => (await adminStatus(server.baseUrl)).displayConnected).toBe(true);

    await display1.close();
    await display2.close();
  });
});
