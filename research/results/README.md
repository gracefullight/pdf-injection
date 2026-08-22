# research/results

Output directory for recorded experiment runs (Phase 3 model-test exports,
Phase 4/5 statistics summaries) that a researcher chooses to keep outside of
a job's per-job storage (`PDFI_STORAGE_DIR/<jobId>/model-tests/`,
`.../robustness/`, `.../submissions/`).

## How files land here

- `apps/api`'s model-test export endpoint (`GET
  /api/v1/jobs/:jobId/model-tests/:runId/export?format=json|csv`) copies its
  output into this directory **only** when the server env var
  `PDFI_RESEARCH_RESULTS_DIR` is set (default: unset, i.e. this directory
  stays empty in normal operation). See
  `.agents/results/api-contracts/pdf-injection-phase3-5-api.md` §2.
- Everything here is a **derived artifact** (aggregates, CSV/JSON exports,
  smoke-test gate summaries per PRD §23.2) — never the raw hidden
  instruction text or a job's private manifest. Treat files here as safe to
  share with a co-author; treat `.pdf-injection-data/` job storage as private.

## Naming convention

`<jobId-or-experiment-name>.model-tests.<runId>.<json|csv>` — matches the
export endpoint's `Content-Disposition` filename so a copied file and its
origin run are traceable back to the job/run that produced it.

## Retention

Nothing here is auto-deleted by the retention sweeper (that only applies to
`PDFI_STORAGE_DIR`) — clean up manually, and do not commit large or sensitive
result sets to git without review.
