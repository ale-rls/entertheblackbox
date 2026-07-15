import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { localMediaManifestPlugin, scanLocalMedia } from "./local-media.js";

type UploadRequest = Readable & { method: string; url: string; headers: Record<string, string> };
type UploadResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  setHeader(name: string, value: string): void;
  end(value?: string): void;
};

const uploadHandler = (directory: string) => {
  const handlers: Array<(request: UploadRequest, response: UploadResponse, next: () => void) => Promise<void>> = [];
  const plugin = localMediaManifestPlugin(directory);
  if (typeof plugin.configureServer !== "function") throw new Error("Expected a configureServer hook");
  plugin.configureServer({
    middlewares: { use: (...args: unknown[]) => { handlers.push(args.at(-1) as typeof handlers[number]); } },
    config: { logger: { error: () => undefined } },
  } as never);
  return handlers[0];
};

const upload = async (handler: ReturnType<typeof uploadHandler>, source: string, bytes: string) => {
  const request = Object.assign(Readable.from([bytes]), {
    method: "PUT",
    url: `/__studio/local-media/${encodeURIComponent(source)}`,
    headers: { "content-length": String(Buffer.byteLength(bytes)) },
  });
  const response: UploadResponse = {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(name, value) { this.headers[name] = value; },
    end(value = "") { this.body = value; },
  };
  await handler(request, response, () => undefined);
  return response;
};

describe("local media manifest scanner", () => {
  it("recursively inventories local media with stable paths, sizes, hashes, and ordering", async () => {
    const directory = await mkdtemp(join(tmpdir(), "studio-media-"));
    await mkdir(join(directory, "nested"));
    await writeFile(join(directory, "z.mp4"), "z");
    await writeFile(join(directory, "nested", "a.mp4"), "abc");
    await writeFile(join(directory, ".DS_Store"), "ignored");

    await expect(scanLocalMedia(directory)).resolves.toEqual({ files: [
      {
        src: "nested/a.mp4",
        bytes: 3,
        hash: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      },
      {
        src: "z.mp4",
        bytes: 1,
        hash: "594e519ae499312b29433b7dd8a97ff068defcba9755b6d5d00e84c524d67b06",
      },
    ] });
  });

  it("streams MP4/WebM uploads without overwriting collisions and rejects MOV", async () => {
    const directory = await mkdtemp(join(tmpdir(), "studio-media-upload-"));
    const handler = uploadHandler(directory);

    const added = await upload(handler, "new.mp4", "video-bytes");
    expect(added.statusCode).toBe(201);
    await expect(readFile(join(directory, "new.mp4"), "utf8")).resolves.toBe("video-bytes");

    const collision = await upload(handler, "new.mp4", "replacement");
    expect(collision.statusCode).toBe(409);
    expect(JSON.parse(collision.body).error).toContain("already exists");
    await expect(readFile(join(directory, "new.mp4"), "utf8")).resolves.toBe("video-bytes");

    const mov = await upload(handler, "unsupported.mov", "mov");
    expect(mov.statusCode).toBe(400);
    expect(JSON.parse(mov.body).error).toContain("MOV is not supported");
  });
});
