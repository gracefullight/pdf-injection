import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase } from "../src/repositories/jobs.repository";

describe("createDatabase", () => {
  test("creates missing parent directories before opening the sqlite file", () => {
    const root = mkdtempSync(join(tmpdir(), "pdfi-db-"));
    const nested = join(root, "a", "b", "c", "pdf-injection.sqlite");
    try {
      expect(existsSync(join(root, "a"))).toBe(false);
      const db = createDatabase(nested);
      expect(existsSync(nested)).toBe(true);
      db.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("still supports :memory:", () => {
    const db = createDatabase(":memory:");
    expect(db.query("select 1 as one").get()).toEqual({ one: 1 });
    db.close();
  });
});
