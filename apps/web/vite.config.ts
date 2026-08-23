import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { webManifest } from "./manifest";

// PDF Injection web (apps/web). Dev-server-only config — this project never runs
// `vite build` per CLAUDE.md's "never build until the user explicitly asks" rule.
export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? "/",
  // webManifest(): PWA manifest (serve in dev / emit in build / inject <link rel="manifest">) — see manifest.ts
  plugins: [react(), tailwindcss(), webManifest()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY_TARGET ?? "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    exclude: ["pdfjs-dist"],
  },
});
