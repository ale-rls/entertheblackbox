import type { PocketBaseClient } from "./pocketbase-client.js";

export type InstallationConfigOverride = {
  installationId: string;
  roomId: string;
};

/** The pending installationId/roomId/activeShowId an operator has saved, if any -- applied on the next server restart. */
export type ServerConfigOverride = {
  installationId?: string;
  roomId?: string;
  activeShowId?: string;
};

const COLLECTION = "installation_config";

type StoredRecord = { id: string; installationId?: string; roomId?: string; activeShowId?: string };

async function currentRecord(client: PocketBaseClient): Promise<StoredRecord | null> {
  try {
    const record = await client.pb.collection(COLLECTION).getFirstListItem("");
    return {
      id: record.id,
      installationId: record.installationId,
      roomId: record.roomId,
      activeShowId: record.activeShowId,
    };
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
  return {
    ...(record.installationId === undefined ? {} : { installationId: record.installationId }),
    ...(record.roomId === undefined ? {} : { roomId: record.roomId }),
    ...(record.activeShowId === undefined ? {} : { activeShowId: record.activeShowId }),
  };
}

export async function writeInstallationConfigOverride(
  client: PocketBaseClient,
  value: InstallationConfigOverride,
): Promise<void> {
  await client.ensureAuth();
  const existing = await currentRecord(client);
  if (existing) {
    await client.pb.collection(COLLECTION).update(existing.id, value);
  } else {
    await client.pb.collection(COLLECTION).create(value);
  }
}

/** Sets just the active show, independent of any installationId/roomId override. */
export async function writeActiveShowId(client: PocketBaseClient, showId: string): Promise<void> {
  await client.ensureAuth();
  const existing = await currentRecord(client);
  if (existing) {
    await client.pb.collection(COLLECTION).update(existing.id, { activeShowId: showId });
  } else {
    await client.pb.collection(COLLECTION).create({ activeShowId: showId });
  }
}
