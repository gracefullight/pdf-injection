import fs from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the PDF Injection E2E suite (PRD §22.4 + §29 DoD).
 *
 * Both `webServer` entries start the project's normal *dev* servers — never a
 * build. `apps/api` runs on a scratch storage dir / sqlite file under
 * `tests/e2e/.tmp/` so the E2E run never touches the repo's default
 * `.pdf-injection-data`, and every job/artifact created during the run is
 * disposable (cleaned up by the spec's own DELETE assertions + git-ignored
 * `.tmp/`).
 */
const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const tmpDir = path.resolve(import.meta.dirname, ".tmp");
const apiStorageDir = path.join(tmpDir, "storage");
const apiDbPath = path.join(tmpDir, "pdf-injection.sqlite");

// bun:sqlite (unlike Bun.write for the artifact storage dir) does not create
// its parent directory on demand — pre-create both scratch dirs before the
// webServer command spawns apps/api, or `new Database(dbPath)` throws
// SQLITE_CANTOPEN on a clean checkout / after `.tmp/` is wiped between runs.
fs.mkdirSync(apiStorageDir, { recursive: true });

const API_PORT = 3001;
const WEB_PORT = 5173;

export default defineConfig({
  testDir: "./tests",
  // Deliberately not "*.spec.ts" / "*.test.ts" would also work for Playwright's
  // own discovery, but we keep the conventional "*.spec.ts" name here — bun:test
  // is told to skip this whole directory via `bunfig.toml`'s
  // `test.pathIgnorePatterns = ["tests/e2e/**"]`, so `bun test` at the repo root
  // never attempts to load a Playwright spec (which would fail: no `bun:test`
  // globals, and `@playwright/test` isn't a `bun:test` dependency).
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "test-results",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "bun run --cwd apps/api dev",
      cwd: repoRoot,
      url: `http://localhost:${API_PORT}/api/v1/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        PDFI_PORT: String(API_PORT),
        PDFI_STORAGE_DIR: apiStorageDir,
        PDFI_DB_PATH: apiDbPath,
        PDFI_CORS_ORIGIN: `http://localhost:${WEB_PORT}`,
        // Round-2 (r9): Phase 4/5 specs (submissions, robustness, model-test) need
        // the research-mode-gated tabs enabled. PDFI_ALLOW_EXTERNAL_PROVIDERS is
        // deliberately left unset — every spec here uses the "mock" provider only,
        // so external-provider gating (403/422) stays exercised via apps/api's own
        // integration tests, not this E2E suite.
        PDFI_RESEARCH_MODE: "true",
      },
    },
    {
      command: `bun run --cwd apps/web dev -- --port ${WEB_PORT} --strictPort`,
      cwd: repoRoot,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        VITE_API_PROXY_TARGET: `http://localhost:${API_PORT}`,
      },
    },
  ],
});
