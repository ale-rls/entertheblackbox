// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DisplayToServerMessage } from "@smartphonecracy/protocol";
import { useVideoPlaybackDiagnostics } from "./useVideoPlaybackDiagnostics.js";

let root: Root | null = null;

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function Harness({ send }: { send: (message: DisplayToServerMessage) => void }) {
  const diagnostics = useVideoPlaybackDiagnostics({
    sessionId: "session-1",
    phaseId: "intro",
    phaseEpoch: 4,
    mediaId: "media/intro.mp4",
    videoUrl: "blob:cached-intro",
    send,
  });
  return <video ref={diagnostics.ref} onPlaying={diagnostics.onPlaying} onStalled={diagnostics.onStalled} onError={diagnostics.onError} />;
}

async function render(send: (message: DisplayToServerMessage) => void) {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.querySelector("#root")!);
  await act(async () => {
    root?.render(<Harness send={send} />);
    await Promise.resolve();
  });
  return document.querySelector("video")!;
}

describe("useVideoPlaybackDiagnostics", () => {
  it("reports a rejected autoplay attempt with the current phase identity", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(new DOMException("User gesture required", "NotAllowedError"));
    const send = vi.fn();

    await render(send);

    expect(send).toHaveBeenCalledWith({
      t: "display_playback_status",
      v: 2,
      sessionId: "session-1",
      phaseId: "intro",
      phaseEpoch: 4,
      mediaId: "media/intro.mp4",
      status: "autoplay-blocked",
      detail: "NotAllowedError: User gesture required",
    });
  });

  it("reports stalls and media errors, then clears the issue when playback resumes", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const send = vi.fn();
    const video = await render(send);

    video.dispatchEvent(new Event("stalled"));
    video.dispatchEvent(new Event("error"));
    video.dispatchEvent(new Event("playing"));

    expect(send.mock.calls.map(([message]) => message.status)).toEqual(["stalled", "error", "playing"]);
  });
});
