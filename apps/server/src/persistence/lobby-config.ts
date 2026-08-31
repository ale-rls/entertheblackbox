import type { PocketBaseClient } from "./pocketbase-client.js";

const COLLECTION = "lobby_config";

type StoredLobbyConfig = { id: string; startTimes?: unknown };

async function currentRecord(client: PocketBaseClient): Promise<StoredLobbyConfig | null> {
  try {
    const record = await client.pb.collection(COLLECTION).getFirstListItem("");
    return { id: record.id, startTimes: record.startTimes };
  } catch {
    return null;
  }
}

export async function readLobbyStartTimes(client: PocketBaseClient): Promise<number[]> {
  await client.ensureAuth();
  const record = await currentRecord(client);
  if (!record || !Array.isArray(record.startTimes)) return [];
  return [...new Set(record.startTimes.filter(
    (time): time is number => typeof time === "number" && Number.isSafeInteger(time) && time > 0,
  ))].sort((a, b) => a - b);
}

export async function writeLobbyStartTimes(client: PocketBaseClient, startTimes: readonly number[]): Promise<void> {
  await client.ensureAuth();
  const existing = await currentRecord(client);
  const data = { startTimes: [...startTimes] };
  if (existing) await client.pb.collection(COLLECTION).update(existing.id, data);
  else await client.pb.collection(COLLECTION).create(data);
}
