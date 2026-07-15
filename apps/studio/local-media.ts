import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Plugin } from "vite";

export const LOCAL_MEDIA_MANIFEST_ENDPOINT = "/__studio/local-media-manifest";
export const LOCAL_MEDIA_FILE_ENDPOINT = "/__studio/local-media/";
export const MAX_LOCAL_MEDIA_BYTES = 2 * 1024 * 1024 * 1024;

const VIDEO_EXTENSIONS = new Set([".mp4", ".webm"]);

export type LocalMediaManifest = {
  files: Array<{ src: string; bytes: number; hash: string }>;
};

type HashCache = Map<string, { bytes: number; modifiedAt: number; hash: string }>;

const hashFile = (path: string) => new Promise<string>((resolve, reject) => {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  stream.on("data", (chunk) => hash.update(chunk));
  stream.on("error", reject);
  stream.on("end", () => resolve(hash.digest("hex")));
});

async function regularFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries
    .filter((entry) => !entry.name.startsWith("."))
    .map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return regularFiles(path);
      return entry.isFile() ? [path] : [];
    }));
  return files.flat();
}

/** Build the canonical runtime manifest directly from the local media directory. */
export async function scanLocalMedia(mediaDirectory: string, cache: HashCache = new Map()): Promise<LocalMediaManifest> {
  const paths = await regularFiles(mediaDirectory);
  const files = await Promise.all(paths.map(async (path) => {
    const metadata = await stat(path);
    const cached = cache.get(path);
    const hash = cached?.bytes === metadata.size && cached.modifiedAt === metadata.mtimeMs
      ? cached.hash
      : await hashFile(path);
    cache.set(path, { bytes: metadata.size, modifiedAt: metadata.mtimeMs, hash });
    return {
      src: relative(mediaDirectory, path).split(sep).join("/"),
      bytes: metadata.size,
      hash,
    };
  }));
  files.sort((left, right) => left.src.localeCompare(right.src));
  return { files };
}

/** Expose a fresh manifest to the browser on every Studio page load. */
export function localMediaManifestPlugin(mediaDirectory: string): Plugin {
  const cache: HashCache = new Map();
  return {
    name: "smartphonecracy-local-media-manifest",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? "/", "http://studio.local");
        if (!url.pathname.startsWith(LOCAL_MEDIA_FILE_ENDPOINT)) return next();
        if (request.method !== "GET" && request.method !== "HEAD" && request.method !== "PUT") return next();
        try {
          const source = decodeURIComponent(url.pathname.slice(LOCAL_MEDIA_FILE_ENDPOINT.length));
          const path = resolve(mediaDirectory, source);
          const relativePath = relative(mediaDirectory, path);
          if (!source || relativePath.startsWith("..") || isAbsolute(relativePath)) {
            response.statusCode = 400;
            return response.end("Invalid media path");
          }

          if (request.method === "PUT") {
            if (basename(source) !== source || !VIDEO_EXTENSIONS.has(extname(source).toLowerCase())) {
              response.statusCode = 400;
              response.setHeader("Content-Type", "application/json");
              return response.end(JSON.stringify({ error: "Choose an MP4 or WebM video. MOV is not supported by the venue display." }));
            }
            const declaredBytes = Number(request.headers["content-length"]);
            if (Number.isFinite(declaredBytes) && (declaredBytes <= 0 || declaredBytes > MAX_LOCAL_MEDIA_BYTES)) {
              response.statusCode = 413;
              response.setHeader("Content-Type", "application/json");
              return response.end(JSON.stringify({ error: "The video must be non-empty and no larger than 2 GiB." }));
            }

            await mkdir(mediaDirectory, { recursive: true });
            let written = 0;
            let created = false;
            const limit = new Transform({
              transform(chunk, _encoding, callback) {
                written += chunk.length;
                callback(written > MAX_LOCAL_MEDIA_BYTES ? new Error("media-too-large") : undefined, chunk);
              },
            });
            const output = createWriteStream(path, { flags: "wx" });
            output.once("open", () => { created = true; });
            try {
              await pipeline(request, limit, output);
              if (written === 0) throw new Error("media-empty");
            } catch (error) {
              if (created) await rm(path, { force: true });
              const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
              response.statusCode = code === "EEXIST" ? 409 : error instanceof Error && error.message === "media-too-large" ? 413 : 400;
              response.setHeader("Content-Type", "application/json");
              const message = code === "EEXIST"
                ? `A media file named “${source}” already exists.`
                : error instanceof Error && error.message === "media-too-large"
                  ? "The video must be no larger than 2 GiB."
                  : "The video could not be saved.";
              return response.end(JSON.stringify({ error: message }));
            }
            cache.delete(path);
            response.statusCode = 201;
            response.setHeader("Content-Type", "application/json");
            return response.end(JSON.stringify({ src: source }));
          }

          const metadata = await stat(path);
          if (!metadata.isFile()) {
            response.statusCode = 404;
            return response.end("Media not found");
          }

          const contentTypes: Record<string, string> = {
            ".mp4": "video/mp4",
            ".mov": "video/quicktime",
            ".webm": "video/webm",
          };
          response.setHeader("Content-Type", contentTypes[extname(path).toLowerCase()] ?? "application/octet-stream");
          response.setHeader("Accept-Ranges", "bytes");
          response.setHeader("Cache-Control", "no-store");

          const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
          let start = 0;
          let end = metadata.size - 1;
          if (range) {
            start = range[1] ? Number(range[1]) : start;
            end = range[2] ? Number(range[2]) : end;
            if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= metadata.size) {
              response.statusCode = 416;
              response.setHeader("Content-Range", `bytes */${metadata.size}`);
              return response.end();
            }
            end = Math.min(end, metadata.size - 1);
            response.statusCode = 206;
            response.setHeader("Content-Range", `bytes ${start}-${end}/${metadata.size}`);
          }
          response.setHeader("Content-Length", String(end - start + 1));
          if (request.method === "HEAD") return response.end();
          createReadStream(path, { start, end }).pipe(response);
        } catch {
          response.statusCode = 404;
          response.end("Media not found");
        }
      });
      server.middlewares.use(LOCAL_MEDIA_MANIFEST_ENDPOINT, async (request, response, next) => {
        if (request.method !== "GET") return next();
        try {
          const manifest = await scanLocalMedia(mediaDirectory, cache);
          response.statusCode = 200;
          response.setHeader("Content-Type", "application/json");
          response.setHeader("Cache-Control", "no-store");
          response.end(JSON.stringify(manifest));
        } catch (error) {
          server.config.logger.error(`Could not scan local Studio media: ${error instanceof Error ? error.message : String(error)}`);
          response.statusCode = 500;
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify({ error: "Could not scan content/media" }));
        }
      });
    },
  };
}
