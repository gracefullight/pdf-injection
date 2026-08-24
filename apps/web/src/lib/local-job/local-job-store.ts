import type { ClientValidationInput, JobStatusResponse } from "@pdf-injection/contracts";
import { mergeClientValidation } from "@pdf-injection/validation/report";
import type { LocalJob } from "@/lib/local-job/run-local-job";

/**
 * In-memory registry of jobs generated on-device (local mode).
 *
 * Deliberately memory-only, not `localStorage`/IndexedDB: a job holds the
 * hidden instruction in plain text plus both PDFs, and the private-manifest
 * warning ("PRIVATE — contains the hidden instruction") applies just as much
 * on the client. It lives for the tab session; a reload loses it, exactly like
 * the app's existing "no server, nothing persisted" posture. Download the
 * output/manifest/report to keep them.
 */
const jobs = new Map<string, LocalJob>();

export function putLocalJob(job: LocalJob): void {
  jobs.set(job.jobId, job);
}

export function getLocalJob(jobId: string): LocalJob | undefined {
  return jobs.get(jobId);
}

/** Throws the same shape a missing server job would produce, so callers need no special case. */
export function requireLocalJob(jobId: string): LocalJob {
  const job = jobs.get(jobId);
  if (!job) {
    throw new Error(
      "This locally generated job is no longer in memory (the page was reloaded). Local jobs are " +
        "never persisted — generate again.",
    );
  }
  return job;
}

export function deleteLocalJob(jobId: string): void {
  jobs.delete(jobId);
}

/** `GET /jobs/:id` equivalent for a local job. */
export function localJobStatus(jobId: string): JobStatusResponse {
  const job = requireLocalJob(jobId);
  return {
    jobId: job.jobId,
    status: "completed",
    errorCode: null,
    sourceFilename: job.sourceFilename,
    injectionMode: job.manifest.injection.mode,
    // `JobStatusResponse.targetPage` carries the 0-based page *index* — the
    // server stores `result.pageIndex` verbatim (job.service.ts) and the UI
    // adds 1 for display (human-view-tab.tsx). Do not pre-increment here.
    targetPage: job.manifest.injection.pageIndex,
    // `pageIndexes` is optional on the manifest (absent in artifacts written
    // before targetPage="all" existed) — fall back to the single page.
    targetPages: job.manifest.injection.pageIndexes ?? [job.manifest.injection.pageIndex],
    createdAt: job.createdAt,
    // Local jobs hold no server-side artifacts, so nothing expires; report the
    // creation time rather than inventing a retention window.
    expiresAt: job.createdAt,
    summary: job.report.summary,
    // All three are served from memory by `api.ts` for a local job.
    artifacts: { outputPdf: true, privateManifest: true, validationReport: true },
  };
}

/**
 * `POST /jobs/:id/client-validation` equivalent: merges the browser's render /
 * pixel-diff / extraction results into the stored report via the same
 * `mergeClientValidation` the server uses, and returns the updated report.
 */
export function applyLocalClientValidation(
  jobId: string,
  input: ClientValidationInput,
): LocalJob["report"] {
  const job = requireLocalJob(jobId);
  const merged = mergeClientValidation(job.report, input, job.manifest.injection.mode);
  const updated: LocalJob = {
    ...job,
    report: merged,
    manifest: { ...job.manifest, validation: merged.summary },
  };
  jobs.set(jobId, updated);
  return merged;
}
