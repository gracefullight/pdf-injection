# Architecture

PDF Injection is a Bun workspaces monorepo. `apps/api` (Elysia) and `apps/web` (React + Vite)
share wire types via `packages/contracts`, and the PDF-processing logic lives in small, pure
TypeScript packages that both the API and (where browser-safe) the web app can import directly.

## System flow

```mermaid
flowchart LR
    A[Professor Browser] --> B[apps/web — React + Vite]
    B -->|Eden Treaty treaty App, X-Job-Token| C[apps/api — Elysia on Bun]
    B -->|typed fetch, research-fetch.ts, X-Job-Token| C
    C --> D["inspectSource() — pdf-engine (incl. riskFlags)"]
    D --> E["injectPdf() — pdf-engine (4 modes, payloadLanguage)"]
    E --> F[output.pdf]
    F --> G["Round-trip + PDF.js text validation — validation"]
    F --> H["buildManifest() — pdf-engine"]
    G --> I[(bun:sqlite jobs table)]
    H --> I
    I --> B

    B --> J[PDF.js Renderer]
    B --> K[PDF.js Text Extractor]
    J --> L["pixelmatch Pixel Diff"]
    K --> M[Parser View]
    L -->|POST client-validation| C
    K -->|POST client-validation| C

    C -. optional, PDFI_QPDF_ENABLED .-> N["qpdf --check via Bun.spawn"]

    C --> O["background-runner.ts — bounded async queue"]
    O --> P["packages/benchmark — anthropic/openai/mock adapters"]
    P -. PDFI_ALLOW_EXTERNAL_PROVIDERS=true .-> Q[External LLM provider API]
    O --> R["packages/robustness — print-to-PDF / OCR-regen / screenshot-OCR"]
    R --> S["packages/detector — matchSignals, scoring, calibration"]
    O -->|(model_test_runs / robustness_runs)| I

    C --> T["variant-sets / student-keyed-sets — one job per variant/student"]
    T --> I
    C -. PDFI_RESEARCH_MODE=true .-> U["POST /jobs/:jobId/submissions"]
    U --> S
    U --> I
```

