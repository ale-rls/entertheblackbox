import { describe, it, expect, vi } from "vitest";
import { DEFAULT_DISPLAY_SETTINGS } from "@entertheblackbox/protocol";
import type { PocketBaseClient } from "./pocketbase-client.js";
import { readDisplaySettings, writeDisplaySettings } from "./platform-config.js";
function setup(items: unknown[] = []) {
  const collection = { getList: vi.fn(async () => ({ items })), create: vi.fn(async () => ({})), update: vi.fn(async () => ({})) };
  const client = { ensureAuth: vi.fn(async () => {}), pb: { collection: vi.fn(() => collection) } };
  return { collection, client: client as unknown as PocketBaseClient };
}
describe("platform display persistence", () => {
  it("uses defaults only when the display namespace has no record", async () => {
    const { client, collection } = setup();
    expect(await readDisplaySettings(client)).toEqual(DEFAULT_DISPLAY_SETTINGS);
    expect(collection.getList).toHaveBeenCalledWith(1, 1, { filter: 'key = "display"', requestKey: null });
    collection.getList.mockRejectedValueOnce(new Error("offline"));
    await expect(readDisplaySettings(client)).rejects.toThrow("offline");
  });
  it("creates and updates just the display namespace, including intentionally blank text", async () => {
    const first = setup();
    const value = { ...DEFAULT_DISPLAY_SETTINGS, heading: "Welcome", waitingVideoUrl: "/media/lobby.mp4", groupWaitingVideoUrls: { red: "/media/red.mp4", blue: "" }, networkInstructions: "", showJoinUrl: false };
    await writeDisplaySettings(first.client, value);
    expect(first.collection.create).toHaveBeenCalledWith({ key: "display", value }, { requestKey: null });
    const next = setup([{ id: "display-record", value }]);
    expect(await readDisplaySettings(next.client)).toEqual(value);
    await writeDisplaySettings(next.client, { ...value, heading: "Hallo" });
    expect(next.collection.update).toHaveBeenCalledWith("display-record", { value: { ...value, heading: "Hallo" } }, { requestKey: null });
    expect(next.collection.create).not.toHaveBeenCalled();
  });
  it("does not overwrite storage after a failed read", async () => {
    const { client, collection } = setup();
    collection.getList.mockRejectedValueOnce(new Error("permission denied"));
    await expect(writeDisplaySettings(client, DEFAULT_DISPLAY_SETTINGS)).rejects.toThrow("permission denied");
    expect(collection.create).not.toHaveBeenCalled();
    expect(collection.update).not.toHaveBeenCalled();
  });
});
