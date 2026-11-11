import Fastify from "fastify";
import { expect, it } from "vitest";
import { registerAdminRoutes } from "./admin.js";

it("protects private scripts, isolates reader permissions and revokes links", async () => {
  const app = Fastify();
  registerAdminRoutes(app, { verifyToken: async t => t === "operator", engine: () => null, ready: true, startedAt: 0 });
  const headers = { authorization: "Bearer operator" };
  const payload = { title: "Rehearsal", text: "First line\r\nsecond line\r\n\r\nNext cue" };
  try {
    for (const method of ["GET", "PUT", "DELETE"] as const) expect((await app.inject({ method, url: "/api/admin/script", ...(method === "PUT" ? { payload } : {}) })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/actor-script" })).statusCode).toBe(404);
    const created = await app.inject({ method: "PUT", url: "/api/admin/script", headers, payload });
    expect(created.statusCode).toBe(200);
    expect(created.headers["cache-control"]).toBe("no-store");
    const { script, readerToken } = created.json();
    expect(script.paragraphs).toEqual(["First line\nsecond line", "Next cue"]);
    const readerHeaders = { authorization: `Bearer ${readerToken}` };
    const read = await app.inject({ url: "/api/actor-script", headers: readerHeaders });
    expect(read.json()).toEqual({ script });
    expect(read.headers["cache-control"]).toBe("no-store");
    expect((await app.inject({ method: "DELETE", url: "/api/admin/script", headers: readerHeaders })).statusCode).toBe(401);
    expect((await app.inject({ method: "PATCH", url: "/api/admin/script/cue", headers, payload: { revision: script.revision, cue: 2 } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: "/api/admin/script/cue", headers, payload: { revision: "stale", cue: 1 } })).statusCode).toBe(409);
    expect((await app.inject({ method: "PATCH", url: "/api/admin/script/cue", headers, payload: { revision: script.revision, cue: 1 } })).json().script.cue).toBe(1);
    const rotated = (await app.inject({ method: "POST", url: "/api/admin/script/rotate-link", headers })).json();
    expect(rotated.readerToken).not.toBe(readerToken);
    expect((await app.inject({ url: "/api/actor-script", headers: readerHeaders })).statusCode).toBe(404);
    const replaced = (await app.inject({ method: "PUT", url: "/api/admin/script", headers, payload })).json();
    expect(replaced.script.revision).not.toBe(script.revision);
    expect((await app.inject({ url: "/api/actor-script", headers: { authorization: `Bearer ${rotated.readerToken}` } })).statusCode).toBe(404);
    await app.inject({ method: "DELETE", url: "/api/admin/script", headers });
    expect((await app.inject({ url: "/api/actor-script", headers: { authorization: `Bearer ${replaced.readerToken}` } })).statusCode).toBe(404);
  } finally { await app.close(); }
});

it("rejects empty or excessive scripts without replacing the existing room", async () => {
  const app = Fastify();
  registerAdminRoutes(app, { verifyToken: async () => true, engine: () => null, ready: true, startedAt: 0 });
  const headers = { authorization: "Bearer operator" };
  try {
    for (const payload of [{ title: "", text: "hi" }, { title: "title", text: "  " }, { title: "title", text: "x".repeat(200001) }, { title: "title", text: Array(2001).fill("x").join("\n\n") }]) {
      expect((await app.inject({ method: "PUT", url: "/api/admin/script", headers, payload })).statusCode).toBe(400);
    }
    expect((await app.inject({ url: "/api/admin/script", headers })).json().script).toBeNull();
  } finally { await app.close(); }
});
