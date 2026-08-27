import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/studio/",
  define: {
    // Coolify supplies VITE_POCKETBASE_URL; local builds may source the
    // server's POCKETBASE_URL. Only the public base URL is embedded.
    __POCKETBASE_URL__: JSON.stringify(
      process.env.VITE_POCKETBASE_URL ?? process.env.POCKETBASE_URL ?? "http://127.0.0.1:8090",
    ),
  },
  plugins: [react()],
});
