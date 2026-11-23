import { describe, expect, it } from "vitest";
import { applyDisplayFit, intrinsicFrameSize, mediaPixelSize, parseDisplayFit, trackIntrinsicSize } from "./displayFit.js";

describe("display fit", () => {
  it("defaults to the letterboxed 16:9 frame", () => {
    expect(parseDisplayFit("")).toBe("contain");
    expect(parseDisplayFit("?fit=stretch")).toBe("contain");
  });

  it("accepts each supported mode", () => {
    for (const fit of ["contain", "height", "width", "intrinsic"]) expect(parseDisplayFit(`?group=a&fit=${fit}`)).toBe(fit);
  });

  it("marks the document root for the stylesheet", () => {
    const root = { dataset: {} as DOMStringMap };
    applyDisplayFit(root, "?fit=height");
    expect(root.dataset.fit).toBe("height");
  });

  it("maps media pixels 1:1 onto device pixels", () => {
    expect(intrinsicFrameSize(1920, 1200, 1)).toEqual({ width: "1920px", height: "1200px" });
    expect(intrinsicFrameSize(1920, 1200, 2)).toEqual({ width: "960px", height: "600px" });
    expect(intrinsicFrameSize(1280, 704, 0)).toEqual({ width: "1280px", height: "704px" });
  });

  it("reads the native size of videos and stills only", () => {
    expect(mediaPixelSize({ tagName: "VIDEO", videoWidth: 1920, videoHeight: 1200 } as never)).toEqual({ width: 1920, height: 1200 });
    expect(mediaPixelSize({ tagName: "IMG", naturalWidth: 800, naturalHeight: 600 } as never)).toEqual({ width: 800, height: 600 });
    expect(mediaPixelSize({ tagName: "VIDEO", videoWidth: 0, videoHeight: 0 } as never)).toBeNull();
    expect(mediaPixelSize({ tagName: "AUDIO" } as never)).toBeNull();
  });

  it("sizes the frame to media playing in the video layer and ignores media elsewhere", () => {
    const listeners: Record<string, (event: Event) => void> = {};
    const doc = { addEventListener: (type: string, fn: (event: Event) => void) => { listeners[type] = fn; }, removeEventListener: (type: string) => { delete listeners[type]; } };
    const vars: Record<string, string> = {};
    const root = { style: { setProperty: (name: string, value: string) => { vars[name] = value; } } };
    const stop = trackIntrinsicSize(doc as never, root as never, () => 1);
    expect(vars).toEqual({ "--intrinsic-width": "1920px", "--intrinsic-height": "1080px" });
    const media = (inLayer: boolean, extra: object) => ({ target: { closest: () => (inLayer ? {} : null), ...extra } }) as unknown as Event;
    listeners.playing!(media(true, { tagName: "VIDEO", videoWidth: 1920, videoHeight: 1200 }));
    expect(vars).toEqual({ "--intrinsic-width": "1920px", "--intrinsic-height": "1200px" });
    listeners.playing!(media(false, { tagName: "VIDEO", videoWidth: 640, videoHeight: 480 }));
    listeners.load!(media(true, { tagName: "IMG", naturalWidth: 1280, naturalHeight: 720 }));
    expect(vars).toEqual({ "--intrinsic-width": "1280px", "--intrinsic-height": "720px" });
    stop(); expect(listeners).toEqual({});
  });
});
