import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    emptyOutDir: true,
    outDir: "dist-proof",
    rollupOptions: {
      input: fileURLToPath(new URL("./proof.html", import.meta.url)),
    },
  },
});
