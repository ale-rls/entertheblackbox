import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { StatSize } from "./media.js";

/** Production stat function: resolves manifest src paths against a base directory. */
export function statSizeWithNodeFs(baseDir: string): StatSize {
  return async (src) => {
    const file = await stat(join(baseDir, src));
    return file.size;
  };
}
