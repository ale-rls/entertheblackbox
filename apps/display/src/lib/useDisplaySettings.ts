import { useEffect, useState } from "react";
import { DEFAULT_DISPLAY_SETTINGS, displaySettingsSchema, type DisplaySettings } from "@entertheblackbox/protocol";

/** Keep last-good copy through outages; polling never changes the show connection. */
export function useDisplaySettings(): DisplaySettings {
  const [settings, setSettings] = useState<DisplaySettings>(DEFAULT_DISPLAY_SETTINGS);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let abort: AbortController;
    const load = async () => {
      abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), 4000);
      try {
        const response = await fetch("/api/display-settings", { cache: "no-store", signal: abort.signal });
        if (!response.ok) return;
        const parsed = displaySettingsSchema.safeParse(await response.json());
        if (parsed.success && !stopped) setSettings((previous) => JSON.stringify(previous) === JSON.stringify(parsed.data) ? previous : parsed.data);
      } catch { /* Keep defaults or last successful settings while offline. */ }
      finally { clearTimeout(timeout); if (!stopped) timer = setTimeout(() => void load(), 5000); }
    };
    void load();
    return () => { stopped = true; clearTimeout(timer); abort?.abort(); };
  }, []);
  return settings;
}
