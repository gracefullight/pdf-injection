import { describe, expect, test } from "bun:test";
import { qpdfCheck } from "../src/qpdf";

describe("qpdfCheck", () => {
  test("returns not_run when PS_QPDF_ENABLED is not 'true'", async () => {
    const result = await qpdfCheck({ filePath: "/tmp/does-not-matter.pdf", enabled: false });
    expect(result.status).toBe("not_run");
    expect(result.exitCode).toBeNull();
    expect(result.warningCount).toBe(0);
    expect(result.errorCount).toBe(0);
  });

  test("returns not_run when enabled but the qpdf binary is not found", async () => {
    const result = await qpdfCheck({
      filePath: "/tmp/does-not-matter.pdf",
      enabled: true,
      which: () => null,
    });
    expect(result.status).toBe("not_run");
  });

  test("never throws even if the file path does not exist", async () => {
    await expect(
      qpdfCheck({ filePath: "/tmp/definitely-does-not-exist-xyz.pdf", enabled: false }),
    ).resolves.toBeDefined();
  });

  test("result shape matches the ValidationReport qpdf field", async () => {
    const result = await qpdfCheck({ filePath: "/tmp/does-not-matter.pdf", enabled: false });
    expect(result).toEqual({
      status: "not_run",
      exitCode: null,
      stdout: "",
      stderr: "",
      warningCount: 0,
      errorCount: 0,
    });
  });
});
