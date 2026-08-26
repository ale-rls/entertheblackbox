import type { PocketBaseClient } from "./pocketbase-client.js";

/** The pending activeShowId an operator has saved, if any. */
export type ServerConfigOverride = {
  activeShowId?: string;
};

const COLLECTION = "installation_config";

type StoredRecord = { id: string; activeShowId?: string };

async function currentRecord(client: PocketBaseClient): Promise<StoredRecord | null> {
  try {
    const record = await client.pb.collection(COLLECTION).getFirstListItem("");
    return { id: record.id, activeShowId: record.activeShowId };
  } catch {
    return null;
  }
}

export async function readServerConfigOverride(
  client: PocketBaseClient,
): Promise<ServerConfigOverride | null> {
  await client.ensureAuth();
  const record = await currentRecord(client);
  if (!record) return null;
  return record.activeShowId === undefined ? {} : { activeShowId: record.activeShowId };
}

/** Sets the active show. */
export async function writeActiveShowId(client: PocketBaseClient, showId: string): Promise<void> {
  await client.ensureAuth();
  const existing = await currentRecord(client);
  if (existing) {
    await client.pb.collection(COLLECTION).update(existing.id, { activeShowId: showId });
  } else {
    await client.pb.collection(COLLECTION).create({ activeShowId: showId });
  }
}
