import { afterEach, describe, expect, it, vi } from "vitest";
import type { QrPushMessage } from "./qr.js";
import { QrGrantPushLoop, type QrLifecycle } from "./qr.js";

afterEach(() => vi.useRealTimers());

function setup(overrides: Partial<ConstructorParameters<typeof QrGrantPushLoop>[0]> = {}) {
  let now = 1_000;
  let lifecycle: QrLifecycle = "idle";
  const sent: QrPushMessage[] = [];
  const loop = new QrGrantPushLoop({
    phoneJoinBaseUrl: "https://phone.example/join?installation=one",
    issueGrant: (issuedAt) => ({
      token: `grant-${issuedAt}`,
      claims: { installationId: "inst-1", roomId: "room-1", expiresAt: issuedAt + 120_000 },
    }),
    send: (message) => sent.push(message),
    lifecycle: () => lifecycle,
    hasDisplay: () => true,
    now: () => now,
    ...overrides,
  });
  return {
    loop,
    sent,
    setNow: (value: number) => { now = value; },
    setLifecycle: (value: QrLifecycle) => { lifecycle = value; },
  };
}

describe("QR grant push loop", () => {
  it("issues large idle/lobby grants and corner active grants with a stable parameter-free URL", () => {
    const { loop, sent, setLifecycle } = setup();
    loop.push();
    setLifecycle("lobby");
    loop.push();
    setLifecycle("active");
    loop.push();

    expect(sent.map((message) => message.t === "qr_grant" ? message.placement : message.t)).toEqual([
      "large", "large", "corner",
    ]);
    const url = new URL((sent[0] as Extract<QrPushMessage, { t: "qr_grant" }>).url);
    expect(url.toString()).toBe("https://phone.example/join");
    expect([...url.searchParams]).toEqual([]);
  });

  it.each([
    { allowLateJoin: false },
    { activeQrVisibility: "hidden" as const },
  ])("hides QR during active play when admission is closed (%o)", (policy) => {
    const { loop, sent, setLifecycle } = setup(policy);
    setLifecycle("active");
    loop.push();
    expect(sent).toEqual([{ t: "qr_hidden", v: 2 }]);
  });

  it("rotates every configured interval only while a display is connected", () => {
    vi.useFakeTimers();
    let connected = true;
    const { loop, sent, setNow } = setup({
      rotationMs: 60_000,
      hasDisplay: () => connected,
    });
    loop.start();
    setNow(61_000);
    vi.advanceTimersByTime(60_000);
    expect(sent).toHaveLength(1);
    connected = false;
    vi.advanceTimersByTime(60_000);
    expect(sent).toHaveLength(1);
    loop.stop();
  });
});
