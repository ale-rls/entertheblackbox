import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const REPO_ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
