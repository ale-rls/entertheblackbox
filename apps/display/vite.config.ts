import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // Served by the server under /display/ (registerBundleRoutes); asset and
  // sw URLs must resolve under that mount, not the site root.
  base: "/display/",
  // Baked into the bundle so display_join carries the real build version
  // (plan §7 reload-on-mismatch); falls back to "0.0.0-dev" in App.tsx.
  // REALTIME_WS_URL must be set at build time for any deployed build (e.g.
  // "wss://smartphonocracy-websockets.enabler.space:9002"); falls back to
  // the local apps/realtime-ws-coolify dev port in App.tsx.
  define: {
    __BUILD_VERSION__: JSON.stringify(process.env.BUILD_VERSION ?? "0.0.0-dev"),
    __REALTIME_WS_URL__: JSON.stringify(process.env.REALTIME_WS_URL ?? "ws://localhost:9001"),
    // Baked in so the venue's one kiosk can load bare /display/ with no
    // query params at all -- ?token= in the URL still overrides this
    // when present (e.g. testing against a different token). Unlike
    // installationId/roomId (resolved live from /api/status, so an
    // admin-saved change only needs a restart), this is build-time only:
    // a changed DISPLAY_TOKEN in Coolify needs apps/display rebuilt, not
    // just restarted, to take effect here.
    __DISPLAY_TOKEN__: JSON.stringify(process.env.DISPLAY_TOKEN ?? ""),
  },
  plugins: [react()],
});
