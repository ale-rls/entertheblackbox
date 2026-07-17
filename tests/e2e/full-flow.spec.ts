import { expect, test } from "@playwright/test";
import { adminStatus, startServer, type E2eServer } from "./helpers/server.js";
import { displayUrl, dragTrackpad, phoneUrl } from "./helpers/clients.js";

/**
 * §16: display readiness gate, QR admission (signed grant), solo lobby
 * start, video fallback, both question kinds resolving, return to idle.
 * Runs against the real server process and the real built bundles.
 */
test.describe("full scenario flow", () => {
  let server: E2eServer;

  test.beforeEach(async () => {
    server = await startServer();
  });

  test.afterEach(async () => {
    await server.stop();
  });

  test("display boots ready and idles; phone joins; scenario runs to idle", async ({ browser }) => {
    const display = await browser.newPage();
    await display.goto(displayUrl(server.baseUrl));

    // Display must not sit in a media-retry state with intact media, and
    // must render the idle attract layer once ready.
    await expect(display.locator(".idle")).toBeVisible();
    const attractVideo = display.locator(".idle-attract-video");
    await expect(attractVideo).toBeVisible();
    await expect(attractVideo).toHaveAttribute("loop", "");
    await expect(display.locator(".idle-attract-overlay")).toBeVisible();
    await expect(display.locator(".media-status")).toBeHidden({ timeout: 20_000 });
    const cursorGeometry = await display.locator(".layer-cursors").evaluate((layer) => {
      const layerRect = layer.getBoundingClientRect();
      const canvasRect = layer.querySelector("canvas")!.getBoundingClientRect();
      return { layer: [layerRect.width, layerRect.height], canvas: [canvasRect.width, canvasRect.height] };
    });
    expect(cursorGeometry.canvas).toEqual(cursorGeometry.layer);
    await expect.poll(async () => (await adminStatus(server.baseUrl)).displayConnected).toBe(true);

    // Large QR is shown while idle (plan §9).
    await expect(display.locator("canvas, img, svg").first()).toBeVisible();

    // Phone joins with a current signed grant → solo participant starts lobby.
    const phone = await browser.newPage();
    await phone.goto(phoneUrl(server.baseUrl));
    await expect(phone.locator(".trackpad")).toBeVisible();
    await expect.poll(async () => (await adminStatus(server.baseUrl)).lifecycle).toBe("lobby");

    // Lobby countdown (10 s default policy) → active, entry video phase.
    await expect
      .poll(async () => (await adminStatus(server.baseUrl)).lifecycle, { timeout: 20_000 })
      .toBe("active");
    expect((await adminStatus(server.baseUrl)).phaseId).toBe("intro-video");

    // The cursor stays interactive over video, and renders as a single
    // crisp dot without a wake/trail.
    await dragTrackpad(phone);
    const cursorCanvas = display.locator(".cursor-canvas");
    await expect.poll(async () => cursorCanvas.evaluate((canvas: HTMLCanvasElement) => {
      const context = canvas.getContext("2d")!;
      const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
      let minX = width;
      let maxX = -1;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (data[(y * width + x) * 4 + 3]! > 0) {
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
          }
        }
      }
      return maxX < 0 ? null : { centerX: (minX + maxX) / 2 / width, width: (maxX - minX + 1) / width };
    })).toMatchObject({ centerX: expect.any(Number), width: expect.any(Number) });
    const cursorShape = await cursorCanvas.evaluate((canvas: HTMLCanvasElement) => {
      const context = canvas.getContext("2d")!;
      const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
      let minX = width;
      let maxX = -1;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (data[(y * width + x) * 4 + 3]! > 0) {
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
          }
        }
      }
      return { centerX: (minX + maxX) / 2 / width, width: (maxX - minX + 1) / width };
    });
    expect(cursorShape.centerX).toBeGreaterThan(0.51);
    expect(cursorShape.width).toBeLessThan(0.03);

    // Video advances via display video_ended or the server's
    // expectedDurationMs+5 s fallback (§16: a missing video_ended cannot
    // block the experience) — either path must land on question-fixed.
    await expect
      .poll(async () => (await adminStatus(server.baseUrl)).phaseId, { timeout: 20_000 })
      .toBe("question-fixed");
    await expect(display.locator(".question h2")).toHaveText(/public transit funding/);
    await expect(display.locator(".quadrant-overlay-four-quadrant")).toBeVisible();
    expect(await display.locator(".axis-cross").evaluate((element) => ({
      position: getComputedStyle(element).position,
      verticalRule: getComputedStyle(element, "::before").content,
      horizontalRule: getComputedStyle(element, "::after").content,
    }))).toEqual({ position: "absolute", verticalRule: '\"\"', horizontalRule: '\"\"' });

    // Trackpad input while the question is live; live counts are enabled
    // in the scenario, so the overlay eventually shows a count.
    await dragTrackpad(phone);
    await expect(display.locator(".quadrant-count").first()).toBeVisible({ timeout: 10_000 });

    // Fixed resolution → four-quadrant question → two-quadrant question.
    await expect
      .poll(async () => (await adminStatus(server.baseUrl)).phaseId, { timeout: 20_000 })
      .toBe("question-quadrant");
    await expect(display.locator(".question h2")).toHaveText(/housing policy/);
    await dragTrackpad(phone);

    await expect
      .poll(async () => (await adminStatus(server.baseUrl)).phaseId, { timeout: 20_000 })
      .toBe("question-two-quadrant");
    await expect(display.locator(".question h2")).toHaveText(/automated decisions/);
    const split = await display.locator(".quadrant-overlay-two-quadrant").evaluate((overlay) => {
      const min = overlay.querySelector<HTMLElement>("[data-quadrant=min]")!;
      const max = overlay.querySelector<HTMLElement>("[data-quadrant=max]")!;
      const divider = overlay.querySelector<HTMLElement>(".axis-divider")!;
      return {
        overlayPosition: getComputedStyle(overlay).position,
        minPosition: getComputedStyle(min).position,
        maxPosition: getComputedStyle(max).position,
        minRight: min.getBoundingClientRect().right,
        maxLeft: max.getBoundingClientRect().left,
        dividerRule: getComputedStyle(divider, "::before").content,
      };
    });
    expect(split).toMatchObject({ overlayPosition: "absolute", minPosition: "absolute", maxPosition: "absolute", dividerRule: '\"\"' });
    expect(Math.abs(split.minRight - split.maxLeft)).toBeLessThan(1);
    await dragTrackpad(phone);

    await expect
      .poll(async () => (await adminStatus(server.baseUrl)).lifecycle, { timeout: 30_000 })
      .toBe("idle");
    await expect(display.locator(".idle")).toBeVisible();
    const returnedAttractVideo = display.locator(".idle-attract-video");
    await expect(returnedAttractVideo).toBeVisible();
    await expect.poll(async () => returnedAttractVideo.evaluate((video: HTMLVideoElement) => ({
      hasError: video.error !== null,
      hasDecodedFrame: video.videoWidth > 0 && video.videoHeight > 0,
      isPlaying: !video.paused && !video.ended,
    }))).toEqual({ hasError: false, hasDecodedFrame: true, isPlaying: true });
    const returnedAttractStartTime = await returnedAttractVideo.evaluate(
      (video: HTMLVideoElement) => video.currentTime,
    );
    await expect.poll(
      async () => returnedAttractVideo.evaluate(
        (video: HTMLVideoElement, startTime) => Math.abs(video.currentTime - startTime),
        returnedAttractStartTime,
      ),
    ).toBeGreaterThan(0.1);

    await phone.close();
    await display.close();
  });

  test("expired grant is rejected with a visible state", async ({ browser }) => {
    const phone = await browser.newPage();
    // ttl -1 ms: already expired when the server verifies it.
    await phone.goto(phoneUrl(server.baseUrl, -1));
    await expect(phone.locator(".rejected")).toBeVisible();
    await expect(phone.locator(".rejected")).toContainText(/expired/i);
    await phone.close();
  });
});
