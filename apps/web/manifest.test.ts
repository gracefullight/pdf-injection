import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import type { HtmlTagDescriptor, ResolvedConfig, ViteDevServer } from "vite";
import {
  MANIFEST_FILE_NAME,
  manifest,
  resolveManifest,
  serializeManifest,
  webManifest,
  withBase,
} from "./manifest";

// Guards the PWA installability contract of apps/web:
//   - the manifest has every field Chromium/Safari require to offer "Install",
//   - every icon it points at really exists under public/ (a renamed or
//     un-regenerated icon would silently break install prompts),
//   - the Vite plugin resolves URLs against `base` and injects the <link>.

const PUBLIC_DIR = fileURLToPath(new URL("./public/", import.meta.url));

describe("apps/web manifest.ts — web app manifest", () => {
  test("has the fields required for an installable PWA", () => {
    expect(manifest.name.length).toBeGreaterThan(0);
    expect(manifest.short_name.length).toBeGreaterThan(0);
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  test("ships 192px + 512px any-purpose icons and a 512px maskable icon", () => {
    const png = manifest.icons.filter((i) => i.type === "image/png");
    const sizesOf = (purpose: string) =>
      png.filter((i) => i.purpose === purpose).map((i) => i.sizes);
    expect(sizesOf("any")).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(sizesOf("maskable")).toContain("512x512");
  });

  test("every icon referenced by the manifest exists under public/", () => {
    for (const icon of manifest.icons) {
      const onDisk = new URL(icon.src.replace(/^\//, ""), `file://${PUBLIC_DIR}`);
      expect(existsSync(onDisk)).toBe(true);
    }
  });

  test("favicon + apple-touch-icon referenced by index.html exist under public/", () => {
    expect(existsSync(`${PUBLIC_DIR}favicon.ico`)).toBe(true);
    expect(existsSync(`${PUBLIC_DIR}icons/apple-touch-icon.png`)).toBe(true);
    expect(existsSync(`${PUBLIC_DIR}icons/icon.svg`)).toBe(true);
  });
});

describe("apps/web manifest.ts — base path resolution", () => {
  test("withBase joins without doubling or dropping slashes", () => {
    expect(withBase("/", "/icons/a.png")).toBe("/icons/a.png");
    expect(withBase("/app/", "/icons/a.png")).toBe("/app/icons/a.png");
    expect(withBase("/app", "icons/a.png")).toBe("/app/icons/a.png");
  });

  test("resolveManifest rewrites id/start_url/scope/icons against base", () => {
    const resolved = resolveManifest(manifest, "/pdfi/");
    expect(resolved.id).toBe("/pdfi/");
    expect(resolved.start_url).toBe("/pdfi/");
    expect(resolved.scope).toBe("/pdfi/");
    for (const icon of resolved.icons) expect(icon.src.startsWith("/pdfi/icons/")).toBe(true);
    // source object is not mutated
    expect(manifest.start_url).toBe("/");
  });

  test("serializeManifest emits valid, newline-terminated JSON", () => {
    const text = serializeManifest(manifest, "/");
    expect(text.endsWith("\n")).toBe(true);
    expect(JSON.parse(text).start_url).toBe("/");
  });
});

describe("apps/web manifest.ts — webManifest() Vite plugin", () => {
  function pluginWithBase(base: string) {
    const plugin = webManifest();
    const configResolved = plugin.configResolved;
    if (typeof configResolved !== "function") throw new Error("configResolved hook missing");
    configResolved.call({} as never, { base } as ResolvedConfig);
    return plugin;
  }

  test("injects <link rel=manifest> and <meta theme-color> honouring base", () => {
    const plugin = pluginWithBase("/app/");
    const hook = plugin.transformIndexHtml;
    if (typeof hook !== "function") throw new Error("transformIndexHtml hook missing");
    const tags = hook.call({} as never, "<html></html>", {} as never) as HtmlTagDescriptor[];

    const link = tags.find((t) => t.tag === "link");
    const meta = tags.find((t) => t.tag === "meta");
    expect(link?.attrs).toEqual({ rel: "manifest", href: `/app/${MANIFEST_FILE_NAME}` });
    expect(meta?.attrs).toEqual({ name: "theme-color", content: manifest.theme_color });
  });

  test("dev middleware serves the manifest with the manifest+json content type", async () => {
    const plugin = webManifest();
    const configureServer = plugin.configureServer;
    if (typeof configureServer !== "function") throw new Error("configureServer hook missing");

    let handler:
      | ((req: IncomingMessage, res: ServerResponse, next: () => void) => void)
      | undefined;
    const fakeServer = {
      config: { base: "/" },
      middlewares: {
        use(fn: typeof handler) {
          handler = fn;
        },
      },
    } as unknown as ViteDevServer;
    await configureServer.call({} as never, fakeServer);
    if (!handler) throw new Error("middleware not registered");

    const headers: Record<string, string> = {};
    let body = "";
    const res = {
      setHeader(k: string, v: string) {
        headers[k] = v;
      },
      end(chunk: string) {
        body = chunk;
      },
    } as unknown as ServerResponse;

    let nextCalled = false;
    handler({ url: `/${MANIFEST_FILE_NAME}?v=1` } as IncomingMessage, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(false);
    expect(headers["Content-Type"]).toContain("application/manifest+json");
    expect(JSON.parse(body).short_name).toBe(manifest.short_name);

    // unrelated requests fall through
    handler({ url: "/index.html" } as IncomingMessage, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
  });
});
