import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * `@pdf-injection/pdf-engine/browser` is what `apps/web`'s local (server-free)
 * mode imports, so its *transitive* module graph must stay free of Node
 * built-ins (`node:fs` in korean-font.ts, `node:module` in native-canvas.ts)
 * and Bun globals (`Bun.CryptoHasher` in pdf-standard-security.ts) — any of
 * them would break the browser bundle (or silently throw at runtime once the
 * bundler stubs them out).
 *
 * This walks the static `import` graph from src/browser.ts and asserts on it,
 * which catches the regression at the exact moment someone adds a re-export or
 * a convenience import to a shared module, rather than at deploy time.
 */

const SRC_DIR = resolve(import.meta.dir, "../src");

function readModule(path: string): string {
  return readFileSync(path, "utf8");
}

/** Static import/export specifiers (`import ... from "x"`, `export * from "x"`). */
function specifiersOf(source: string): string[] {
  const specifiers: string[] = [];
  const re = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*["']([^"']+)["']/g;
  let match = re.exec(source);
  while (match !== null) {
    if (match[1]) specifiers.push(match[1]);
    match = re.exec(source);
  }
  return specifiers;
}

function collectGraph(entry: string): Map<string, string> {
  const modules = new Map<string, string>();
  const queue = [entry];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current || modules.has(current)) continue;
    const source = readModule(current);
    modules.set(current, source);

    for (const specifier of specifiersOf(source)) {
      if (!specifier.startsWith(".")) continue;
      const resolved = join(dirname(current), `${specifier}.ts`);
      if (!modules.has(resolved)) queue.push(resolved);
    }
  }

  return modules;
}

describe("browser entry purity", () => {
  const graph = collectGraph(join(SRC_DIR, "browser.ts"));

  test("reaches the injection dispatcher (guards against an empty/trivial graph)", () => {
    expect(graph.size).toBeGreaterThan(10);
    expect([...graph.keys()].some((path) => path.endsWith("inject-core.ts"))).toBe(true);
    expect([...graph.keys()].some((path) => path.endsWith("inject-white-text.ts"))).toBe(true);
  });

  test("no module in the graph imports a Node built-in", () => {
    const offenders: string[] = [];
    for (const [path, source] of graph) {
      for (const specifier of specifiersOf(source)) {
        if (specifier.startsWith("node:")) offenders.push(`${path} -> ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("no module in the graph uses a Bun global", () => {
    const offenders: string[] = [];
    for (const [path, source] of graph) {
      // Ignore prose in comments; only flag real member access like `Bun.file(`.
      const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      if (/\bBun\.\w/.test(withoutComments)) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });

  test("the Node-only modules are excluded by name", () => {
    // The *injectors* for image_only and unicode_tags are in the graph — they
    // are runtime-agnostic. What must stay out are the modules that reach the
    // filesystem/native addon to feed them: the on-disk font loader, the napi
    // canvas resolver, their Node bindings, and the Bun-hashing helper.
    const names = [...graph.keys()].map((path) => path.split("/").pop());
    expect(names).not.toContain("korean-font.ts");
    expect(names).not.toContain("native-canvas.ts");
    expect(names).not.toContain("inject-image-only-node.ts");
    expect(names).not.toContain("inject-unicode-tags-node.ts");
    expect(names).not.toContain("pdf-standard-security.ts");
    expect(names).not.toContain("inject.ts");
  });

  test("the browser graph does carry the runtime-agnostic injectors", () => {
    const names = [...graph.keys()].map((path) => path.split("/").pop());
    expect(names).toContain("inject-image-only.ts");
    expect(names).toContain("inject-unicode-tags.ts");
    expect(names).toContain("hb-subset.ts");
    expect(names).toContain("browser-cjk-font.ts");
  });

  test("the package root barrel, by contrast, does pull in Node-only modules", () => {
    // Sanity check that the assertions above are meaningful rather than
    // vacuously true because the walker missed re-exports.
    const rootNames = [...collectGraph(join(SRC_DIR, "index.ts")).keys()].map((p) =>
      p.split("/").pop(),
    );
    expect(rootNames).toContain("korean-font.ts");
  });
});
