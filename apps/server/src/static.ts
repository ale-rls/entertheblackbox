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
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
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

  // sw.js (apps/display's app-shell service worker) must never get the
  // year-long immutable cache below: browsers otherwise keep an old SW
  // in control of the page for up to 24h (or until manually cleared),
  // which keeps serving its own old cached bundle regardless of how many
  // times the server gets redeployed with a fix.
  const cacheControl = relative === "sw.js"
    ? "no-cache"
    : extension === ".html" ? "no-cache" : "public, max-age=31536000, immutable";

  await sendFile(reply, filePath, cacheControl, "asset_not_found");
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
  cacheControl = "public, max-age=31536000, immutable",
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
    .header("cache-control", cacheControl);

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
  mediaDir: string,
  activeNativeManifest?: () => Promise<unknown>,
): void {
  app.get<{ Params: { "*": string } }>("/media/*", async (request, reply) => {
    if (/^native-shows\/channels\/(rehearsal|production)\.json$/.test(request.params["*"]) && activeNativeManifest) {
      reply.header("cache-control", "no-store");
      try { return reply.send(await activeNativeManifest()); }
      catch { return reply.code(503).send({ error: "active_show_content_unavailable" }); }
    }
    const rootPath = resolve(mediaDir);
    const filePath = resolve(rootPath, request.params["*"]);
    if (filePath === rootPath || !filePath.startsWith(`${rootPath}${sep}`)) {
      await reply.code(404).send({ error: "media_not_found" });
      return;
    }

    const mutableShowChannel = /^native-shows\/channels\/(rehearsal|production)\.json$/.test(request.params["*"]);
    await sendRangedFile(reply, filePath, request.headers.range, "media_not_found",
      mutableShowChannel ? "no-store" : "public, max-age=31536000, immutable");
  });
}

export function registerBundleRoutes(
  app: FastifyInstance,
  bundles: Record<"display" | "phone" | "admin" | "studio", string>,
): void {
  // Participant browser entry points only explain native-app admission.
  // Keep legacy URLs so printed QR codes remain useful, never serve the old web client.
  const nativeJoin = async (_request: unknown, reply: FastifyReply) => {
    reply.header("cache-control", "no-store").type("text/html; charset=utf-8").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Enter the Blackbox</title>
<style>body{background:#111;color:#fff;font:20px/1.5 system-ui;max-width:36rem;margin:10vh auto;padding:24px}a{color:#fff}small{color:#bbb}</style></head>
<body><h1>Enter the Blackbox</h1><p>Join with the Enter the Blackbox app on your iPhone, iPad or Android device.</p>
<p><a href="entertheblackbox://">Open the app</a></p><p>In the app, choose the venue server, enter your name, then tap “Update show &amp; join”. The app downloads and verifies the show before you join.</p>
<p>If you need the app or a loan device, please ask the entrance team.</p><small>This browser page does not play show audio or collect votes.</small></body></html>`);
  };
  app.get("/", nativeJoin);
  for (const path of ["/phone", "/phone/*", "/phone-janus", "/phone-janus/*"]) app.get(path, nativeJoin);
  for (const role of ["display", "admin", "studio"] as const) {
    app.get(`/${role}`, async (_request, reply) => reply.redirect(`/${role}/`));
    app.get<{ Params: { "*": string } }>(`/${role}/*`, async (request, reply) => {
      await sendBundleFile(reply, bundles[role], request.params["*"], request.headers.range);
    });
  }
}
