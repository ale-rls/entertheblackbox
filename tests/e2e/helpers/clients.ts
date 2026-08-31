import type { Page } from "@playwright/test";
import {
  DISPLAY_TOKEN,
  INSTALLATION_ID,
  ROOM_ID,
} from "./server.js";

export function displayUrl(baseUrl: string): string {
  const url = new URL(`${baseUrl}/display/`);
  url.searchParams.set("installation", INSTALLATION_ID);
  url.searchParams.set("room", ROOM_ID);
  url.searchParams.set("token", DISPLAY_TOKEN);
  return url.toString();
}

export function phoneUrl(baseUrl: string): string {
  return `${baseUrl}/phone/`;
}

export async function joinPhone(page: Page, baseUrl: string, name = "E2E participant"): Promise<void> {
  await page.goto(phoneUrl(baseUrl));
  await page.locator("#participant-name").fill(name);
  await page.getByRole("button", { name: "Join", exact: true }).click();
  await page.locator(".trackpad").waitFor({ state: "visible" });
  await page.locator(".connection-dot.online").waitFor({ state: "visible" });
}

/** Drag on the phone trackpad — relative input, so any drag moves the cursor. */
export async function dragTrackpad(page: Page): Promise<void> {
  const trackpad = page.locator(".trackpad");
  const box = await trackpad.boundingBox();
  if (!box) throw new Error("trackpad not visible");
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(startX + step * 12, startY - step * 8);
  }
  await page.mouse.up();
}
