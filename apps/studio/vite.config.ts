import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { localMediaManifestPlugin } from "./local-media.js";

const mediaDirectory = process.env.SMARTPHONECRACY_STUDIO_MEDIA_DIR
  ?? fileURLToPath(new URL("../../content/media", import.meta.url));

export default defineConfig({ plugins: [react(), localMediaManifestPlugin(mediaDirectory)] });
