import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config";

describe("loadConfig(env) honours the env argument (not process.env)", () => {
  test("numbers and booleans come from the given env only", () => {
    const prevMode = process.env.PDFI_RESEARCH_MODE;
    const prevPages = process.env.PDFI_MAX_PAGES;
    process.env.PDFI_RESEARCH_MODE = "true";
    process.env.PDFI_MAX_PAGES = "7";
    try {
      const cfg = loadConfig({} as NodeJS.ProcessEnv);
      expect(cfg.researchMode).toBe(false);
      expect(cfg.maxPages).not.toBe(7);
      const explicit = loadConfig({
        PDFI_RESEARCH_MODE: "true",
        PDFI_MAX_PAGES: "7",
      } as NodeJS.ProcessEnv);
      expect(explicit.researchMode).toBe(true);
      expect(explicit.maxPages).toBe(7);
    } finally {
      if (prevMode === undefined) delete process.env.PDFI_RESEARCH_MODE;
      else process.env.PDFI_RESEARCH_MODE = prevMode;
      if (prevPages === undefined) delete process.env.PDFI_MAX_PAGES;
      else process.env.PDFI_MAX_PAGES = prevPages;
    }
  });
});
