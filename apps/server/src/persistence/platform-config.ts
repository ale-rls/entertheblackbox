import { DEFAULT_DISPLAY_SETTINGS, displaySettingsSchema, wallLayoutSchema, type DisplaySettings } from "@entertheblackbox/protocol";
import { DEFAULT_WALL_LAYOUT, type WallLayout } from "@entertheblackbox/shared";
import type { PocketBaseClient } from "./pocketbase-client.js";

const COLLECTION = "platform_config";
const KEY = "display";
const WALL_KEY = "video-wall";
async function record(client: PocketBaseClient, key = KEY) {
  await client.ensureAuth();
  // An empty list means unset; collection/auth/network errors must propagate.
  const result = await client.pb.collection(COLLECTION).getList(1, 1, { filter: `key = "${key}"`, requestKey: null });
  return result.items[0];
}
export async function readDisplaySettings(client: PocketBaseClient): Promise<DisplaySettings> {
  const stored = await record(client);
  return stored ? displaySettingsSchema.parse(stored.value) : { ...DEFAULT_DISPLAY_SETTINGS };
}
export async function writeDisplaySettings(client: PocketBaseClient, value: DisplaySettings): Promise<DisplaySettings> {
  const validated = displaySettingsSchema.parse(value);
  const stored = await record(client);
  const collection = client.pb.collection(COLLECTION);
  if (stored) await collection.update(stored.id, { value: validated }, { requestKey: null });
  else await collection.create({ key: KEY, value: validated }, { requestKey: null });
  return validated;
}

export async function readWallLayout(client: PocketBaseClient): Promise<WallLayout> {
  const stored = await record(client, WALL_KEY);
  return stored ? wallLayoutSchema.parse(stored.value) : DEFAULT_WALL_LAYOUT;
}
export async function writeWallLayout(client: PocketBaseClient, value: WallLayout): Promise<WallLayout> {
  const validated = wallLayoutSchema.parse(value);
  const stored = await record(client, WALL_KEY);
  const collection = client.pb.collection(COLLECTION);
  if (stored) await collection.update(stored.id, { value: validated }, { requestKey: null });
  else await collection.create({ key: WALL_KEY, value: validated }, { requestKey: null });
  return validated;
}
