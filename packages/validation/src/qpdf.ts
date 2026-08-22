import type { QpdfStatus } from "@pdf-injection/contracts";

export interface QpdfCheckInput {
  filePath: string;
  /** Gate: server env PS_QPDF_ENABLED === "true". Defaults to reading process.env. */
  enabled?: boolean;
  /** Injectable for tests; defaults to `Bun.which(binary, { PATH: env?.PATH ?? process.env.PATH })`. */
  which?: (binary: string) => string | null;
  /** Binary name to resolve via `which`. Defaults to "qpdf". Override in tests to point at a fake binary. */
  binary?: string;
  /**
   * Environment passed to `Bun.spawn` (and used to resolve `PATH` for the
   * default `which`, so a test can prepend a directory containing a fake
   * `qpdf` script onto `PATH` without touching `process.env`). Defaults to
   * `process.env` when omitted.
   */
  env?: Record<string, string | undefined>;
}

export interface QpdfCheckResult {
  status: QpdfStatus;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  warningCount: number;
  errorCount: number;
}

const NOT_RUN: QpdfCheckResult = {
  status: "not_run",
  exitCode: null,
  stdout: "",
  stderr: "",
  warningCount: 0,
  errorCount: 0,
};

/**
 * Runs `qpdf --check <file>` via Bun.spawn, gated by PS_QPDF_ENABLED and the
 * qpdf binary's presence. Never throws — returns {status:"not_run"} when
 * disabled or missing, so a job can always complete without qpdf installed.
 * PRD §13.5.
 */
export async function qpdfCheck(input: QpdfCheckInput): Promise<QpdfCheckResult> {
  const enabled = input.enabled ?? process.env.PS_QPDF_ENABLED === "true";
  if (!enabled) {
    return { ...NOT_RUN };
  }

  const env = input.env ?? process.env;
  const binary = input.binary ?? "qpdf";
  const which =
    input.which ?? ((bin: string) => Bun.which(bin, { PATH: env.PATH ?? process.env.PATH ?? "" }));
  const qpdfPath = which(binary);
  if (!qpdfPath) {
    return { ...NOT_RUN };
  }

  try {
    const proc = Bun.spawn([qpdfPath, "--check", input.filePath], {
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    const combined = `${stdout}\n${stderr}`;
    const warningCount = (combined.match(/warning/gi) ?? []).length;
    const errorCount = (combined.match(/error/gi) ?? []).length;

    // qpdf --check exit-code convention: 0 = no errors or warnings,
    // 2 = errors found (may also print warnings), 3 = warnings only (no
    // errors). Any other non-zero code is treated as failed defensively.
    let status: QpdfStatus;
    if (exitCode === 0) {
      status = warningCount > 0 ? "warning" : "passed";
    } else if (exitCode === 3) {
      status = "warning";
    } else {
      status = "failed";
    }

    return { status, exitCode, stdout, stderr, warningCount, errorCount };
  } catch {
    // qpdf failed to spawn (permissions, race between which() and exec, etc).
    // Treat as not_run rather than failing the whole job.
    return { ...NOT_RUN };
  }
}
