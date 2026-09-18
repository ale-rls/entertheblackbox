import Fastify from "fastify";
import { it, expect, vi } from "vitest";
import { DEFAULT_DISPLAY_SETTINGS } from "@entertheblackbox/protocol";
import { registerAdminRoutes } from "./admin.js";
it("requires operator auth, validates text and only reports saved after persistence succeeds", async () => {
  const app = Fastify();
  const write = vi.fn(async (value) => value);
  registerAdminRoutes(app, { verifyToken: async (token) => token === "operator", engine: () => null, ready: true, startedAt: 0,
    displaySettings: { read: async () => DEFAULT_DISPLAY_SETTINGS, write } });
  try {
    expect((await app.inject({ method: "PUT", url: "/api/admin/settings/display", payload: DEFAULT_DISPLAY_SETTINGS })).statusCode).toBe(401);
    const headers = { authorization: "Bearer operator" };
    expect((await app.inject({ url: "/api/admin/settings/display", headers })).json()).toEqual({ configured: true, display: DEFAULT_DISPLAY_SETTINGS });
    for (const payload of [{ ...DEFAULT_DISPLAY_SETTINGS, countdownTemplate: "no time" }, { ...DEFAULT_DISPLAY_SETTINGS, heading: "x".repeat(161) }, { ...DEFAULT_DISPLAY_SETTINGS, secret: "no" }]) {
      expect((await app.inject({ method: "PUT", url: "/api/admin/settings/display", headers, payload })).statusCode).toBe(400);
    }
    expect(write).not.toHaveBeenCalled();
    expect((await app.inject({ method: "PUT", url: "/api/admin/settings/display", headers, payload: { ...DEFAULT_DISPLAY_SETTINGS, heading: "Hallo" } })).json().display.heading).toBe("Hallo");
    write.mockRejectedValueOnce(new Error("PocketBase unavailable"));
    expect((await app.inject({ method: "PUT", url: "/api/admin/settings/display", headers, payload: DEFAULT_DISPLAY_SETTINGS })).statusCode).toBe(500);
  } finally { await app.close(); }
});
