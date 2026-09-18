import { DEFAULT_DISPLAY_SETTINGS, displaySettingsSchema, type DisplaySettings } from "@entertheblackbox/protocol";
import type { PocketBaseClient } from "./pocketbase-client.js";

const COLLECTION = "platform_config";
const KEY = "display";
async function record(client: PocketBaseClient) {
  await client.ensureAuth();
  // An empty list means unset; collection/auth/network errors must propagate.
  const result = await client.pb.collection(COLLECTION).getList(1, 1, { filter: `key = "${KEY}"`, requestKey: null });
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
