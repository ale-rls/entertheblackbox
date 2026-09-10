import { MEDIA_BUDGET_BYTES } from "@entertheblackbox/shared";
import type { MediaManifest } from "./schema.js";

/**
 * Media manifest validation (plan §5): verify each file's declared byte
 * size against the actual file and enforce the 2 GiB total budget.
 *
 * File access is injected so tests and non-Node environments can supply
 * their own stat function; `statSizeWithNodeFs` is the production default.
 */

export type MediaIssue = {
  severity: "error";
  code: "file-missing" | "size-mismatch" | "budget-exceeded";
  src?: string;
  message: string;
};

export type StatSize = (src: string) => Promise<number>;

export async function validateMediaManifest(
  manifest: MediaManifest,
  statSize: StatSize,
): Promise<{ ok: boolean; errors: MediaIssue[]; totalBytes: number }> {
  const errors: MediaIssue[] = [];
  let totalBytes = 0;

  for (const file of manifest.files) {
    totalBytes += file.bytes;
    let actual: number;
    try {
      actual = await statSize(file.src);
    } catch {
      errors.push({
        severity: "error",
        code: "file-missing",
        src: file.src,
        message: `media file "${file.src}" cannot be read`,
      });
      continue;
    }
    if (actual !== file.bytes) {
      errors.push({
        severity: "error",
        code: "size-mismatch",
        src: file.src,
        message: `media file "${file.src}" declares ${file.bytes} bytes but is ${actual} bytes`,
      });
    }
  }

  if (totalBytes > MEDIA_BUDGET_BYTES) {
    errors.push({
      severity: "error",
      code: "budget-exceeded",
      message: `manifest totals ${totalBytes} bytes, over the ${MEDIA_BUDGET_BYTES} byte (2 GiB) v1 budget`,
    });
  }

  return { ok: errors.length === 0, errors, totalBytes };
}

/** Production stat function: resolves manifest src paths against a base directory. */
export function statSizeWithNodeFs(baseDir: string): StatSize {
  return async (src) => {
    const { stat } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const s = await stat(join(baseDir, src));
    return s.size;
  };
}
