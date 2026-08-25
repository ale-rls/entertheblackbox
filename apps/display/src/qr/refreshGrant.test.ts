import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROTOCOL_VERSION, type DisplayToServerMessage } from "@smartphonecracy/protocol";
import { startQrGrantRefresh } from "./refreshGrant.js";

describe("startQrGrantRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends qr_grant_request every 60s while the socket is open", () => {
    const sent: DisplayToServerMessage[] = [];
    let open = true;

    startQrGrantRefresh({
      isOpen: () => open,
      send: (m) => sent.push(m),
    });

    vi.advanceTimersByTime(60_000);
    expect(sent).toEqual([{ t: "qr_grant_request", v: PROTOCOL_VERSION }]);

    vi.advanceTimersByTime(60_000);
    expect(sent).toHaveLength(2);

    // Not open: the tick is skipped entirely (no request over a dead socket).
    open = false;
    vi.advanceTimersByTime(60_000);
    expect(sent).toHaveLength(2);
  });

  it("stops sending once disposed", () => {
    const sent: DisplayToServerMessage[] = [];
    const dispose = startQrGrantRefresh({
      isOpen: () => true,
      send: (m) => sent.push(m),
    });

    vi.advanceTimersByTime(60_000);
    expect(sent).toHaveLength(1);

    dispose();
    vi.advanceTimersByTime(180_000);
    expect(sent).toHaveLength(1);
  });

  it("honors a custom interval, comfortably under the 2-minute grant TTL", () => {
    const sent: DisplayToServerMessage[] = [];
    startQrGrantRefresh({
      isOpen: () => true,
      send: (m) => sent.push(m),
      intervalMs: 30_000,
    });

    vi.advanceTimersByTime(90_000);
    expect(sent).toHaveLength(3);
  });
});
