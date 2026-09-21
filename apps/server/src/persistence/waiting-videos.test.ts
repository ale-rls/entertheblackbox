import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { PocketBaseClient } from "./pocketbase-client.js";
import { listWaitingVideos } from "./waiting-videos.js";

it("lists only safe video filenames from the full library and checks local sync readiness", async () => {
  const directory = await mkdtemp(join(tmpdir(), "waiting-videos-"));
  const records = [
    { src: "waiting clip.mp4", bytes: 3 }, { src: "pending.webm", bytes: 5 },
    { src: "partial.mp4", bytes: 9 }, { src: "sound.mp3", bytes: 1 },
    { src: "../outside.mp4", bytes: 3 }, { src: "folder\\outside.mp4", bytes: 3 },
  ];
  const client = { ensureAuth: vi.fn(), pb: { collection: vi.fn(() => ({ getFullList: vi.fn(async () => records) })) } };
  try {
    await writeFile(join(directory, "waiting clip.mp4"), "123");
    await writeFile(join(directory, "partial.mp4"), "123");
    expect(await listWaitingVideos(client as unknown as PocketBaseClient, directory)).toEqual([
      { src: "waiting clip.mp4", url: "/media/waiting%20clip.mp4", available: true },
      { src: "pending.webm", url: "/media/pending.webm", available: false },
      { src: "partial.mp4", url: "/media/partial.mp4", available: false },
    ]);
    expect(client.ensureAuth).toHaveBeenCalled();
    expect(client.pb.collection).toHaveBeenCalledWith("media");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
