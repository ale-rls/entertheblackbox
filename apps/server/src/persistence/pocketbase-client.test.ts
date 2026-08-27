import { afterEach, describe, expect, it, vi } from "vitest";
import { pocketBaseRealtimeFetch } from "./pocketbase-client.js";

describe("PocketBase realtime transport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("disables response compression so infinite SSE streams are delivered incrementally", async () => {
    const fetchMock = vi.fn(async (_url: string | URL, _init: RequestInit) => (
      new Response(null, { status: 200 })
    ));
    vi.stubGlobal("fetch", fetchMock);

    await pocketBaseRealtimeFetch("https://pocketbase.example/api/realtime", {
      signal: new AbortController().signal,
      headers: { Accept: "text/event-stream", "X-Test": "preserved" },
      mode: "cors",
      cache: "no-store",
      redirect: "follow",
    });

    const [, request] = fetchMock.mock.calls[0] ?? [];
    const headers = new Headers(request?.headers);
    expect(headers.get("Accept-Encoding")).toBe("identity");
    expect(headers.get("Accept")).toBe("text/event-stream");
    expect(headers.get("X-Test")).toBe("preserved");
  });
});
