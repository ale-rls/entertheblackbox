import { useLayoutEffect, useRef } from "react";

type Props = {
  title: string;
  layout: "centered-xl" | undefined;
};

/** Keeps the centered treatment on one line while preserving its horizontal safe area. */
export function VideoTitle({ title, layout }: Props) {
  const titleRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const element = titleRef.current;
    if (element === null || layout !== "centered-xl") return;

    let cancelled = false;
    const fit = () => {
      if (cancelled) return;
      element.style.removeProperty("font-size");
      const availableWidth = element.clientWidth;
      const naturalWidth = element.scrollWidth;
      if (availableWidth === 0 || naturalWidth <= availableWidth) return;
      const preferredSize = Number.parseFloat(getComputedStyle(element).fontSize);
      if (Number.isFinite(preferredSize)) {
        element.style.fontSize = `${preferredSize * availableWidth / naturalWidth}px`;
      }
    };

    fit();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    observer?.observe(element);
    void document.fonts?.ready.then(fit);

    return () => {
      cancelled = true;
      observer?.disconnect();
      element.style.removeProperty("font-size");
    };
  }, [layout, title]);

  return <div ref={titleRef} className={`video-title${layout === "centered-xl" ? " video-title-centered-xl" : ""}`}>{title}</div>;
}
