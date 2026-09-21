import { describe, expect, it } from "vitest";
import { currentInstallation, resolveInstallation } from "./resolveInstallation.js";

// currentInstallation() is module-level singleton state (a kiosk never
// reverts to the placeholder default once it has resolved a real value),
// so these cases rely on vitest's default sequential-within-file order.
describe("resolveInstallation", () => {
  it("defaults to inst-1/room-1 before any resolve call", () => {
    expect(currentInstallation()).toEqual({ installationId: "inst-1", roomId: "room-1" });
  });

  it("adopts the server's installationId/roomId on a successful fetch", async () => {
    await resolveInstallation(async () => ({ installationId: "venue-a", roomId: "main" }));
    expect(currentInstallation()).toEqual({ installationId: "venue-a", roomId: "main" });
  });

  it("leaves the previously resolved value alone when the status fetch fails or is incomplete", async () => {
    await resolveInstallation(async () => ({ installationId: "venue-b", roomId: "east" }));
    await resolveInstallation(async () => null);
    expect(currentInstallation()).toEqual({ installationId: "venue-b", roomId: "east" });

    await resolveInstallation(async () => ({ installationId: "venue-c" }));
    expect(currentInstallation()).toEqual({ installationId: "venue-b", roomId: "east" });
  });
});
