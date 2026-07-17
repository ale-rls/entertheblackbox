import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerBundleRoutes } from "./static.js";

const apps: FastifyInstance[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function bundleApp(): Promise<FastifyInstance> {
  const root = await mkdtemp(join(tmpdir(), "smartphonecracy-bundle-"));
  const assets = join(root, "assets");
  roots.push(root);
  await mkdir(assets);
  await writeFile(join(root, "index.html"), "<h1>display</h1>");
  await writeFile(join(assets, "idle-attract.mp4"), "0123456789");
  await writeFile(join(assets, "app.js"), "console.log('ready')");

  const app = Fastify();
  apps.push(app);
  registerBundleRoutes(app, { display: root, phone: root, admin: root });
  return app;
}

describe("bundle video assets", () => {
  it("serves full files and byte ranges with video response headers", async () => {
    const app = await bundleApp();

    const full = await app.inject({ url: "/display/assets/idle-attract.mp4" });
    expect(full.statusCode).toBe(200);
    expect(full.body).toBe("0123456789");
    expect(full.headers["content-type"]).toBe("video/mp4");
    expect(full.headers["content-length"]).toBe("10");
    expect(full.headers["accept-ranges"]).toBe("bytes");
    expect(full.headers["cache-control"]).toBe("public, max-age=31536000, immutable");

    const partial = await app.inject({
      url: "/display/assets/idle-attract.mp4",
      headers: { range: "bytes=2-5" },
    });
    expect(partial.statusCode).toBe(206);
    expect(partial.body).toBe("2345");
    expect(partial.headers["content-range"]).toBe("bytes 2-5/10");
    expect(partial.headers["content-length"]).toBe("4");
    expect(partial.headers["accept-ranges"]).toBe("bytes");
    expect(partial.headers["content-type"]).toBe("video/mp4");
  });

  it("rejects unsatisfiable video ranges without changing bundle error responses", async () => {
    const app = await bundleApp();

    const unsatisfiable = await app.inject({
      url: "/display/assets/idle-attract.mp4",
      headers: { range: "bytes=10-" },
    });
    expect(unsatisfiable.statusCode).toBe(416);
    expect(unsatisfiable.headers["content-range"]).toBe("bytes */10");

    const missing = await app.inject({ url: "/display/assets/missing.mp4" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: "asset_not_found" });
  });

  it("keeps non-video bundle assets on whole-file responses", async () => {
    const app = await bundleApp();

    const response = await app.inject({
      url: "/display/assets/app.js",
      headers: { range: "bytes=0-2" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("console.log('ready')");
    expect(response.headers["accept-ranges"]).toBeUndefined();
    expect(response.headers["content-range"]).toBeUndefined();
  });
});
