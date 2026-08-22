import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExpectedSignal, InjectionMode, PayloadLanguage } from "@pdf-injection/contracts";
import { type AppConfig, loadConfig } from "../src/config";
import { createApp } from "../src/index";

const FIXTURES_DIR = join(import.meta.dir, "..", "..", "..", "tests", "fixtures");

export function fixturePath(name: string): string {
  return join(FIXTURES_DIR, name);
}

export async function fixtureFile(name: string, mimeType = "application/pdf"): Promise<File> {
  const bytes = await Bun.file(fixturePath(name)).arrayBuffer();
  return new File([bytes], name, { type: mimeType });
}

let counter = 0;

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const dir = mkdtempSync(join(tmpdir(), `pdf-injection-api-test-${Date.now()}-${counter++}-`));
  const base = loadConfig({} as NodeJS.ProcessEnv);
  return {
    ...base,
    storageDir: join(dir, "data"),
    dbPath: join(dir, "test.sqlite"),
    sweepIntervalMs: 24 * 60 * 60 * 1000, // effectively disabled; tests call sweepExpiredJobs() directly
    ...overrides,
  };
}

export function testApp(overrides: Partial<AppConfig> = {}) {
  const config = testConfig(overrides);
  const app = createApp(config);
  return { app, config };
}

export interface CreateJobFormOptions {
  file: File;
  instruction: string;
  expectedSignals: ExpectedSignal[];
  injectionMode: InjectionMode;
  targetPage?: string;
  position?: string;
  x?: string;
  y?: string;
  fontSize?: string;
  maxWidth?: string;
  acknowledgedWarnings?: string[];
  payloadLanguage?: PayloadLanguage;
}

export function buildCreateJobRequest(opts: CreateJobFormOptions): Request {
  const form = new FormData();
  form.set("file", opts.file);
  form.set("instruction", opts.instruction);
  form.set("expectedSignals", JSON.stringify(opts.expectedSignals));
  form.set("injectionMode", opts.injectionMode);
  if (opts.targetPage !== undefined) form.set("targetPage", opts.targetPage);
  if (opts.position !== undefined) form.set("position", opts.position);
  if (opts.x !== undefined) form.set("x", opts.x);
  if (opts.y !== undefined) form.set("y", opts.y);
  if (opts.fontSize !== undefined) form.set("fontSize", opts.fontSize);
  if (opts.maxWidth !== undefined) form.set("maxWidth", opts.maxWidth);
  if (opts.acknowledgedWarnings !== undefined) {
    form.set("acknowledgedWarnings", JSON.stringify(opts.acknowledgedWarnings));
  }
  if (opts.payloadLanguage !== undefined) form.set("payloadLanguage", opts.payloadLanguage);
  return new Request("http://localhost/api/v1/jobs", { method: "POST", body: form });
}

export const DEFAULT_SIGNALS: ExpectedSignal[] = [
  { type: "exact_phrase", value: "Method A", caseSensitive: false },
];
