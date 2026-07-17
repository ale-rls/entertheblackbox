import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webp": "image/webp",
};

async function sendFile(
  reply: FastifyReply,
  filePath: string,
  cacheControl: string,
  notFoundError: string,
): Promise<void> {
  try {
    const bytes = await readFile(filePath);
    reply
      .header("cache-control", cacheControl)
      .type(contentTypes[extname(filePath).toLowerCase()] ?? "application/octet-stream")
      .send(bytes);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EISDIR") {
      await reply.code(404).send({ error: notFoundError });
      return;
    }
    throw error;
  }
}

async function sendBundleFile(
  reply: FastifyReply,
  root: string,
  requestedPath: string,
  rangeHeader: string | undefined,
): Promise<void> {
  const relative = requestedPath === "" ? "index.html" : requestedPath;
  const rootPath = resolve(root);
  const filePath = resolve(rootPath, relative);
  if (filePath !== rootPath && !filePath.startsWith(`${rootPath}${sep}`)) {
    await reply.code(400).send({ error: "invalid_asset_path" });
    return;
  }

  const extension = extname(filePath).toLowerCase();
  if (contentTypes[extension]?.startsWith("video/")) {
    await sendRangedFile(reply, filePath, rangeHeader, "asset_not_found");
    return;
  }

  await sendFile(
    reply,
    filePath,
    extension === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
    "asset_not_found",
  );
}

type ByteRange = {
  start: number;
  end: number;
};

function parseByteRange(header: string, fileSize: number): ByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null || (match[1] === "" && match[2] === "") || fileSize === 0) {
    return null;
  }

  const first = match[1] ?? "";
  const last = match[2] ?? "";
  if (first === "") {
    const suffixLength = Number(last);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(fileSize - suffixLength, 0), end: fileSize - 1 };
  }

  const start = Number(first);
  if (!Number.isSafeInteger(start) || start >= fileSize) return null;
  if (last === "") return { start, end: fileSize - 1 };

  const requestedEnd = Number(last);
  if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) return null;
  return { start, end: Math.min(requestedEnd, fileSize - 1) };
}

async function sendRangedFile(
  reply: FastifyReply,
  filePath: string,
  rangeHeader: string | undefined,
  notFoundError: string,
): Promise<void> {
  let fileSize: number;
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      await reply.code(404).send({ error: notFoundError });
      return;
    }
    fileSize = fileStat.size;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EISDIR") {
      await reply.code(404).send({ error: notFoundError });
      return;
    }
    throw error;
  }

  reply
    .header("accept-ranges", "bytes")
    .header("cache-control", "public, max-age=31536000, immutable");

  if (rangeHeader !== undefined) {
    const range = parseByteRange(rangeHeader, fileSize);
    if (range === null) {
      await reply
        .code(416)
        .header("content-range", `bytes */${fileSize}`)
        .send();
      return;
    }

    const contentLength = range.end - range.start + 1;
    await reply
      .code(206)
      .header("content-range", `bytes ${range.start}-${range.end}/${fileSize}`)
      .header("content-length", contentLength)
      .type(contentTypes[extname(filePath).toLowerCase()] ?? "application/octet-stream")
      .send(createReadStream(filePath, range));
    return;
  }

  await reply
    .header("content-length", fileSize)
    .type(contentTypes[extname(filePath).toLowerCase()] ?? "application/octet-stream")
    .send(createReadStream(filePath));
}

export function registerMediaRoutes(
  app: FastifyInstance,
  mediaManifestPath: string,
  mediaDir: string,
): void {
  app.get("/media-manifest.json", async (_request, reply) => {
    await sendFile(reply, resolve(mediaManifestPath), "no-cache", "media_manifest_not_found");
  });

  app.get<{ Params: { "*": string } }>("/media/*", async (request, reply) => {
    const rootPath = resolve(mediaDir);
    const filePath = resolve(rootPath, request.params["*"]);
    if (filePath === rootPath || !filePath.startsWith(`${rootPath}${sep}`)) {
      await reply.code(404).send({ error: "media_not_found" });
      return;
    }

    await sendRangedFile(reply, filePath, request.headers.range, "media_not_found");
  });
}

export function registerBundleRoutes(
  app: FastifyInstance,
  bundles: Record<"display" | "phone" | "admin", string>,
): void {
  app.get("/", async (_request, reply) => reply.redirect("/display/"));

  for (const role of ["display", "phone", "admin"] as const) {
    app.get(`/${role}`, async (_request, reply) => reply.redirect(`/${role}/`));
    app.get<{ Params: { "*": string } }>(`/${role}/*`, async (request, reply) => {
      await sendBundleFile(reply, bundles[role], request.params["*"], request.headers.range);
    });
  }
}
