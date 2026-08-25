import type { PocketBaseClient } from "./pocketbase-client.js";

export type InstallationConfigOverride = {
  installationId: string;
  roomId: string;
};

const COLLECTION = "installation_config";

async function currentRecord(
  client: PocketBaseClient,
): Promise<{ id: string; installationId: string; roomId: string } | null> {
  try {
    const record = await client.pb.collection(COLLECTION).getFirstListItem("");
    return { id: record.id, installationId: record.installationId, roomId: record.roomId };
  } catch {
    return null;
  }
}

/** The pending installationId/roomId an operator has saved, if any -- applied on the next server restart. */
export async function readInstallationConfigOverride(
  client: PocketBaseClient,
): Promise<InstallationConfigOverride | null> {
  await client.ensureAuth();
  const record = await currentRecord(client);
  return record && { installationId: record.installationId, roomId: record.roomId };
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
