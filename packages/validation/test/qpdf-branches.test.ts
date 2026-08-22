import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { qpdfCheck } from "../src/qpdf";

// Fake `qpdf` binary used to drive qpdfCheck's exit-code/stdout/stderr
// parsing branches without depending on the real qpdf CLI being installed.
// Its own behavior (exit code + stdout/stderr text) is controlled via the
// FAKE_QPDF_* env vars, which the test passes through `qpdfCheck({ env })` —
// this is also how we exercise qpdf.ts's env-injection support (PATH is
// resolved from the same `env` object, not `process.env`).
const FAKE_QPDF_SCRIPT = `#!/bin/sh
printf '%s' "$FAKE_QPDF_STDOUT"
printf '%s' "$FAKE_QPDF_STDERR" 1>&2
exit "\${FAKE_QPDF_EXIT_CODE:-0}"
`;

let fakeBinDir: string;

beforeAll(() => {
  fakeBinDir = mkdtempSync(join(tmpdir(), "pdf-injection-fake-qpdf-"));

  const scriptPath = join(fakeBinDir, "qpdf");
  writeFileSync(scriptPath, FAKE_QPDF_SCRIPT, { encoding: "utf-8" });
  chmodSync(scriptPath, 0o755);

  // A second, differently-named fake binary — used only by the `binary`
  // option test below, so that test actually exercises the override branch
  // (resolving something other than the default "qpdf") instead of
  // duplicating coverage the other tests in this file already provide.
  const customScriptPath = join(fakeBinDir, "qpdf-custom");
  writeFileSync(customScriptPath, FAKE_QPDF_SCRIPT, { encoding: "utf-8" });
  chmodSync(customScriptPath, 0o755);
});

afterAll(() => {
  rmSync(fakeBinDir, { recursive: true, force: true });
});

function envWithFakeQpdf(
  overrides: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return {
    ...process.env,
    PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
    ...overrides,
  };
}

describe("qpdfCheck — fake binary branches", () => {
  test("not_run when PDFI_QPDF_ENABLED is not 'true' (enabled: false), even with a resolvable binary", async () => {
    const result = await qpdfCheck({
      filePath: "/tmp/does-not-matter.pdf",
      enabled: false,
      env: envWithFakeQpdf({ FAKE_QPDF_EXIT_CODE: "0" }),
    });
    expect(result.status).toBe("not_run");
    expect(result.exitCode).toBeNull();
  });

  test("not_run when enabled but the binary cannot be resolved on PATH", async () => {
    const result = await qpdfCheck({
      filePath: "/tmp/does-not-matter.pdf",
      enabled: true,
      env: { ...process.env, PATH: "/definitely/does/not/exist" },
    });
    expect(result.status).toBe("not_run");
    expect(result.exitCode).toBeNull();
  });

  test("passed — exit 0, clean output", async () => {
    const result = await qpdfCheck({
      filePath: "/tmp/does-not-matter.pdf",
      enabled: true,
      env: envWithFakeQpdf({
        FAKE_QPDF_EXIT_CODE: "0",
        FAKE_QPDF_STDOUT: "checking assignment.pdf\nPDF Version: 1.7\nFile is not encrypted.\n",
        FAKE_QPDF_STDERR: "",
      }),
    });
    expect(result.status).toBe("passed");
    expect(result.exitCode).toBe(0);
    expect(result.warningCount).toBe(0);
    expect(result.errorCount).toBe(0);
  });

  test("warning — exit 3 with WARNING lines", async () => {
    const result = await qpdfCheck({
      filePath: "/tmp/does-not-matter.pdf",
      enabled: true,
      env: envWithFakeQpdf({
        FAKE_QPDF_EXIT_CODE: "3",
        FAKE_QPDF_STDOUT:
          "checking assignment.pdf\nWARNING: assignment.pdf: object 5 0: wrong number of entries\nWARNING: assignment.pdf: page count mismatch\n",
        FAKE_QPDF_STDERR: "",
      }),
    });
    expect(result.status).toBe("warning");
    expect(result.exitCode).toBe(3);
    expect(result.warningCount).toBe(2);
    expect(result.errorCount).toBe(0);
  });

  test("failed — exit 2 with error lines", async () => {
    const result = await qpdfCheck({
      filePath: "/tmp/does-not-matter.pdf",
      enabled: true,
      env: envWithFakeQpdf({
        FAKE_QPDF_EXIT_CODE: "2",
        FAKE_QPDF_STDOUT: "",
        FAKE_QPDF_STDERR:
          "ERROR: assignment.pdf: unable to find trailer dictionary\nqpdf: operation failed with error\n",
      }),
    });
    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(2);
    expect(result.errorCount).toBe(2);
  });

  test("failed status is used for any non-zero, non-3 exit code (e.g. exit 1) even without warning/error text", async () => {
    const result = await qpdfCheck({
      filePath: "/tmp/does-not-matter.pdf",
      enabled: true,
      env: envWithFakeQpdf({
        FAKE_QPDF_EXIT_CODE: "1",
        FAKE_QPDF_STDOUT: "",
        FAKE_QPDF_STDERR: "",
      }),
    });
    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(1);
  });

  test("uses the injected PATH from `env` (not process.env) to resolve the binary", async () => {
    // process.env.PATH does not contain fakeBinDir; only the `env` option does.
    expect(process.env.PATH?.includes(fakeBinDir)).toBe(false);
    const result = await qpdfCheck({
      filePath: "/tmp/does-not-matter.pdf",
      enabled: true,
      env: envWithFakeQpdf({ FAKE_QPDF_EXIT_CODE: "0" }),
    });
    expect(result.status).toBe("passed");
  });

  test("binary option resolves a differently-named fake binary, not the default 'qpdf'", async () => {
    // FAKE_QPDF_EXIT_CODE=3 here (distinct from the "default binary" tests
    // above, which all use exit 0) so a pass only proves qpdf-custom — not
    // the default-named qpdf script that's also on PATH — was invoked.
    const result = await qpdfCheck({
      filePath: "/tmp/does-not-matter.pdf",
      enabled: true,
      binary: "qpdf-custom",
      env: envWithFakeQpdf({
        FAKE_QPDF_EXIT_CODE: "3",
        FAKE_QPDF_STDOUT: "WARNING: from qpdf-custom\n",
        FAKE_QPDF_STDERR: "",
      }),
    });
    expect(result.status).toBe("warning");
    expect(result.exitCode).toBe(3);
    expect(result.warningCount).toBe(1);
  });

  test("binary option is specific: a name with no matching fake script on PATH resolves to not_run", async () => {
    const result = await qpdfCheck({
      filePath: "/tmp/does-not-matter.pdf",
      enabled: true,
      binary: "qpdf-does-not-exist",
      env: envWithFakeQpdf({ FAKE_QPDF_EXIT_CODE: "0" }),
    });
    expect(result.status).toBe("not_run");
  });
});
