import { watch } from "node:fs";
import { basename, dirname } from "node:path";

/**
 * Calls `onChange` (debounced) whenever `path` is saved. Watches the folder,
 * not the file: editors save atomically (write a temp file, rename it over the
 * old one), and a watcher on the file itself stays attached to the replaced
 * file and never fires again. Returns a function that stops watching.
 */
export function watchFile(path: string, onChange: () => void, debounceMs = 200): () => void {
  const name = basename(path);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watcher = watch(dirname(path), (_event, filename) => {
    // Some platforms omit the name; then any change in the folder counts.
    if (filename !== null && filename.toString() !== name) return;
    clearTimeout(timer);
    timer = setTimeout(onChange, debounceMs);
  });
  return () => { clearTimeout(timer); watcher.close(); };
}
