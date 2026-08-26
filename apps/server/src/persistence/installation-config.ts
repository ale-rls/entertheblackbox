import type { PocketBaseClient } from "./pocketbase-client.js";

/** The pending activeShowId/targetAudienceSize an operator has saved, if any. */
export type ServerConfigOverride = {
  activeShowId?: string;
  targetAudienceSize?: number;
};

const COLLECTION = "installation_config";

type StoredRecord = { id: string; activeShowId?: string; targetAudienceSize?: number };

async function currentRecord(client: PocketBaseClient): Promise<StoredRecord | null> {
  try {
    const record = await client.pb.collection(COLLECTION).getFirstListItem("");
    return { id: record.id, activeShowId: record.activeShowId, targetAudienceSize: record.targetAudienceSize };
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
  // PocketBase always includes every schema field in a record response,
  // defaulting an unset text/number field to ""/0 rather than omitting it
  // -- so "" and 0 below mean "never explicitly set", not a real value.
  // (A genuine "cap ghosts at exactly 0 via this override" isn't
  // distinguishable from "no override" this way; that's an acceptable
  // simplification since omitting targetAudienceSize from the published
  // scenario itself already means zero ghosts.)
  const activeShowId = record.activeShowId === "" ? undefined : record.activeShowId;
  const targetAudienceSize = record.targetAudienceSize === undefined || record.targetAudienceSize <= 0
    ? undefined
    : record.targetAudienceSize;
  return {
    ...(activeShowId === undefined ? {} : { activeShowId }),
    ...(targetAudienceSize === undefined ? {} : { targetAudienceSize }),
  };
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

/** Sets the ghost-cursor fill target override -- takes precedence over the published scenario's own targetAudienceSize when positive. */
export async function writeTargetAudienceSize(client: PocketBaseClient, value: number): Promise<void> {
  await client.ensureAuth();
  const existing = await currentRecord(client);
  if (existing) {
    await client.pb.collection(COLLECTION).update(existing.id, { targetAudienceSize: value });
  } else {
    await client.pb.collection(COLLECTION).create({ targetAudienceSize: value });
  }
}
