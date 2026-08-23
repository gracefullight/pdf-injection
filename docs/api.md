# API Reference

This is the HTTP API implemented by `apps/api` (Elysia on Bun), promoted from
`.agents/results/api-contracts/pdf-injection-jobs-api.md` and
`.agents/results/api-contracts/pdf-injection-phase3-5-api.md`, and checked against the actual route
handlers (`apps/api/src/routes/*.ts`) and service layer (`apps/api/src/services/*.ts`). All wire
types live in `packages/contracts` (`@pdf-injection/contracts`, including `types-research.ts` for
the §1-4 additions below) and are shared by `apps/web`.

## Base URL

`/api/v1`

## Authentication

None (single-professor local PoC — no accounts). Every resource is guarded by an unguessable
UUID id plus a per-resource access-token header, hashed (SHA-256) server-side and compared in
constant time — never the raw token:

- `POST /jobs` returns a per-job `accessToken`; every `GET /jobs/:jobId/*` and
  `DELETE /jobs/:jobId` (including model-tests/robustness/submissions sub-routes) must send it as
  `X-Job-Token`, or the request is rejected with `403 JOB_FORBIDDEN`.
- `POST /variant-sets` and `POST /student-keyed-sets` each return their own set-level
  `accessToken`; every subsequent request for that `:id` sends it as the same `X-Job-Token`
  header (`apps/api/src/lib/set-token.ts`'s `requireSet()`), or `403 JOB_FORBIDDEN`.

## Limits (server-enforced, configurable via env — see [`README.md`](../README.md#environment-variables))

| Env var | Default | Error code |
|---|---|---|
| `PDFI_MAX_FILE_BYTES` | 26214400 (25 MB) | `FILE_TOO_LARGE` (413) |
| `PDFI_MAX_PAGES` | 100 | `TOO_MANY_PAGES` (422) |
| `PDFI_MAX_INSTRUCTION_CHARS` | 1500 | `PROMPT_TOO_LONG` (422) |
| `PDFI_RETENTION_HOURS` | 24 | — (sweeper deletes expired jobs) |
| `PDFI_STORAGE_DIR` | `./.pdf-injection-data` | — |
| `PDFI_QPDF_ENABLED` | `false` | — |
| `PDFI_MAX_PAGE_DIMENSION_PT` | 14400 | `INVALID_PDF` (page box too large) |
| `PDFI_MAX_PROCESSING_MS` | 60000 | `PROCESSING_TIMEOUT` (504) |
| `PDFI_MAX_VARIANTS` | 8 | `TOO_MANY_VARIANTS` (422) |
| `PDFI_MAX_STUDENT_KEYS` | 500 | `TOO_MANY_STUDENTS` (422) |
| `PDFI_MAX_SUBMISSION_BYTES` | 10485760 (10 MB) | `FILE_TOO_LARGE` (413) |
| `PDFI_MAX_SUBMISSIONS_PER_JOB` | 500 | `VALIDATION_ERROR` (422) |
| `PDFI_MODEL_TEST_MAX_REPEATS` | 10 | `VALIDATION_ERROR` (422) |
| `PDFI_RESEARCH_MODE` | `false` | `RESEARCH_MODE_DISABLED` (403) — gates §3/§4 |
| `PDFI_ALLOW_EXTERNAL_PROVIDERS` | `false` | `EXTERNAL_PROVIDERS_DISABLED` (403) — gates non-`mock` providers |

## Error envelope (all non-2xx responses)

```json
{ "error": { "code": "PDF_ENCRYPTED", "message": "Encrypted PDFs are not supported yet.", "details": {} } }
```

Error codes (`ApiErrorCode` union in `@pdf-injection/contracts`):

| Code | HTTP | When |
|---|---|---|
| `INVALID_PDF` | 400 | magic bytes / parse failure / abnormal page dimensions |
| `PDF_ENCRYPTED` | 422 | encrypted source |
| `PDF_SIGNED` | 422 | digital signature (`/Sig` field, or `/DocMDP`/`/UR3` in the catalog `/Perms`) present |
| `FILE_TOO_LARGE` | 413 | over `PDFI_MAX_FILE_BYTES` |
| `TOO_MANY_PAGES` | 422 | over `PDFI_MAX_PAGES` |
| `PROMPT_TOO_LONG` | 422 | instruction > `PDFI_MAX_INSTRUCTION_CHARS` |
| `PROMPT_ENCODING_FAILED` | 422 | non-printable-ASCII / null byte / control chars |
| `PROMPT_LINT_ERROR` | 422 | other lint errors (empty prompt, a signal with a blank value, …). An *empty* `expectedSignals` list is not an error — see the `expectedSignals` field below |
| `VALIDATION_ERROR` | 422 | malformed multipart field / JSON body |
| `INJECTION_FAILED` | 500 | pdf-lib modification threw unexpectedly |
| `OUTPUT_PARSE_FAILED` | 500 | output could not be reloaded by pdf-lib |
| `GEOMETRY_CHANGED` | 422 | page count / boxes / rotation differ after injection |
| `RENDER_FAILED` | 422 | client-reported PDF.js render failure (blocks output download) |
| `JOB_NOT_FOUND` | 404 | unknown / expired / deleted job, or a malformed `:jobId` |
| `JOB_FORBIDDEN` | 403 | missing or wrong `X-Job-Token` |
| `JOB_NOT_READY` | 409 | artifact requested before it exists / job not completed |
| `NOT_IMPLEMENTED` | 501 | reserved in `ApiErrorCode`; no route currently returns this — `POST /jobs/:jobId/model-tests` is now a real endpoint (see below) |
| `EXTERNAL_PROVIDERS_DISABLED` | 403 | `anthropic`/`openai` requested while `PDFI_ALLOW_EXTERNAL_PROVIDERS=false` (`mock` is always allowed) |
| `RESEARCH_MODE_DISABLED` | 403 | any §3/§4 (submissions, robustness) route while `PDFI_RESEARCH_MODE=false` |
| `PROVIDER_NOT_CONFIGURED` | 422 | external providers allowed but the selected provider's API key env var is unset |
| `PROVIDER_ERROR` | 502 | the model provider returned an error |
| `RUN_NOT_FOUND` | 404 | unknown/expired model-test or robustness run |
| `RUN_NOT_READY` | 409 | export requested before the run finished |
| `SUBMISSION_NOT_FOUND` | 404 | unknown/expired submission |
| `VARIANT_SET_NOT_FOUND` | 404 | unknown/expired variant set or student-keyed set |
| `TOO_MANY_VARIANTS` | 422 | variant count over `PDFI_MAX_VARIANTS` |
| `TOO_MANY_STUDENTS` | 422 | student count over `PDFI_MAX_STUDENT_KEYS` |
| `OCR_UNAVAILABLE` | 422 | OCR requested (submissions image upload, screenshot-OCR robustness) but `tesseract.js`/its trained-data isn't available in this process (`health.features.ocrAvailable: false`) |
| `CANVAS_UNAVAILABLE` | 422 | a robustness PDF transform (print-to-PDF, OCR regeneration), or the `image_only` injection mode (job creation, or model-test condition-PDF regeneration), requires `@napi-rs/canvas` rendering but it isn't available (`health.features.canvasAvailable: false`) |
| `PROCESSING_TIMEOUT` | 504 | `POST /jobs` exceeded `PDFI_MAX_PROCESSING_MS` — no job row or files are left behind |
| `FONT_UNAVAILABLE` | 422 | `payloadLanguage="ko"` / `"zh"` requested but the matching CJK font (Noto Sans KR / Noto Sans SC under `PDFI_FONT_DIR`) is not available on the server |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | a submission file's extension doesn't match its content, or has an extension outside txt/md/pdf/png/jpg |

`QPDF_WARNING` is **not** an error code — it is surfaced as `validation.qpdfStatus: "warning"` in
the report.

---

## Endpoints

### `GET /api/v1/health`

- **Response 200** (`HealthResponse`):

```json
{
  "status": "ok",
  "version": "0.1.0",
  "qpdfAvailable": false,
  "features": {
    "externalProviders": false,
    "researchMode": false,
    "ocrAvailable": true,
    "canvasAvailable": true,
    "koPayload": true,
    "zhPayload": true,
    "ollama": { "available": false, "baseUrl": "http://localhost:11434", "models": [] }
  }
}
```

  - `features.externalProviders` / `features.researchMode` mirror `PDFI_ALLOW_EXTERNAL_PROVIDERS` /
    `PDFI_RESEARCH_MODE` directly.
  - `features.ocrAvailable` / `features.canvasAvailable` are live-probed capabilities
    (`packages/robustness`'s `capabilities()`): whether `tesseract.js` (with its `eng`
    trained-data file) and `@napi-rs/canvas` (resolved through `pdfjs-dist`'s own module root) are
    actually usable in this process, not just installed. Both default to `true` on a normal
    install; they can be `false` in a sandboxed/offline environment.
  - `features.koPayload` / `features.zhPayload` mirror `packages/pdf-engine`'s
    `koreanFontAvailable()` / `chineseFontAvailable()` — whether the Noto Sans KR / Noto Sans SC
    font file under `PDFI_FONT_DIR` can be loaded (`payloadLanguage="ko"` / `"zh"`).
  - `features.ollama` is a live probe of the local Ollama provider (`GET {baseUrl}/api/tags`,
    cached 10 s, never throws): `{ available, baseUrl, models }`.

### `POST /api/v1/jobs`

Uploads a source PDF + instruction, runs injection and server-side validation
**synchronously**, and persists the artifacts (see
[`docs/architecture.md`](architecture.md#data-flow-including-the-client-validation-round-trip)
for the full pipeline).

- **Content-Type**: `multipart/form-data`
- **Fields**:

| Field | Type | Required | Notes |
|---|---|---|---|
| `file` | File (`application/pdf`) | yes | magic bytes `%PDF-` checked, MIME checked |
| `instruction` | string | yes | 1..1500 printable ASCII (`\n` and `\t` allowed) when `payloadLanguage="en"`; non-ASCII allowed only with `payloadLanguage="ko"` / `"zh"` |
| `expectedSignals` | string (JSON `ExpectedSignal[]`) | no | default `[]`. Optional for generating the PDF — the injection/validation pipeline never reads them — but they are frozen into the job's private manifest and every feature that *scores* text against them (`POST …/model-tests`, `POST …/submissions`, `POST …/robustness` with `textTransforms`) requires at least one and returns `422 VALIDATION_ERROR` for a job generated without any; they cannot be added afterwards |
| `injectionMode` | `"white_text" \| "render_mode_3" \| "visible_positive_control" \| "xmp_only" \| "unicode_tags" \| "image_only" \| "freetext_annot" \| "acroform_field" \| "info_dict"` | yes | The last four are round-3 research/diagnostic probe conditions, not production channels — see [`README.md`](../README.md#injection-modes) |
| `targetPage` | string: `"first"`, `"last"`, or 1-based integer | no | default `"last"`; ignored (no page content is touched) for `xmp_only`/`info_dict` |
| `position` | `"top" \| "bottom" \| "custom"` | no | default `"bottom"`; ignored for `xmp_only`/`info_dict` |
| `x`, `y` | number (pt) | when `position=custom` | ignored for `xmp_only`/`info_dict` |
| `fontSize` | number | no | default `1`; 0.5–12 (visible control ignores and uses 9); ignored for `xmp_only`/`info_dict` |
| `maxWidth` | number | no | default page width − 2×margin; ignored for `xmp_only`/`info_dict` |
| `payloadLanguage` | `"en" \| "ko" \| "zh"` | no | default `"en"`. `"ko"` embeds a Noto Sans KR subset and `"zh"` (Simplified Chinese) a Noto Sans SC subset (`@pdf-lib/fontkit`; the two behave identically otherwise — everything said about `"ko"` below applies to `"zh"`) for the 3 page-content drawn-text modes plus the 2 round-3 probes that draw their own appearance-stream text the same way (`freetext_annot`/`acroform_field`); `xmp_only`/`info_dict` accept `"ko"` with no font needed (no glyphs drawn); `image_only` accepts `"ko"` but rasterizes via `@napi-rs/canvas`'s own font resolution, not this bundled subset (unverified for CJK by this project's tests); non-ASCII with `"en"` → `422 PROMPT_ENCODING_FAILED`; missing font → `422 FONT_UNAVAILABLE`; `"ko"` is rejected outright for `unicode_tags` → `422 PROMPT_ENCODING_FAILED` (its Unicode Tag codec has no mapping outside printable ASCII) |
| `acknowledgedWarnings` | string (JSON `string[]`) | no | lint warning ids the professor acknowledged |

- **Response 201** (`CreateJobResponse`):

```json
{
  "jobId": "0da5e0c1-9b2a-4d2e-8c7e-2a8a5f2e9d11",
  "accessToken": "base64url-32-bytes",
  "status": "completed",
  "errorCode": null,
  "lintWarnings": [{ "id": "fake_citation", "severity": "warning", "message": "..." }]
}
```

  - `status` is `"completed"` or `"failed"` (processing is synchronous in this implementation;
    `"processing"` is reserved for a future async mode).
  - If server-side validation hits a hard gate (e.g. `GEOMETRY_CHANGED`, `INJECTION_FAILED`,
    `OUTPUT_PARSE_FAILED`), a job row with `status: "failed"` and `errorCode` set is still
    created, and the response is still `201` so the professor can inspect the best-effort report.
  - If `inspectSource()` detects JavaScript, embedded files, external URIs, or an `/OpenAction` in
    the source PDF, the job still proceeds — these are surfaced as
    `PDF_CONTAINS_JAVASCRIPT` / `PDF_CONTAINS_EMBEDDED_FILES` / `PDF_CONTAINS_EXTERNAL_URIS` /
    `PDF_HAS_OPEN_ACTION` warnings in `result.warnings`, never as hard-gate failures.
- **Errors**: 400 / 413 / 422 as above — these are **pre-processing** rejections: no job row or
  files are created (except `FILE_TOO_LARGE` from the initial `Content-Length` check, which also
  creates nothing). `504 PROCESSING_TIMEOUT` (over `PDFI_MAX_PROCESSING_MS`) is a mid-processing
  abort — it also leaves no job row or files.

### `GET /api/v1/jobs/:jobId`

- **Headers**: `X-Job-Token`
- **Response 200** (`JobStatusResponse`):

```json
{
  "jobId": "uuid",
  "status": "completed",
  "errorCode": null,
  "sourceFilename": "assignment.pdf",
  "injectionMode": "white_text",
  "targetPage": 4,
  "createdAt": "2026-08-22T01:00:00.000Z",
  "expiresAt": "2026-08-23T01:00:00.000Z",
  "summary": {
    "outputLoadPassed": true,
    "pdfJsRenderPassed": null,
    "pageCountPreserved": true,
    "pageGeometryPreserved": true,
    "hiddenTextExtracted": true,
    "changedPixelRatio": null,
    "qpdfStatus": "not_run",
    "metadataPayloadPresent": null,
    "overall": "NOT_TESTED"
  },
  "artifacts": { "outputPdf": true, "privateManifest": true, "validationReport": true }
}
```

  - `pdfJsRenderPassed` / `changedPixelRatio` are `null` until the browser posts client
    validation; `overall` is recomputed at that point (see below).
  - `metadataPayloadPresent` is `boolean | null`: `null` for the 3 drawn-text modes (not
    applicable), and `true`/`false` for `xmp_only` (whether `checkMetadataPayload()` found the
    instruction in the output's XMP metadata stream).
  - `overall`: `"PASS" | "PASS_WITH_WARNINGS" | "FAIL" | "NOT_TESTED"`.
- **Errors**: 403, 404

### `GET /api/v1/jobs/:jobId/source`

- **Headers**: `X-Job-Token`
- **Response 200**: `application/pdf` (original upload — used for side-by-side render + pixel diff)
- **Errors**: 403, 404, 409 (`JOB_NOT_READY`)

### `GET /api/v1/jobs/:jobId/output`

- **Headers**: `X-Job-Token`
- **Response 200**: `application/pdf`, `Content-Disposition: attachment; filename="<sanitized-stem>.injected.pdf"`
- **Errors**: 403, 404, 409 (`JOB_NOT_READY`), 422 (`RENDER_FAILED` when client validation
  reported a render failure — the download is blocked)

### `GET /api/v1/jobs/:jobId/private-manifest`

- **Headers**: `X-Job-Token`
- **Response 200**: `application/json` (`PrivateManifest`, schema below),
  `Content-Disposition: attachment; filename="<stem>.private-manifest.json"`
- **Errors**: 403, 404, 409

### `GET /api/v1/jobs/:jobId/validation-report`

- **Headers**: `X-Job-Token`
- **Response 200**: `application/json` (`ValidationReport`),
  `Content-Disposition: attachment; filename="<stem>.validation-report.json"`
- **Errors**: 403, 404, 409

### `POST /api/v1/jobs/:jobId/client-validation`

The browser posts PDF.js render + pixel-diff + text-extraction results (computed client-side
with `pdfjs-dist` + `pixelmatch`). The server merges them into the stored report and manifest and
recomputes `overall`.

- **Headers**: `X-Job-Token`
- **Body** (`ClientValidationInput`):

```json
{
  "pdfJsVersion": "4.x.y",
  "renderPassed": true,
  "renderErrors": [],
  "visualDiff": {
    "scale": 2,
    "thresholdRatio": 0.00001,
    "pages": [
      { "pageIndex": 0, "width": 1224, "height": 1584, "changedPixels": 0, "changedPixelRatio": 0, "maxChannelDelta": 0, "meanAbsoluteDifference": 0, "passed": true }
    ],
    "changedPixelRatio": 0,
    "passed": true
  },
  "extractedText": {
    "pages": [ { "pageIndex": 4, "textLength": 1820, "exactMatch": true, "normalizedMatch": true, "caseInsensitiveMatch": true, "matchOffset": 1700 } ],
    "targetPageMatch": true,
    "anyPageMatch": true
  }
}
```

- **Response 200**: updated `JobStatusResponse`
- **Errors**: 403, 404, 409 (`JOB_NOT_READY` — job must be `completed`), 422 (malformed body)

### Model tests (§2 — Phase 3 provider benchmark)

All routes require `X-Job-Token` for the owning job. `mock` is always available; `anthropic`/
`openai` require `PDFI_ALLOW_EXTERNAL_PROVIDERS=true`, the matching API key env var
(`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`), and `acknowledgeExternalTransfer: true` in the request
body — otherwise `403 EXTERNAL_PROVIDERS_DISABLED` (flag off) or `422 PROVIDER_NOT_CONFIGURED`
(flag on, key missing). Runs execute in-process, asynchronously, via a bounded background queue
(`apps/api/src/lib/background-runner.ts`) — poll `GET .../:runId` for progress.

#### `POST /api/v1/jobs/:jobId/model-tests`

Creates a run (`ModelTestRequest`: `providers`, `conditions` — a `BenchmarkCondition[]` or the
literal `"all"` — `repeats` (≤ `PDFI_MODEL_TEST_MAX_REPEATS`, default 10), `outerPrompt` (optional,
defaults to the PRD §21.3 prompt), `acknowledgeExternalTransfer`). One condition PDF is generated
per requested `BenchmarkCondition` (`original`, `white_text`, `render_mode_3`,
`visible_positive_control`, `xmp_only`, `unicode_tags`, plus the four round-3 probe conditions
`image_only`, `freetext_annot`, `acroform_field`, `info_dict` — 10 total, `ALL_CONDITIONS` in
`packages/benchmark/src/config.ts`) and cached for reuse across repeats/providers. A
`conditions: "all"` run now costs ~1.67× what it did before round 3 (10 conditions vs. the
previous 6).

- **Response 202** (`CreateRunResponse`): `{ "runId": "uuid", "status": "queued", "totalCalls": 10 }`
- **Errors**: 403 (`JOB_FORBIDDEN`/`EXTERNAL_PROVIDERS_DISABLED`), 404 (`JOB_NOT_FOUND`), 422
  (`VALIDATION_ERROR`/`PROVIDER_NOT_CONFIGURED`), 504 (`PROCESSING_TIMEOUT`). Answers are scored
  against the job's `expectedSignals`, so a job generated without any is rejected with
  `422 VALIDATION_ERROR` (regenerate with at least one signal).

#### `GET /api/v1/jobs/:jobId/model-tests`

Lists runs for the job (`{ "runs": ModelTestRunListItem[] }` — id, `status`, `progress`, config
summary; no results/aggregates).

#### `GET /api/v1/jobs/:jobId/model-tests/:runId`

Returns the full `ModelTestRun`: per-call `results[]` (raw response, per-signal `signalMatches`,
`disclosure`, `refusal`, latency, token usage, or `error`), `aggregates[]` (per
provider/condition: `allSignalsRate`, `anySignalRate`, `disclosureRate`, `refusalRate`,
`meanLatencyMs`, `deltaVsOriginalPp`), `smokeTestGate` (PRD §23.2 — see
[`docs/research-protocol.md`](research-protocol.md#interpreting-the-smoke-test-gate)), and a fixed
non-overclaiming `interpretation` string (never "AI detected").

- **Errors**: 403, 404 (`JOB_NOT_FOUND`/`RUN_NOT_FOUND`)

#### `GET /api/v1/jobs/:jobId/model-tests/:runId/export?format=json|csv&includeRaw=true|false`

Downloads the run as `application/json` or `text/csv`
(`Content-Disposition: attachment; filename="..."`). `includeRaw=true` includes each call's raw
provider response text; omitted/`false` excludes it. When `PDFI_RESEARCH_RESULTS_DIR` is set, the
same export is also copied there (see [`research/results/README.md`](../research/results/README.md)).

- **Errors**: 403, 404, 409 (`RUN_NOT_READY` — run must be `completed`/`failed`/`cancelled`)

#### `DELETE /api/v1/jobs/:jobId/model-tests/:runId`

Cancels an in-flight run (if running) and deletes it. Idempotent-in-effect: a second delete on the
same id returns `404`.

- **Response 204** — **Errors**: 403, 404 (`RUN_NOT_FOUND`)

### Robustness (§4 — Phase 5 transform survival)

All routes require `PDFI_RESEARCH_MODE=true` (else `403 RESEARCH_MODE_DISABLED`) and `X-Job-Token`.

#### `POST /api/v1/jobs/:jobId/robustness`

Creates a run (`RobustnessRequest`: `pdfTransforms` — any of `print_to_pdf`, `ocr_regeneration`,
`screenshot_ocr`; `textTransforms` — any of `paraphrase`, `translation`, `human_edit`;
`textSource` — `{kind:"model_test_run",runId}` or `{kind:"custom",texts:[...]}`; `providers`;
`repeats`; `seed`; `acknowledgeExternalTransfer`). Each PDF transform re-derives the output PDF
(print-to-PDF / OCR-regeneration rasterize every page and rebuild it as an image, discarding any
text-layer payload; OCR-regeneration then re-adds an invisible OCR'd text layer) and records
whether the expected signals still extract afterward. Text transforms run `paraphrase`/
`human_edit` with deterministic seeded local fallbacks (no provider required); `translation` has
**no local fallback** and requires a configured, allowed provider — `available: false` with a
`reason` otherwise.

- **Response 202** (`CreateRunResponse`)
- Text transforms score expected-signal survival, so a request with a non-empty `textTransforms`
  on a job generated without `expectedSignals` is rejected with `422 VALIDATION_ERROR`; PDF
  transforms only re-extract the hidden instruction and still run for such jobs.
- **Errors**: 403 (`RESEARCH_MODE_DISABLED`/`JOB_FORBIDDEN`/`EXTERNAL_PROVIDERS_DISABLED`), 404,
  422 (`VALIDATION_ERROR`/`OCR_UNAVAILABLE`/`CANVAS_UNAVAILABLE`/`PROVIDER_NOT_CONFIGURED`)

#### `GET /api/v1/jobs/:jobId/robustness`

Lists runs for the job.

#### `GET /api/v1/jobs/:jobId/robustness/:runId`

Returns the full `RobustnessRun`: `pdfResults[]` (per transform: `available`, `outputSha256`,
`extraction`, `geometryPreserved`, `ocrConfidence?`), `textResults[]` (per transform+provider:
`samples[]`, `survivalRate`), and a plain-language `summary` string. A transform that couldn't run
(missing canvas/OCR capability, or a text transform without a provider) is recorded as
`available: false` with a `reason` — never silently omitted.

- **Errors**: 403, 404 (`JOB_NOT_FOUND`/`RUN_NOT_FOUND`)

#### `GET /api/v1/jobs/:jobId/robustness/:runId/artifacts/:transform`

Downloads the PDF transform's output artifact (`application/pdf`) for manual inspection.

- **Errors**: 403, 404

#### `POST /api/v1/jobs/:jobId/robustness/screenshots`

Multipart upload (`files[]`) of screenshot images (PNG/JPG); runs OCR (`tesseract.js`) on each and
returns a `ScreenshotOcrResult[]` (extracted text, signal-extraction result, OCR confidence) —
simulates a "screenshot of the rendered PDF" ingestion path without a full run/runId lifecycle.

- **Errors**: 403 (`RESEARCH_MODE_DISABLED`), 404, 422 (`OCR_UNAVAILABLE`/`VALIDATION_ERROR`)

#### `DELETE /api/v1/jobs/:jobId/robustness/:runId`

Cancels (if running) and deletes the run and its artifacts.

- **Response 204** — **Errors**: 403, 404 (`RUN_NOT_FOUND`)

### Variant sets and student-keyed sets (§1)

These two resource families are **not** scoped under `/jobs/:jobId` — each `POST` creates its own
set (and one underlying job per variant/student) and returns its own `accessToken`, sent as
`X-Job-Token` on every subsequent request for that set id. They do **not** require
`PDFI_RESEARCH_MODE` (assignment-level A/B variant distribution is a Phase 1 feature, not a
research-only one) — only §3/§4 (submissions, robustness) do.

#### `POST /api/v1/variant-sets`

`multipart/form-data`: `file` (source PDF), `variants` (JSON `VariantSpec[]` — `label`,
`instruction`, `expectedSignals` — may be `[]`, same optionality as `POST /jobs`), `injectionMode`, plus the same optional injection-settings
fields as `POST /jobs` (`targetPage`/`position`/`x`/`y`/`fontSize`/`maxWidth`/`payloadLanguage`/
`acknowledgedWarnings`). Creates one job per variant, sharing the same source PDF.

- **Response 201** (`VariantSetResponse`): `variantSetId`, `accessToken`, `sourceSha256`,
  `variants[]` (label, jobId, per-variant `accessToken`, status, errorCode)
- **Errors**: 400/413/422 (as `POST /jobs`), 422 (`TOO_MANY_VARIANTS`)

#### `GET /api/v1/variant-sets/:id`

Returns the set with each variant's current `summary` (`ValidationSummary`).

#### `POST /api/v1/variant-sets/:id/distribution`

Body (`DistributionRequest`): `studentIds`, `strategy` (`"round_robin"` or `"seeded_hash"`),
optional `seed`. `round_robin` cycles through variants in array order; `seeded_hash` derives each
student's variant deterministically from `hash(seed + studentId)`, so the same
`(seed, studentIds, variants)` always reproduces the same assignment. Returns
`DistributionResponse`: `assignments[]` (`studentId`, `label`, `jobId`) and `counts` (per-label
totals, for eyeballing balance).

#### `GET /api/v1/variant-sets/:id/distribution?format=csv`

Re-fetches the last computed distribution as JSON, or as `text/csv` when `format=csv`.

#### `GET /api/v1/variant-sets/:id/archive`

Downloads every variant's `output.pdf`, renamed `<label>.pdf`, as one `application/zip`
(`fflate`-built, streamed via `Content-Disposition: attachment`).

#### `DELETE /api/v1/variant-sets/:id`

Deletes the set, every member job, and their artifacts.

- **Response 204** — **Errors**: 403, 404 (`VARIANT_SET_NOT_FOUND`)

#### `POST /api/v1/student-keyed-sets`

`multipart/form-data`: `file`, `instructionTemplate`, `expectedSignals` (optional, default `[]`), `studentIds` (JSON
`string[]`), `injectionMode`, `keyLength` (optional), plus the same injection-settings fields.
Generates one job per student, each with a unique random key embedded via the instruction
template (e.g. a per-student token appended to the hidden instruction) — used to trace which
student's copy a signal match came from without publishing a student roster inside any variant
label.

- **Response 201** (`StudentKeyedSetResponse`): `setId`, `accessToken`, `students[]` (`studentId`,
  `key`, `jobId`, per-student `accessToken`, `status`)
- **Errors**: 400/413/422 (as `POST /jobs`), 422 (`TOO_MANY_STUDENTS`)

#### `GET /api/v1/student-keyed-sets/:id`

Returns the set (student list, without keys re-exposed beyond what's needed to poll each job).

#### `GET /api/v1/student-keyed-sets/:id/mapping`

**Private, CSV-only** — `studentId,key,jobId,outputSha256`. This is the one artifact that lets a
professor trace a later signal match back to a specific student; it is never returned as JSON and
carries the same "do not distribute" expectation as the private manifest (see
[`docs/ethics-and-privacy.md`](ethics-and-privacy.md)).

#### `GET /api/v1/student-keyed-sets/:id/archive`

Downloads every student's `output.pdf`, renamed `<studentId>.pdf`, as one `application/zip`.

#### `DELETE /api/v1/student-keyed-sets/:id`

Deletes the set, every member job, and their artifacts.

- **Response 204** — **Errors**: 403, 404 (`VARIANT_SET_NOT_FOUND`)

### Submissions (§3 — Phase 4 submission-side detection, research only)

All routes require `PDFI_RESEARCH_MODE=true` (else `403 RESEARCH_MODE_DISABLED`) and `X-Job-Token`
for the owning job. **No real student data**: `POST /submissions` requires
`acknowledgeNoRealStudentData: true` on every request — see
[`docs/ethics-and-privacy.md`](ethics-and-privacy.md).

#### `POST /api/v1/jobs/:jobId/submissions`

`multipart/form-data`: either `file` (`.txt`/`.md`/`.pdf`/`.png`/`.jpg`, magic-bytes/extension
checked) or `text` (one of the two is required), `label` (`"candidate"` or `"baseline"`),
`acknowledgeNoRealStudentData`. Image uploads run OCR (`tesseract.js`) to extract text first
(`422 OCR_UNAVAILABLE` if OCR isn't available). Runs `packages/detector`'s deterministic matchers
against the job's `ExpectedSignal[]`, groups them (`methodology`/`lexical`/`structural`), scores
them, and calibrates against every `"baseline"`-labeled submission already stored for the job
(Fisher's exact test + Holm-Bonferroni correction across signals — see
[`docs/research-protocol.md`](research-protocol.md#submissions-calibration--statistics-3--prd-26-phase-4)). Returns
a `SubmissionAnalysis` with a fixed, non-overclaiming `interpretation` (never "AI cheating
detected" — see [`docs/ethics-and-privacy.md`](ethics-and-privacy.md)).

- **Response 201** (`SubmissionAnalysis`)
- **Errors**: 403 (`RESEARCH_MODE_DISABLED`), 404, 413 (`FILE_TOO_LARGE`), 415
  (`UNSUPPORTED_MEDIA_TYPE`), 422 (`VALIDATION_ERROR`/`OCR_UNAVAILABLE`). A job generated without
  `expectedSignals` has nothing to score against and is rejected with `422 VALIDATION_ERROR`.

#### `GET /api/v1/jobs/:jobId/submissions`

Returns `SubmissionListResponse`: every stored `SubmissionAnalysis` for the job, plus
`calibrationSummary` and `statistics` (candidate-vs-baseline rates, per-signal Fisher/Holm
results) recomputed across the current stored set.

#### `GET /api/v1/jobs/:jobId/submissions/statistics`

Returns just the `SubmissionStatistics` object (same shape as `GET /submissions`'s `statistics`
field) — a lighter poll target for a UI that only needs to redraw the stats panel.

#### `GET /api/v1/jobs/:jobId/submissions/:submissionId`

Returns one `SubmissionAnalysis`.

- **Errors**: 403, 404 (`JOB_NOT_FOUND`/`SUBMISSION_NOT_FOUND`)

#### `DELETE /api/v1/jobs/:jobId/submissions/:submissionId`

Deletes one stored submission and recalculates the job's calibration baseline going forward.

- **Response 204** — **Errors**: 403, 404 (`SUBMISSION_NOT_FOUND`)

### `DELETE /api/v1/jobs/:jobId`

Deletes the job's source PDF, output PDF, manifest, validation report, and the SQLite row —
cascading to any model-test runs, robustness runs, and submissions scoped to that job.
Idempotent (a second `DELETE` on an already-deleted job returns `404`).

- **Headers**: `X-Job-Token`
- **Response 204**
- **Errors**: 403 (wrong token), 404

---

## Data models (`packages/contracts/src/*.ts`)

```ts
export type InjectionMode = "white_text" | "render_mode_3" | "visible_positive_control" | "xmp_only" | "unicode_tags"
  // Round-3 research/diagnostic probe conditions — not production channels:
  | "image_only" | "freetext_annot" | "acroform_field" | "info_dict";
export type PayloadLanguage = "en" | "ko";
export type TargetPage = number | "first" | "last";        // number is 1-based from the API, 0-based `pageIndex` internally
export type Position = "top" | "bottom" | "custom";
export type JobStatus = "queued" | "processing" | "completed" | "failed";
export type OverallStatus = "PASS" | "PASS_WITH_WARNINGS" | "FAIL" | "NOT_TESTED";
export type QpdfStatus = "not_run" | "passed" | "warning" | "failed";
// §1-4 research-scoped unions (see packages/contracts/src/types-research.ts and the
// Model tests / Robustness / Variant sets / Submissions sections above):
export type BenchmarkCondition = "original" | InjectionMode;
export type ProviderName = "anthropic" | "openai" | "mock";
export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type SubmissionLabel = "candidate" | "baseline";
export type PdfTransform = "print_to_pdf" | "ocr_regeneration" | "screenshot_ocr";
export type TextTransform = "paraphrase" | "translation" | "human_edit";
export type DistributionStrategy = "round_robin" | "seeded_hash";

export type ExpectedSignal =
  | { type: "exact_phrase"; value: string; caseSensitive: boolean }
  | { type: "regex"; pattern: string; flags: string }
  | { type: "methodology_label"; value: string; aliases: string[] }
  | { type: "ordered_terms"; values: string[] }
  | { type: "section_order"; values: string[] };

export interface PageGeometry {
  pageIndex: number;
  mediaBox: [number, number, number, number];
  cropBox: [number, number, number, number];
  rotation: number;
  width: number;
  height: number;
}

export interface ValidationWarning { code: string; message: string; pageIndex?: number }

export interface LintIssue { id: string; severity: "error" | "warning"; message: string }

export interface ValidationSummary {
  outputLoadPassed: boolean;
  pdfJsRenderPassed: boolean | null;        // null until client validation posted
  pageCountPreserved: boolean;
  pageGeometryPreserved: boolean;
  hiddenTextExtracted: boolean;             // server-side pdfjs-dist getTextContent on target page
  changedPixelRatio: number | null;         // null until client validation posted
  qpdfStatus: QpdfStatus;
  metadataPayloadPresent: boolean | null;   // null for drawn-text modes; boolean for xmp_only
  overall: OverallStatus;
}

export interface JobRecord {
  id: string;
  status: JobStatus;
  sourceFilename: string;
  sourceSha256: string;
  outputSha256: string | null;
  promptSha256: string;
  injectionMode: InjectionMode;
  targetPage: number;                       // resolved 0-based index
  createdAt: string;
  expiresAt: string;
  errorCode: string | null;
}
// bun:sqlite never stores the instruction text — only promptSha256. The prompt text
// exists only inside the manifest.json artifact file.

// We never execute any of the following — they are surfaced as warnings only
// (PDF_CONTAINS_JAVASCRIPT / PDF_CONTAINS_EMBEDDED_FILES / PDF_CONTAINS_EXTERNAL_URIS / PDF_HAS_OPEN_ACTION).
export interface SourceRiskFlags {
  javascript: boolean;
  embeddedFiles: boolean;
  externalUriCount: number;
  openAction: boolean;
}

export interface SourceInspection {
  filename: string;
  sizeBytes: number;
  sha256: string;
  pageCount: number;
  encrypted: boolean;
  signed: boolean;
  pdfVersion: string | null;
  pages: PageGeometry[];
  riskFlags: SourceRiskFlags;
}

export interface PrivateManifest {
  schemaVersion: "0.2";
  jobId: string;
  sourceFile: { name: string; sha256: string; sizeBytes: number };
  outputFile: { name: string; sha256: string; sizeBytes: number };
  prompt: { sha256: string; instruction: string; normalizedInstruction: string; language: PayloadLanguage; length: number };
  expectedSignals: ExpectedSignal[];
  injection: { mode: InjectionMode; pageIndex: number; position: Position; fontSize: number; boundingBox: [number, number, number, number] };
  validation: ValidationSummary;
  toolVersions: { bun: string; pdfLib: string; pdfJs: string; qpdf: string | null; pdfInjection: string };
  createdAt: string;
  warning: "PRIVATE — contains the hidden instruction. Do not distribute to students.";
}

export interface ValidationReport {
  schemaVersion: "0.2";
  jobId: string;
  createdAt: string;
  updatedAt: string;
  source: SourceInspection;
  output: { sha256: string; sizeBytes: number; pageCount: number; pages: PageGeometry[]; fileSizeDelta: number };
  injection: PrivateManifest["injection"];
  serverValidation: {
    outputLoad: { passed: boolean; error?: string };
    pageCount: { passed: boolean; before: number; after: number };
    geometry: { passed: boolean; mismatches: Array<{ pageIndex: number; field: string; before: unknown; after: unknown }> };
    textExtraction: {                       // server-side pdfjs-dist legacy build
      pdfJsVersion: string;
      pages: Array<{ pageIndex: number; textLength: number; exactMatch: boolean; normalizedMatch: boolean; caseInsensitiveMatch: boolean; matchOffset: number | null }>;
      targetPageMatch: boolean;
      anyPageMatch: boolean;
    };
    qpdf: { status: QpdfStatus; exitCode: number | null; stdout: string; stderr: string; warningCount: number; errorCount: number } | null;
    metadata: { xmpPresent: boolean; payloadFound: boolean; sha256OfPayload: string | null }; // checkMetadataPayload() result; {false,false,null} for non-xmp_only modes
    warnings: ValidationWarning[];          // e.g. BACKGROUND_NOT_WHITE, ACCESSIBILITY_HIDDEN_TEXT, UNICODE_TAGS_NOT_EXTRACTABLE (unicode_tags mode only),
                                             // IMAGE_ONLY_NOT_TEXT_EXTRACTABLE / FREETEXT_ANNOT_NOT_EXTRACTABLE /
                                             // ACROFORM_FIELD_NOT_EXTRACTABLE / INFO_DICT_NOT_EXTRACTABLE (their own mode only — round-3 probes)
  };
  clientValidation: ClientValidationInput | null;
  summary: ValidationSummary;
  lint: { errors: LintIssue[]; warnings: LintIssue[]; acknowledged: string[] };
  disclaimer: "PDF.js parser view — may differ from actual LLM provider ingestion.";
}

export interface ClientValidationInput { /* see POST client-validation body above */ }
export interface CreateJobResponse { jobId: string; accessToken: string; status: JobStatus; errorCode: string | null; lintWarnings: LintIssue[] }
export interface JobStatusResponse { jobId: string; status: JobStatus; errorCode: string | null; sourceFilename: string; injectionMode: InjectionMode; targetPage: number; createdAt: string; expiresAt: string; summary: ValidationSummary | null; artifacts: { outputPdf: boolean; privateManifest: boolean; validationReport: boolean } }
export interface ApiError { error: { code: ApiErrorCode; message: string; details?: Record<string, unknown> } }
```

## `overall` computation (`packages/contracts/src/overall.ts`)

```text
FAIL               if !outputLoadPassed || !pageCountPreserved || !pageGeometryPreserved || pdfJsRenderPassed === false
                   || (mode === white_text && !hiddenTextExtracted)
                   || (mode === xmp_only && metadataPayloadPresent !== true)
                   || (changedPixelRatio !== null && changedPixelRatio > threshold(mode))
NOT_TESTED         if pdfJsRenderPassed === null (client validation not yet posted)
PASS_WITH_WARNINGS if any serverValidation.warnings, qpdfStatus === "warning", or
                   (mode in {render_mode_3, unicode_tags, image_only, freetext_annot, acroform_field, info_dict} && !hiddenTextExtracted)
PASS               otherwise

threshold(white_text) = 1e-5 (0.001%)
threshold(render_mode_3) = 1e-7 (0.00001%)
threshold(visible_positive_control) = Infinity
threshold(xmp_only) = 1e-7 (0.00001%) — no page content is touched, so any pixel diff at all is unexpected
threshold(unicode_tags) = 1e-7 (0.00001%) — same zero-ink tier as render_mode_3 (nothing painted)
threshold(image_only) = Infinity — deliberately visible, like visible_positive_control (round-3 probe)
threshold(freetext_annot) = 1e-7 (0.00001%) — the annotation's own appearance draws under invisible render mode 3; nothing is painted on the page
threshold(acroform_field) = 1e-7 (0.00001%) — same as freetext_annot, for the widget's own appearance
threshold(info_dict) = 1e-7 (0.00001%) — no page content is touched, like xmp_only

Note: xmp_only never draws page text, so hiddenTextExtracted is not part of its FAIL condition —
metadataPayloadPresent (checkMetadataPayload() against the output's XMP stream) is the equivalent
signal for this mode.

Note: unicode_tags's hiddenTextExtracted is ALWAYS false via this app's own PDF.js-based
extraction (deterministic — pdfjs-dist filters Unicode General Category "Cf" characters, and the
whole Unicode Tags block is Cf), treated the same "recorded, never required for FAIL" way as
render_mode_3's. The payload's actual presence is instead verified server-side via a CMap
read-back independent of pdfjs (packages/pdf-engine's readUnicodeTagsPayload()) — a genuine
absence hard-fails the job with INJECTION_FAILED, and a present-but-unextractable payload (the
normal case) is recorded as a serverValidation.warnings entry, code
UNICODE_TAGS_NOT_EXTRACTABLE. See
[`docs/validation.md`](validation.md#unicode_tags-verification-independent-of-pdfjs).

Note: the four round-3 probe modes (image_only, freetext_annot, acroform_field, info_dict) get the
exact same "recorded, never required for FAIL" hiddenTextExtracted treatment, for the same reason —
each one is deterministically unextractable by this app's own PDF.js-based extractText() by
construction (no text object at all for image_only; an annotation/widget appearance stream or the
/Info dictionary, neither of which extractText() ever inspects, for the other three). Each mode's
own reader (readStampedImagePresence / readFreetextAnnotPayload / readAcroFormFieldPayload /
readInfoDictPayload, all in packages/pdf-engine, all independent of pdfjs-dist) is the
post-injection correctness gate instead — a genuine absence hard-fails the job with
INJECTION_FAILED, same as unicode_tags; the normal (present-but-unextractable) case is recorded via
one warning code per mode (IMAGE_ONLY_NOT_TEXT_EXTRACTABLE / FREETEXT_ANNOT_NOT_EXTRACTABLE /
ACROFORM_FIELD_NOT_EXTRACTABLE / INFO_DICT_NOT_EXTRACTABLE). See
[`docs/validation.md`](validation.md#round-3-probe-modes-verification-independent-of-pdfjs).
```

## Notes

- Filenames are sanitized (`[^A-Za-z0-9._-]` → `_`, max 100 chars, no extension) by
  `sanitizeFilenameStem()`; storage paths are `PDFI_STORAGE_DIR/<jobId>/{source.pdf,output.pdf,manifest.json,report.json}`
  — the client never supplies a path segment, and `:jobId` is validated as a UUID v4 before any
  path is built from it.
- Instruction text is never written to server logs — only `promptSha256` is logged.
- CORS is restricted to `PDFI_CORS_ORIGIN` (default `http://localhost:5173`), `credentials: false`,
  with `X-Job-Token` in the allowed headers list.
- Every response carries `Content-Security-Policy: default-src 'self'`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and
  `X-Frame-Options: DENY`.
- Model-test/robustness runs execute in-process asynchronously (`status: "queued" | "running" |
  "completed" | "failed" | "cancelled"`) via `apps/api/src/lib/background-runner.ts`'s bounded
  concurrency queue, persisted to their own `model_test_runs`/`robustness_runs` sqlite tables
  (`apps/api/src/repositories/runs.repository.ts`) with `job_id ... REFERENCES jobs(id) ON DELETE
  CASCADE` — deleting a job also deletes its runs. This is unlike `POST /jobs` itself, which still
  processes synchronously (see [`docs/architecture.md`](architecture.md#architecture-decision-synchronous-processing-no-queue-post-jobs-only)).
- Submission keys, hidden instructions, and per-student mapping data (student-keyed-sets'
  `studentId,key,jobId,outputSha256` mapping) are never logged server-side and never stored
  outside their own sqlite tables / per-set `mapping.json` file — see
  [`docs/ethics-and-privacy.md`](ethics-and-privacy.md).
