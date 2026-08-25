import { describe, expect, it, vi } from "vitest";
import { resolveInstallationParams } from "./resolveInstallation.js";

describe("resolveInstallationParams", () => {
  it("does nothing when the URL already carries both params", async () => {
    const fetchStatus = vi.fn();
    const replaceUrl = vi.fn();
    await resolveInstallationParams({
      location: { search: "?installation=venue-a&room=main&token=abc", pathname: "/display/", hash: "" },
      fetchStatus,
      replaceUrl,
    });
    expect(fetchStatus).not.toHaveBeenCalled();
    expect(replaceUrl).not.toHaveBeenCalled();
  });

  it("fetches and patches in both params when neither is present", async () => {
    const replaceUrl = vi.fn();
    await resolveInstallationParams({
      location: { search: "?token=abc", pathname: "/display/", hash: "" },
      fetchStatus: async () => ({ installationId: "venue-a", roomId: "main" }),
      replaceUrl,
    });
    expect(replaceUrl).toHaveBeenCalledOnce();
    const url = replaceUrl.mock.calls[0]?.[0] as string;
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("installation")).toBe("venue-a");
    expect(params.get("room")).toBe("main");
    expect(params.get("token")).toBe("abc");
  });

  it("only fills in the missing param, leaving an explicit one untouched", async () => {
    const replaceUrl = vi.fn();
    await resolveInstallationParams({
      location: { search: "?installation=explicit-venue", pathname: "/display/", hash: "" },
      fetchStatus: async () => ({ installationId: "venue-a", roomId: "main" }),
      replaceUrl,
    });
    const url = replaceUrl.mock.calls[0]?.[0] as string;
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("installation")).toBe("explicit-venue");
    expect(params.get("room")).toBe("main");
  });

  it("leaves the URL alone when the status fetch fails or is incomplete", async () => {
    const replaceUrl = vi.fn();
    await resolveInstallationParams({
      location: { search: "", pathname: "/display/", hash: "" },
      fetchStatus: async () => null,
      replaceUrl,
    });
    expect(replaceUrl).not.toHaveBeenCalled();

    await resolveInstallationParams({
      location: { search: "", pathname: "/display/", hash: "" },
      fetchStatus: async () => ({ installationId: "venue-a" }),
      replaceUrl,
    });
    expect(replaceUrl).not.toHaveBeenCalled();
  });

  it("preserves the path and hash when rewriting the URL", async () => {
    const replaceUrl = vi.fn();
    await resolveInstallationParams({
      location: { search: "", pathname: "/display/", hash: "#debug" },
      fetchStatus: async () => ({ installationId: "venue-a", roomId: "main" }),
      replaceUrl,
    });
    const url = replaceUrl.mock.calls[0]?.[0] as string;
    expect(url.startsWith("/display/?")).toBe(true);
    expect(url.endsWith("#debug")).toBe(true);
  });
});
