import { createRoot } from "react-dom/client";
import { resolveInstallationParamsFromWindow } from "./lib/resolveInstallation.js";
import "./style.css";

async function bootstrap(): Promise<void> {
  // App.js is imported dynamically, after this resolves, so its
  // module-level config reads location.search only once it may already
  // carry the resolved installation/room -- see resolveInstallation.ts.
  await resolveInstallationParamsFromWindow();
  const { App } = await import("./App.js");

  // App-shell-only service worker (plan §9); media stays app-controlled.
  if ("serviceWorker" in navigator) {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // Non-fatal: the shell still runs without offline support.
    });
  }

  createRoot(document.getElementById("root")!).render(<App />);
}

void bootstrap();
