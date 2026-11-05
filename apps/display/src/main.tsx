import { monitorIdSchema } from "@entertheblackbox/scenario";
import { createRoot } from "react-dom/client";
import { resolveInstallationFromWindow } from "./lib/resolveInstallation.js";
import "./style.css";

async function bootstrap(): Promise<void> {
  // App.js is imported dynamically, after this resolves, so its
  // module-level config sees the resolved installation/room -- see
  // resolveInstallation.ts.
  await resolveInstallationFromWindow();


  // App-shell-only service worker (plan §9); media stays app-controlled.
  if ("serviceWorker" in navigator) {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // Non-fatal: the shell still runs without offline support.
    });
  }

  const root = createRoot(document.getElementById("root")!);
  const requestedMonitor = new URLSearchParams(location.search).get("monitor");
  if (requestedMonitor !== null) {
    const parsed = monitorIdSchema.safeParse(requestedMonitor);
    if (!parsed.success) { root.render(<main>Unknown monitor. Choose M1, M2, M3 or M4.</main>); return; }
    const { MonitorApp } = await import("./monitors/MonitorApp.js");
    root.render(<MonitorApp monitorId={parsed.data} />);
  } else {
    const { App } = await import("./App.js");
    root.render(<App />);
  }
}

void bootstrap();
