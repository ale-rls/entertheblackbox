import { describe, expect, it } from "vitest";
import { rehearsalId, runtimeApi, runtimeWebSocket } from "./rehearsal.js";
const id = "00000000-0000-4000-8000-000000000001";
describe("device runtime routing", () => {
  it("keeps ordinary phone and display links on production", () => {
    expect(runtimeApi("/api/status", "?group=actors")).toBe("/api/status");
    expect(runtimeWebSocket({ protocol: "https:", host: "show.test", search: "" })).toBe("wss://show.test/ws");
  });
  it("scopes all rehearsal data and websocket connections", () => {
    expect(rehearsalId(`?rehearsal=${id}&group=actors`)).toBe(id);
    expect(runtimeApi("/api/join-config", `?rehearsal=${id}`)).toBe(`/api/rehearsals/${id}/join-config`);
    expect(runtimeApi("/media-manifest.json", `?rehearsal=${id}`)).toBe(`/api/rehearsals/${id}/media-manifest.json`);
    expect(runtimeWebSocket({ protocol: "https:", host: "show.test", search: `?rehearsal=${id}` })).toBe(`wss://show.test/ws?rehearsal=${id}`);
  });
  it("never silently routes a malformed preview link to production", () => {
    expect(runtimeApi("/api/status", "?rehearsal=../../live")).toBe("/api/rehearsals/invalid/status");
    expect(runtimeWebSocket({ protocol: "http:", host: "show.test", search: "?rehearsal=" })).toBe("ws://show.test/ws?rehearsal=invalid");
  });
});