This mirrors the PRD's architecture diagram (§9), now with every branch implemented: provider
benchmark adapters (`packages/benchmark`), robustness transform adapters
(`packages/robustness`), and the deterministic detector (`packages/detector`) that both submission
analysis and robustness signal-survival checks share. The provider-calling and research-mode
branches (`Q`, `U`) are dashed because they only activate when their respective env-var gates
(`PDFI_ALLOW_EXTERNAL_PROVIDERS`, `PDFI_RESEARCH_MODE`) are set — see
[`docs/api.md`](api.md#limits-server-enforced-configurable-via-env--see-readmemd)
and [`docs/ethics-and-privacy.md`](ethics-and-privacy.md).

## Package responsibilities

| Package / app | Responsibility |
|---|---|
| `packages/contracts` | All wire types (`InjectionMode` incl. `xmp_only`, `PayloadLanguage`, `ExpectedSignal`, `JobRecord`, `PrivateManifest`, `ValidationReport`, plus `types-research.ts`'s §1-4 request/response shapes), `ApiErrorCode` + HTTP status/message maps, `LIMITS` defaults, and `computeOverall()` (the single source of truth for the `overall` status formula, incl. the `xmp_only`/`metadataPayloadPresent` case) |
| `packages/pdf-engine` | `inspectSource()` (magic bytes, size, page count, encryption/signature detection, page geometry snapshot, `riskFlags`), `injectPdf()` (dispatches to white-text / render-mode-3 / visible-control / `xmp_only` injectors, `payloadLanguage="ko"` via `@pdf-lib/fontkit`), `compareGeometry()`, `resolveTargetPage()`, `normalizePrompt()`, `buildManifest()`, `readXmpPayload()`, `koreanFontAvailable()` |
| `packages/validation` | `sha256Hex()` (via `Bun.CryptoHasher`), `extractText()` (server-side `pdfjs-dist` legacy build, run under Bun), `checkMetadataPayload()` (XMP-stream check for `xmp_only`), `qpdfCheck()` (optional, via `Bun.spawn`), `buildReport()` / `buildSummary()` / `mergeClientValidation()` |
| `packages/prompt-lint` | `lintPrompt()` — pure, dependency-free, shared by both the API (server-side enforcement) and the web app (live linting in the instruction editor) |
| `packages/detector` | Deterministic `ExpectedSignal` matchers (`exact_phrase`, `regex`, `methodology_label`, `ordered_terms`, `section_order`, regex matching under a Worker-based timeout) returning match evidence only — no verdict field. Plus Phase 4 `scoring.ts` (per-group weighted scores), `calibration.ts` (false-positive rate vs. baseline texts), `statistics.ts` (Fisher's exact test + Holm-Bonferroni correction), and `smoke-test-gate.ts` (PRD §23.2). Used by `apps/api`'s submissions and robustness services |
| `packages/benchmark` | Phase 3 provider adapters (`packages/benchmark/src/providers/anthropic.ts`, `packages/benchmark/src/providers/openai.ts`, `packages/benchmark/src/providers/mock.ts` — all structurally the same `ProviderAdapter` interface), `runMatrix()` (provider x condition x repeat orchestration with bounded concurrency and retry), `disclosure.ts`/`refusal.ts` (heuristic detection on raw responses), `export.ts` (JSON/CSV export). Used by `apps/api`'s model-tests service |
| `packages/robustness` | Phase 5 transform adapters: `print-to-pdf.ts` / `ocr-text-layer.ts` (rasterize + rebuild, with/without an OCR'd invisible text layer), `text-transforms.ts` (`paraphrase`/`human_edit` deterministic local fallbacks, `translation` provider-only), `survival.ts` (before/after signal-match evidence via `packages/detector`), `capabilities.ts` (live probes for `@napi-rs/canvas`/`tesseract.js` availability, resolved through `pdfjs-dist`'s own module root — see `native-canvas.ts`) |
| `apps/api` | Elysia app: router → service → repository, across 7 route files (`health`, `jobs`, `model-tests`, `robustness`, `variant-sets`, `student-keyed-sets`, `submissions`). `job.service.ts` runs the full pipeline (inspect → lint → inject → round-trip validate → text-extract → qpdf → report → manifest → persist) synchronously inside `POST /api/v1/jobs`, bounded by `PDFI_MAX_PROCESSING_MS`; model-test/robustness runs execute asynchronously via `apps/api/src/lib/background-runner.ts`. `jobs.repository.ts`, `runs.repository.ts`, `variant-sets.repository.ts`, `submissions.repository.ts` are the sole `bun:sqlite` access points (see [SQLite schema](#sqlite-schema) below) |
| `apps/web` | React UI across four core screens (Upload / Instruction / Generate / Validation) plus the Model Test / Robustness / Submissions / Variants tabs and screens; computes PDF.js render + `pixelmatch` diff + client-side text extraction in the browser and posts the results back via `POST /jobs/:jobId/client-validation`; calls round-1 JSON endpoints through an Eden Treaty client and §1-4 endpoints through a typed-fetch layer (see below) |

## Eden Treaty type sharing

`apps/web/src/lib/api.ts` is the single module boundary all UI code goes through to talk to the
API. Its JSON endpoints (`POST /jobs`, `GET /jobs/:jobId`, `POST /jobs/:jobId/client-validation`,
`DELETE /jobs/:jobId`, `GET /jobs/:jobId/private-manifest`, `GET /jobs/:jobId/validation-report`,
`GET /health`) go through Eden Treaty's `treaty<App>()` (`@elysiajs/eden`), typed against
`import type { App }` from `@pdf-injection/api` — the type exported from
`apps/api/src/index.ts`'s `createApp()`. The import is type-only, so it is erased at build/dev
time and never pulls any server code (Elysia, `bun:sqlite`, etc.) into the browser bundle; this
is how end-to-end request/response typing is shared between `apps/api` and `apps/web` without a
manually maintained duplicate type layer.

`treaty()` requires an absolute origin: `EDEN_DOMAIN` resolves to `window.location.origin` when
`VITE_API_BASE_URL` is left at its default relative `"/api"` (Vite's dev-server proxy still
forwards `/api/*` requests on that same origin to `apps/api`), or to the configured absolute URL
(with any trailing `/api` stripped) when `VITE_API_BASE_URL` is set to one.

The two binary-PDF endpoints (`GET /jobs/:jobId/source`, `GET /jobs/:jobId/output`) stay on raw
`fetch` rather than Eden Treaty: `apps/api`'s handlers build a low-level DOM `Response` directly
(`pdfResponse()` in `apps/api/src/routes/jobs.ts`) instead of returning a value through Elysia's
schema/body system, so there is no static response type for Eden to hang a `Blob`/`ArrayBuffer`
decode off of for those two routes specifically.

### §1-4 research endpoints now use Eden Treaty too

`apps/web/src/lib/eden-client.ts` is the single shared Eden Treaty client (`treaty<App>()`,
`resolveEdenDomain()`, `authHeaders()`, `unwrapEdenAs()`), factored out of round-1's `api.ts` so
every round-2 module — `api-model-tests.ts`, `api-robustness.ts`, `api-variant-sets.ts`,
`api-submissions.ts` — can also route their JSON request/response calls through it, statically
typed against `import type { App }` from `@pdf-injection/api`. Earlier in this round, these four
modules used a separate hand-typed `fetch` layer (`research-fetch.ts`) because `apps/api`'s
`model-tests`/`robustness`/`variant-sets`/`student-keyed-sets`/`submissions` route files hadn't
landed on the `App` type yet; once `apps/api/src/index.ts`'s `createApp()` chained `.use()` for
every route file, all four modules were switched onto `treaty<App>()`.

What still stays on raw `fetch` (by design, not as a gap) is the same category round-1 already
carved out for the two binary PDF endpoints (see [above](#eden-treaty-type-sharing)): **multipart
`POST` requests that create a resource** (`POST /jobs`, `POST /variant-sets`,
`POST /student-keyed-sets`, `POST /jobs/:jobId/submissions`, `POST /jobs/:jobId/robustness/screenshots`
— Elysia's schema/body system doesn't give Eden a convenient typed multipart-`FormData` builder),
and **raw binary/CSV/ZIP downloads** (`GET .../source`, `.../output`, `.../export`,
`.../mapping`, `.../archive`, `.../artifacts/:transform` — these routes build a low-level DOM
`Response` directly rather than returning a value through Elysia's schema system, exactly like
round-1's `pdfResponse()` pattern). `research-fetch.ts` still supplies `API_PREFIX`/`authHeaders()`/
`ResearchApiError`/`toFormData`/`downloadFile`/`fetchJson` for the multipart/binary calls in
`api-variant-sets.ts` and `api-submissions.ts`; `api-model-tests.ts` and `api-robustness.ts`
import `authHeaders()` from `eden-client.ts` directly and each locally re-declare their own
minimal `API_PREFIX`-equivalent constant for their one remaining `fetch`-based function (export
download / artifact download / screenshot upload), to avoid a compile-time module cycle back
through `api.ts`'s `export *` re-exports.

## Data flow, including the client-validation round trip

1. The browser uploads the source PDF + instruction + expected signals as `multipart/form-data`
   to `POST /api/v1/jobs`.
2. `apps/api`'s `job.service.ts` runs the pipeline **synchronously** (no queue/worker — see
   *Architecture decision* below): `inspectSource` → `lintPrompt` → `injectPdf` → reload +
   `compareGeometry` → `extractText` (server-side PDF.js) → `qpdfCheck` (if enabled) →
   `buildReport` / `buildManifest` → persist files + insert the `jobs` row.
3. The response returns `jobId`, a per-job `accessToken`, `status` (`completed` or `failed`),
   and any lint warnings. At this point `summary.pdfJsRenderPassed` and
   `summary.changedPixelRatio` are `null` and `overall` is `NOT_TESTED`.
4. The web app fetches `source.pdf` and `output.pdf` (each request carries `X-Job-Token`),
   renders both with PDF.js at scale 2 on a white RGBA canvas, runs `pixelmatch`, and runs
   client-side `getTextContent()` extraction.
5. The web app posts the render/diff/extraction results to
   `POST /api/v1/jobs/:jobId/client-validation`. The API merges them into the stored
   `report.json` and `manifest.json` and recomputes `overall` via `computeOverall()`
   (`packages/contracts/src/overall.ts`).
6. `GET /api/v1/jobs/:jobId/output` is blocked with `422 RENDER_FAILED` if the client reported
   `renderPassed: false` — a failed-to-render output is never downloadable.

### Architecture decision: synchronous processing, no queue (`POST /jobs` only)

`POST /api/v1/jobs` processes the whole pipeline inline rather than enqueuing a background job,
now bounded by `PDFI_MAX_PROCESSING_MS` (default 60 s; exceeding it raises
`504 PROCESSING_TIMEOUT` and leaves no job row or files behind — `apps/api/src/lib/time-limit.ts`).
The PoC's performance target (a 50-page PDF in ≤ 30 s) is well within a single HTTP request, and
a queue would add state and polling complexity the PRD explicitly avoids where possible. Clients
must still be able to handle a `"processing"` status defensively (it is reserved for a future
async mode) but in this implementation `status` is always `completed` or `failed` in the
`POST /jobs` response.

Round 2's model-test and robustness runs are the exception: they run in-process but
**asynchronously**, since a model-test matrix (multiple providers x conditions x repeats, each an
outbound network call) or a robustness matrix (page rasterization + OCR + provider text
transforms) can legitimately take much longer than one HTTP request should block for.

### Data flow: model-test runs (§2)

1. `POST /jobs/:jobId/model-tests` validates the request, computes `totalCalls`
   (`providers.length x conditions.length x repeats`), inserts a `model_test_runs` row with
   `status: "queued"`, and submits a task to `BackgroundRunner`
   (`apps/api/src/lib/background-runner.ts`, bounded concurrency across runs). Responds `202`
   immediately with `{ runId, status: "queued", totalCalls }`.
2. The background task resolves each requested `BenchmarkCondition`'s PDF via
   `condition-pdfs.ts`'s `getConditionPdf()` — `"original"` is the job's `source.pdf` verbatim;
   every injected mode (including `xmp_only`) re-runs `injectPdf()` with the job's own stored
   instruction/settings from `manifest.json` and caches the result at
   `<jobDir>/conditions/<mode>.pdf` so repeated runs against the same job reuse it.
3. For each `(provider, condition, repeat)` triple, `packages/benchmark`'s `runMatrix()` calls the
   provider adapter (bounded by `PDFI_MODEL_TEST_CONCURRENCY`), records the raw response, runs
   `packages/detector`'s `matchSignals()` against it, and flags `disclosure` (hidden instruction
   text or a long window of it appears in the response) and `refusal` (provider stop-reason or
   heuristic).
4. Progress (`progress.done`/`progress.total`) is persisted after each call; the run transitions
   to `status: "completed"` once every call finishes (or `"failed"`/`"cancelled"` on error/
   `DELETE`).
5. `aggregates[]` and `smokeTestGate` (PRD §23.2 — see
   [`docs/research-protocol.md`](research-protocol.md#interpreting-the-smoke-test-gate)) are
   computed from `results[]` on read, not stored separately.

### Data flow: robustness runs (§4)

1. `POST /jobs/:jobId/robustness` (gated on `PDFI_RESEARCH_MODE=true`) inserts a `robustness_runs`
   row and submits a background task, mirroring the model-test flow.
2. For each requested `PdfTransform`: `print_to_pdf` and `ocr_regeneration` both rasterize every
   page via `packages/robustness`'s `render-pages.ts` (using `@napi-rs/canvas`, resolved through
   `pdfjs-dist`'s own module root) and rebuild an image-only PDF with `pdf-lib`;
   `ocr_regeneration` additionally runs `tesseract.js` OCR on the rasterized pages and adds an
   invisible (render-mode-3) text layer at each word's mapped bounding box.
   `screenshot_ocr` (via the dedicated `POST .../screenshots` endpoint) OCRs uploaded screenshot
   images directly, without a PDF round-trip. Any transform whose capability is unavailable
   (`health.features.canvasAvailable`/`ocrAvailable: false`) is recorded as `available: false`
   with a `reason`, never silently skipped.
3. For each requested `TextTransform`: `paraphrase`/`human_edit` run deterministic seeded local
   fallbacks (`packages/robustness/src/text-transforms.ts`); `translation` has no local fallback
   and requires a configured, allowed provider (`ProviderAdapter.askText()` — same adapters as
   model-tests, gated the same way).
4. `packages/detector`'s `matchSignals()`/`evaluateSurvival()` compares the expected signals
   before/after each transform, producing `survivalRate` per transform.

### Data flow: variant sets, student-keyed sets, and distribution (§1)

`POST /variant-sets` and `POST /student-keyed-sets` each run a batch of `injectPdf()` calls (one
per variant/student, reusing the same source PDF bytes) synchronously within the request, writing
one `jobs` row + one artifact directory per member plus a `variant_sets` row and one
`variant_set_members` row per member (`kind: "variant" | "student_keyed"` distinguishes the two
resource families sharing the same tables). `POST /variant-sets/:id/distribution` assigns
students to variants (`round_robin` or a deterministic `seeded_hash`) and persists the assignment
for later `GET`/CSV re-fetch; student-keyed sets embed a unique key per student directly in the
injected instruction instead, so there is no separate distribution step — the mapping from
`studentId` to `key`/`jobId` is written to a private, CSV-only artifact
(`GET .../:id/mapping`) rather than the JSON response body.

### Data flow: submissions (§3)

`POST /jobs/:jobId/submissions` (gated on `PDFI_RESEARCH_MODE=true` and per-request
`acknowledgeNoRealStudentData: true`) reads text directly, or OCRs an uploaded image/PDF via
`tesseract.js`/`pdfjs-dist` first, then: (1) `packages/detector`'s `matchSignals()` against the
job's `ExpectedSignal[]`, grouped into `methodology`/`lexical`/`structural` via `scoring.ts`; (2)
`calibration.ts`'s `calibrateBaseline()` against every other submission on the same job already
labeled `"baseline"`, producing a false-positive rate and a per-signal Fisher's-exact p-value,
Holm-Bonferroni-corrected across the signal family (`statistics.ts`); (3) a fixed,
non-overclaiming `interpretation` object (headline drawn from a small closed set, never "AI
cheating detected"). The analysis is persisted to the `submissions` table (`analysis_json`) and
returned; `GET .../submissions` recomputes `calibrationSummary`/`statistics` across the full
current set on every read (not cached), so deleting a submission immediately changes future
calibration.

## Storage layout

Artifacts are stored on disk under `PDFI_STORAGE_DIR` (default `./.pdf-injection-data`), one
subdirectory per job, named exactly `<jobId>` (a server-generated UUID — never a client-supplied
path segment):

```text
<PDFI_STORAGE_DIR>/
└── <jobId>/
    ├── source.pdf         # original upload, byte-for-byte
    ├── output.pdf         # injected PDF (absent if injection hard-failed)
    ├── manifest.json      # PrivateManifest — contains the plaintext instruction
    ├── report.json        # ValidationReport
    ├── conditions/        # cached condition PDFs for model-test runs (<mode>.pdf, incl. xmp_only)
    └── submissions/       # per-submission uploaded/derived text + OCR source files (§3, PDFI_RESEARCH_MODE)
```

Variant sets and student-keyed sets are **not** nested inside a single job's directory (they own
multiple member jobs): each set gets its own `<PDFI_STORAGE_DIR>/sets/<setId>/` directory holding
`distribution.json` (variant sets) or `mapping.json` (student-keyed sets — the private
`studentId,key,jobId,outputSha256` data, only ever persisted here plus each member's own
`manifest.json`), while each member's own `source.pdf`/`output.pdf`/`manifest.json`/`report.json`
still live under that member's own `<jobId>/` directory as usual.

`jobDir()` / `jobFilePath()` (`apps/api/src/storage.ts`) validate the `jobId` against a strict
UUID v4 regex before building any path, so path traversal via a malformed `:jobId` route
parameter is not possible — an invalid id is treated identically to a nonexistent job
(`404 JOB_NOT_FOUND`). Download filenames are derived from the source filename via
`sanitizeFilenameStem()` (`[^A-Za-z0-9._-]` → `_`, max 100 chars), never from the raw
client-supplied name used as a path component.

## SQLite schema

`apps/api/src/repositories/jobs.repository.ts` owns the root `jobs` table, created on startup via
`JobsRepository.migrate()`:

```sql
CREATE TABLE IF NOT EXISTS jobs (
  id                 TEXT PRIMARY KEY,
  status             TEXT NOT NULL,
  source_filename    TEXT NOT NULL,
  source_sha256      TEXT NOT NULL,
  output_sha256      TEXT,
  prompt_sha256      TEXT NOT NULL,
  injection_mode     TEXT NOT NULL,
  target_page        INTEGER NOT NULL,
  created_at         TEXT NOT NULL,
  expires_at         TEXT NOT NULL,
  error_code         TEXT,
  access_token_hash  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_expires_at ON jobs(expires_at);
```

Round 2 adds four more tables, all foreign-keyed to `jobs(id) ON DELETE CASCADE` (via
`PRAGMA foreign_keys = ON`, enabled once per connection by `runs.repository.ts`'s `migrate()`),
so deleting a job automatically removes its runs and submissions:

```sql
-- apps/api/src/repositories/runs.repository.ts — one identical table per run kind
CREATE TABLE IF NOT EXISTS model_test_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  status TEXT NOT NULL,               -- queued | running | completed | failed | cancelled
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  config_json TEXT NOT NULL,          -- ModelTestRequest + results/aggregates, serialized
  progress_done INTEGER NOT NULL DEFAULT 0,
  progress_total INTEGER NOT NULL DEFAULT 0,
  error_code TEXT
);
CREATE TABLE IF NOT EXISTS robustness_runs ( -- identical shape, config_json = RobustnessRequest + results
  ... );

-- apps/api/src/repositories/submissions.repository.ts
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  label TEXT NOT NULL,                -- candidate | baseline
  created_at TEXT NOT NULL,
  text_sha256 TEXT NOT NULL,
  text_length INTEGER NOT NULL,
  source TEXT NOT NULL,               -- text | txt | md | pdf | image_ocr
  analysis_json TEXT NOT NULL         -- SubmissionAnalysis, serialized
);

-- apps/api/src/repositories/variant-sets.repository.ts — NOT foreign-keyed to jobs
-- (a set owns multiple member jobs, not the reverse)
CREATE TABLE IF NOT EXISTS variant_sets (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                 -- "variant" | "student_keyed"
  access_token_hash TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  meta_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS variant_set_members (
  set_id TEXT NOT NULL,
  label_or_student_id TEXT NOT NULL,  -- variant label, or studentId for student-keyed sets
  job_id TEXT NOT NULL,
  key_or_null TEXT,                   -- per-student key (student-keyed sets only)
  PRIMARY KEY (set_id, label_or_student_id)
);
```

Notable properties:

- **No instruction text column, anywhere.** The hidden instruction only ever exists inside a
  job's `manifest.json` (or, for variant/student-keyed sets, each member's own `manifest.json`)
  on disk; SQLite never stores instruction text, only `prompt_sha256` (`jobs`) or hashed/derived
  fields (`text_sha256` on `submissions`). Submission/model-test/robustness raw text and results
  are stored as JSON blobs (`analysis_json`/`config_json`) but never re-derive or duplicate a job's
  own hidden instruction.
- **`access_token_hash`** stores the SHA-256 of the per-resource `X-Job-Token` (jobs) or set-level
  token (`variant_sets.access_token_hash`), never the token itself; `requireJob()`
  (`apps/api/src/middleware/access-token.ts`) and `requireSet()` (`apps/api/src/lib/set-token.ts`)
  both compare hashes with a constant-time comparison.
- All queries are parameterized (`$name` placeholders via `Database#query().run()/.get()/.all()`)
  — no string interpolation into SQL anywhere in any repository.
- Two background `setInterval`s (both unref'd, so neither blocks process/test exit):
  `sweepExpiredJobs()` (every `PDFI_SWEEP_INTERVAL_MS`, deletes any job whose `expires_at` has
  passed — cascading to its runs/submissions rows both via SQL `ON DELETE CASCADE` and via
  `deleteJobDir()` removing the job's files) and `sweepExpiredSets()` (variant sets and
  student-keyed sets have their own `expires_at`, since their set-level storage —
  `distribution.json`/`mapping.json` — isn't inside any single member job's directory).
