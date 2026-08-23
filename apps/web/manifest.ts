// Web App Manifest for apps/web (PWA installability).
//
// Single source of truth for everything that makes the app installable:
//   - `manifest`      — the W3C Web App Manifest, typed (no `any`), with
//                       root-relative asset URLs. Icons live in public/icons
//                       and are regenerated from the SVG sources by
//                       scripts/generate-icons.sh.
//   - `webManifest()` — a dependency-free Vite plugin that
//       1. serves `/manifest.webmanifest` from the dev server,
//       2. emits `manifest.webmanifest` into dist/ on `vite build`,
//       3. injects `<link rel="manifest">` + `<meta name="theme-color">`
//          into index.html, so the HTML never hard-codes values that
//          already live in the manifest object.
//     All URLs (start_url, scope, id, icon src, the <link href>) are
//     rewritten against Vite's `base` so a VITE_BASE_PATH deploy keeps
//     working without touching this file.
//
// Intentionally NO service worker: the app is an authoring tool that talks
// to /api on every interaction, and a cache-first worker would pin stale
// bundles across deploys. Modern Chromium/Safari/Edge install from a valid
// manifest + icons alone, which is what this file provides.
//
// Wired up in vite.config.ts (`plugins: [..., webManifest()]`).

import type { Plugin, ResolvedConfig } from "vite";

/** Subset of the W3C Web App Manifest we actually use — kept narrow on purpose. */
export interface WebAppManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: "any" | "maskable" | "monochrome";
}

export interface WebAppManifest {
  id: string;
  name: string;
  short_name: string;
  description: string;
  lang: string;
  dir: "ltr" | "rtl" | "auto";
  start_url: string;
  scope: string;
  display: "standalone" | "minimal-ui" | "fullscreen" | "browser";
  orientation?: "any" | "natural" | "landscape" | "portrait";
  background_color: string;
  theme_color: string;
  categories?: string[];
  icons: WebAppManifestIcon[];
}

/** Public path (relative to `base`) the manifest is served from / emitted to. */
export const MANIFEST_FILE_NAME = "manifest.webmanifest";

/**
 * Deep Ocean Navy (#0f172a) — `--color-foreground` in src/index.css; used for
 * the icon tile, the splash-screen background and the browser UI tint.
 */
const DEEP_OCEAN_NAVY = "#0f172a";

export const manifest: WebAppManifest = {
  id: "/",
  name: "PDF Injection — Hidden Instruction Authoring & Validation",
  short_name: "PDF Injection",
  description:
    "Author PDF-native hidden instructions, validate them against parsers and OCR, and run model-behaviour tests.",
  lang: "en",
  dir: "ltr",
  start_url: "/",
  scope: "/",
  display: "standalone",
  orientation: "any",
  background_color: DEEP_OCEAN_NAVY,
  theme_color: DEEP_OCEAN_NAVY,
  categories: ["productivity", "utilities", "developer tools"],
  icons: [
    { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    {
      src: "/icons/icon-maskable-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ],
};

/** Joins a root-relative URL onto Vite's `base` ("/", "/foo/", …) without doubling slashes. */
export function withBase(base: string, url: string): string {
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  return normalizedBase + url.replace(/^\/+/, "");
}

/** Returns a copy of `source` with every URL field resolved against `base`. */
export function resolveManifest(source: WebAppManifest, base: string): WebAppManifest {
  return {
    ...source,
    id: withBase(base, source.id),
    start_url: withBase(base, source.start_url),
    scope: withBase(base, source.scope),
    icons: source.icons.map((icon) => ({ ...icon, src: withBase(base, icon.src) })),
  };
}

/** Serialises the manifest exactly as it is served/emitted (stable, diff-friendly). */
export function serializeManifest(source: WebAppManifest, base: string): string {
  return `${JSON.stringify(resolveManifest(source, base), null, 2)}\n`;
}

/**
 * Vite plugin: serve (dev) / emit (build) the manifest and inject the
 * `<link rel="manifest">` and `<meta name="theme-color">` tags.
 */
export function webManifest(source: WebAppManifest = manifest): Plugin {
  let config: ResolvedConfig;

  return {
    name: "pdf-injection:web-manifest",

    configResolved(resolved) {
      config = resolved;
    },

    configureServer(server) {
      const route = withBase(server.config.base, MANIFEST_FILE_NAME);
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] !== route) return next();
        res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache");
        res.end(serializeManifest(source, server.config.base));
      });
    },

    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: MANIFEST_FILE_NAME,
        source: serializeManifest(source, config.base),
      });
    },

    transformIndexHtml() {
      return [
        {
          tag: "link",
          attrs: { rel: "manifest", href: withBase(config.base, MANIFEST_FILE_NAME) },
          injectTo: "head",
        },
        {
          tag: "meta",
          attrs: { name: "theme-color", content: source.theme_color },
          injectTo: "head",
        },
      ];
    },
  };
}
