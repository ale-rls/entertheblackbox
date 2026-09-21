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
    expect((await app.inject({ url: "/api/admin/settings/display", headers })).json()).toEqual({ groups: [], configured: true, display: DEFAULT_DISPLAY_SETTINGS });
    for (const payload of [{ ...DEFAULT_DISPLAY_SETTINGS, countdownTemplate: "no time" }, { ...DEFAULT_DISPLAY_SETTINGS, heading: "x".repeat(161) }, { ...DEFAULT_DISPLAY_SETTINGS, secret: "no" }, { ...DEFAULT_DISPLAY_SETTINGS, waitingVideoUrl: "javascript:alert(1)" }, { ...DEFAULT_DISPLAY_SETTINGS, groupWaitingVideoUrls: { red: "file:///movie.mp4" } }]) {
      expect((await app.inject({ method: "PUT", url: "/api/admin/settings/display", headers, payload })).statusCode).toBe(400);
    }
    expect(write).not.toHaveBeenCalled();
    expect((await app.inject({ method: "PUT", url: "/api/admin/settings/display", headers, payload: { ...DEFAULT_DISPLAY_SETTINGS, heading: "Hallo" } })).json().display.heading).toBe("Hallo");
    write.mockRejectedValueOnce(new Error("PocketBase unavailable"));
    expect((await app.inject({ method: "PUT", url: "/api/admin/settings/display", headers, payload: DEFAULT_DISPLAY_SETTINGS })).statusCode).toBe(500);
  } finally { await app.close(); }
});

it("authenticates library listing and reports unavailable persistence", async () => {
  const app = Fastify();
  const videos = [{ src: "waiting.mp4", url: "/media/waiting.mp4", available: true }];
  const list = vi.fn(async () => videos);
  registerAdminRoutes(app, { verifyToken: async (token) => token === "operator", engine: () => null, ready: true, startedAt: 0, waitingVideos: list });
  try {
    expect((await app.inject({ url: "/api/admin/settings/waiting-videos" })).statusCode).toBe(401);
    expect(list).not.toHaveBeenCalled();
    const response = await app.inject({ url: "/api/admin/settings/waiting-videos", headers: { authorization: "Bearer operator" } });
    expect(response.json()).toEqual({ videos });
    expect(response.headers["cache-control"]).toBe("no-store");
    list.mockRejectedValueOnce(new Error("offline"));
    expect((await app.inject({ url: "/api/admin/settings/waiting-videos", headers: { authorization: "Bearer operator" } })).statusCode).toBe(500);
  } finally { await app.close(); }
});
