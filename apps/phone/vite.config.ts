import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // Served by the server under /phone/ (registerBundleRoutes).
  base: "/phone/",
  // Baked into the bundle so join carries the real build version
  // (plan §7 reload-on-mismatch); falls back to "0.0.0-dev" in App.tsx.
  // REALTIME_WS_URL must be set at build time for any deployed build (e.g.
  // "wss://smartphonocracy-websockets.enabler.space:9002"); falls back to
  // the local apps/realtime-ws dev port in App.tsx.
  define: {
    __BUILD_VERSION__: JSON.stringify(process.env.BUILD_VERSION ?? "0.0.0-dev"),
    __REALTIME_WS_URL__: JSON.stringify(process.env.REALTIME_WS_URL ?? "ws://localhost:9001"),
  },
  plugins: [react()],
});
