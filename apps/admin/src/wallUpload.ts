import PocketBase from "pocketbase";
import { parseWallSliceFileName, WALL_CLIP_NAME } from "@entertheblackbox/shared";

/**
 * Media library name for a file uploaded from Admin → Wall:
 * - `ocean__A1.mp4` stays as is (a pre-cut slice),
 * - `A1.mp4` (as exported per position) becomes `<clip>__A1.mp4`,
 * - any other `.mp4` is a whole video, cut on the tablets.
 */
export function wallUploadName(fileName: string, clip: string): { src: string; kind: "slice" | "whole" } | { error: string } {
  const name = fileName.trim();
  if (!/\.mp4$/i.test(name)) return { error: `${name}: only MP4 videos can play on the wall.` };
  if (parseWallSliceFileName(name)) return { src: name, kind: "slice" };
  const position = /^([A-Za-z])([0-9]{1,2})\.mp4$/i.exec(name);
  if (position) {
    if (!WALL_CLIP_NAME.test(clip)) return { error: `${name}: enter a clip name (letters, digits, dashes) to name this slice.` };
    return { src: `${clip}__${position[1]!.toUpperCase()}${position[2]}.mp4`, kind: "slice" };
  }
  if (/[\\/]/.test(name) || name.length > 100) return { error: `${name}: file name too long or invalid.` };
  return { src: name, kind: "whole" };
}

async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

/** Add or replace a video in the shared media library (same records Studio's Media library writes). */
export async function uploadWallVideo(pocketbaseUrl: string, token: string, file: File, src: string): Promise<void> {
  const pb = new PocketBase(pocketbaseUrl);
  pb.autoCancellation(false);
  if (token) pb.authStore.save(token, null);
  const named = file.name === src ? file : new File([file], src, { type: file.type || "video/mp4" });
  const data = { src, bytes: named.size, hash: await sha256Hex(named), file: named };
  const existing = await pb.collection("media").getFirstListItem(pb.filter("src = {:src}", { src })).catch(() => null);
  if (existing) await pb.collection("media").update(existing.id, data);
  else await pb.collection("media").create(data);
}
