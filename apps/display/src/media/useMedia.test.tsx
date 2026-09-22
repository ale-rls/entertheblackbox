// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { MediaSyncStatus } from "./mediaStore.js";

const stores = vi.hoisted(() => [] as { changed: (status: MediaSyncStatus) => void; stop: ReturnType<typeof vi.fn>; cacheName?: string }[]);
vi.mock("./mediaStore.js", () => ({ MediaStore: class {
  readonly entry;
  constructor(options: { onStatus: (status: MediaSyncStatus) => void; cacheName?: string }) {
    this.entry = { changed: options.onStatus, stop: vi.fn(), ...(options.cacheName ? { cacheName: options.cacheName } : {}) }; stores.push(this.entry);
  }
  async sync() { this.entry.changed({ state: "ready" }); return true; }
  stop() { this.entry.stop(); }
  retainOnly() {}
  async getBlobUrl(src: string) { return `blob:${src}`; }
} }));
import { useMedia } from "./useMedia.js";

it("refreshes draft media in a separate cache and ignores callbacks from the replaced store", async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  history.replaceState(null, "", "/display/?rehearsal=00000000-0000-4000-8000-000000000001");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ files: [] }))));
  const container = document.createElement("div"); const root = createRoot(container);
  function Probe({ revision }: { revision: string }) {
    const media = useMedia(undefined, revision);
    useEffect(() => { void media.showMedia("scene.mp4"); }, [media.store]);
    return <span>{media.status.state}:{media.videoUrl}</span>;
  }
  try {
    await act(async () => root.render(<Probe revision="one" />));
    expect(container.textContent).toBe("ready:blob:scene.mp4");
    await act(async () => root.render(<Probe revision="two" />));
    expect(stores[0]!.stop).toHaveBeenCalled();
    expect(stores[1]!.cacheName).toBe("rehearsal-media-00000000-0000-4000-8000-000000000001");
    await act(async () => stores[0]!.changed({ state: "failed", lastError: "old sync stopped" }));
    expect(container.textContent).toBe("ready:blob:scene.mp4");
    expect(fetch).toHaveBeenCalledWith("/api/rehearsals/00000000-0000-4000-8000-000000000001/media-manifest.json", { cache: "no-cache" });
  } finally {
    await act(async () => root.unmount()); history.replaceState(null, "", "/"); vi.unstubAllGlobals();
  }
});
