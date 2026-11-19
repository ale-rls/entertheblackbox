import { describe, expect, it } from "vitest";
import { createScreenWakeLock } from "./screen-wake-lock.js";

function harness() {
  const listeners = new Set<() => void>();
  const locks: Array<{ released: boolean; release: () => Promise<void> }> = [];
  let refuse = false;
  const doc = {
    visibilityState: "visible" as DocumentVisibilityState,
    addEventListener: (_type: string, listener: () => void) => { listeners.add(listener); },
    removeEventListener: (_type: string, listener: () => void) => { listeners.delete(listener); },
  };
  const nav = {
    wakeLock: {
      request: async () => {
        if (refuse) throw new Error("NotAllowedError");
        const lock = { released: false, release: async () => { lock.released = true; } };
        locks.push(lock);
        return lock as unknown as WakeLockSentinel;
      },
    },
  };
  const setVisible = async (visible: boolean) => {
    doc.visibilityState = visible ? "visible" : "hidden";
    // Browsers release a screen lock when the page is hidden.
    if (!visible) for (const lock of locks) lock.released = true;
    for (const listener of listeners) listener();
    await Promise.resolve();
  };
  return { nav, doc: doc as unknown as Document, locks, listeners, setVisible, refuse: () => { refuse = true; } };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("screen wake lock", () => {
  it("holds the screen on while a show runs and lets go when it ends", async () => {
    const h = harness();
    const lock = createScreenWakeLock(h.nav, h.doc);
    lock.setActive(false);
    await flush();
    expect(h.locks).toHaveLength(0);

    lock.setActive(true);
    await flush();
    expect(h.locks).toHaveLength(1);
    lock.setActive(true);
    await flush();
    expect(h.locks).toHaveLength(1);

    lock.setActive(false);
    await flush();
    expect(h.locks[0]!.released).toBe(true);
    lock.dispose();
    expect(h.listeners.size).toBe(0);
  });

  it("asks again when the page comes back after being hidden", async () => {
    const h = harness();
    const lock = createScreenWakeLock(h.nav, h.doc);
    lock.setActive(true);
    await flush();
    await h.setVisible(false);
    await flush();
    expect(h.locks).toHaveLength(1);
    await h.setVisible(true);
    await flush();
    expect(h.locks).toHaveLength(2);
    expect(h.locks[1]!.released).toBe(false);
    lock.dispose();
  });

  it("does nothing on browsers without the API, and survives a refusal", async () => {
    const h = harness();
    const none = createScreenWakeLock({}, h.doc);
    expect(() => none.setActive(true)).not.toThrow();
    none.dispose();

    h.refuse();
    const refused = createScreenWakeLock(h.nav, h.doc);
    refused.setActive(true);
    await flush();
    expect(h.locks).toHaveLength(0);
    refused.dispose();
  });
});
