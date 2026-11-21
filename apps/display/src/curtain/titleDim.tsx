import { useEffect, useRef } from "react";
import { CURTAIN_DEFAULTS } from "@entertheblackbox/shared";
import { CURVE_TOP, DIM_START_BAKED, easeLevel } from "./visibility.js";

/**
 * A title over a background loop dims that loop to the lit curtain's level
 * during a vote, so the title reads as well as a vote question does.
 */
export const TITLE_DIM_BAKED = CURTAIN_DEFAULTS.baked;
export const TITLE_DIM_FILTER_ID = "title-dim";
const TABLE_SIZE = 64;

/**
 * What a pixel of the plain curtain video looks like when the lit curtain
 * draws it at `baked`. The plain video matches the lit curtain at
 * DIM_START_BAKED, so its pixel `v` is that render of some base brightness;
 * this draws the same base at `baked` with the shader's curve
 * (curtainRenderer.ts: c = base * baked, c = (1 - exp(-1.15 c)) * 0.9,
 * shown = c^(1/2.2)). At DIM_START_BAKED it returns `v` unchanged.
 */
export function dimmedPixel(v: number, baked: number): number {
  const k = baked / DIM_START_BAKED;
  const at = (x: number) => {
    const c = Math.max(x, 0) ** 2.2 / 0.9;
    return (0.9 * (1 - (1 - c) ** k)) ** (1 / 2.2);
  };
  // Whiter than the curve can reach: scale with the top of the curve.
  return v > CURVE_TOP ? at(CURVE_TOP) * (v / CURVE_TOP) : at(v);
}

/** The filter's lookup table for `baked`, from black to white. */
export function titleDimTable(baked: number): number[] {
  return Array.from({ length: TABLE_SIZE }, (_, i) => dimmedPixel(i / (TABLE_SIZE - 1), baked));
}

/**
 * Dims `layer` with the lit curtain's curve while `active`, easing over the
 * same second the lit curtain dims in, and back up when it ends. `levelRef`
 * holds the current level (DIM_START_BAKED: not dimmed) so a vote that
 * follows can start where the title left off. The filter is off entirely
 * whenever the layer is not dimmed.
 */
export function useTitleDim(active: boolean) {
  const layerRef = useRef<HTMLElement | null>(null);
  const funcRefs = useRef<(SVGFEFuncRElement | SVGFEFuncGElement | SVGFEFuncBElement | null)[]>([]);
  const levelRef = useRef(DIM_START_BAKED);

  useEffect(() => {
    const from = levelRef.current;
    const to = active ? TITLE_DIM_BAKED : DIM_START_BAKED;
    if (from === to) return;
    const startedAt = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const level = easeLevel(from, to, now - startedAt);
      levelRef.current = level;
      const layer = layerRef.current;
      if (level >= DIM_START_BAKED) {
        if (layer !== null) layer.style.filter = "";
      } else {
        const table = titleDimTable(level).map((value) => value.toFixed(4)).join(" ");
        for (const func of funcRefs.current) func?.setAttribute("tableValues", table);
        if (layer !== null) layer.style.filter = `url(#${TITLE_DIM_FILTER_ID})`;
      }
      if (level !== to) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  const filter = (
    <svg aria-hidden="true" width="0" height="0" style={{ position: "absolute" }}>
      <filter id={TITLE_DIM_FILTER_ID} colorInterpolationFilters="sRGB">
        <feComponentTransfer>
          <feFuncR type="table" ref={(el) => { funcRefs.current[0] = el; }} />
          <feFuncG type="table" ref={(el) => { funcRefs.current[1] = el; }} />
          <feFuncB type="table" ref={(el) => { funcRefs.current[2] = el; }} />
        </feComponentTransfer>
      </filter>
    </svg>
  );
  return { layerRef, levelRef, filter };
}
