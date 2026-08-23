# Validation

PDF Injection validates every generated PDF along two tracks: **server-side** validation, which
runs synchronously as part of `POST /api/v1/jobs`, and **client-side** validation, which the
browser computes and posts back via `POST /api/v1/jobs/:jobId/client-validation`. Both are merged
into `ValidationSummary.overall` (see [`docs/api.md`](api.md#overall-computation-packagescontractssrcoverallts)).

## Server-side steps (`apps/api/src/services/job.service.ts`, `packages/pdf-engine`, `packages/validation`)

### 1. Source validation (`inspectSource()`)

Runs before injection, on the raw upload:

- PDF magic bytes (`%PDF-`) and MIME check
- File size vs. `PDFI_MAX_FILE_BYTES`
- Parse with `pdf-lib`
- Encryption detection (`PDF_ENCRYPTED`)
- Digital signature detection — `/Sig` field, or `/DocMDP`/`/UR3` in the catalog `/Perms` (`PDF_SIGNED`)
- Page count vs. `PDFI_MAX_PAGES` (`TOO_MANY_PAGES`)
- Page geometry snapshot (MediaBox, CropBox, rotation, width, height) per page, used later as the
  "before" side of the round-trip comparison
- Page dimension sanity check vs. `PDFI_MAX_PAGE_DIMENSION_PT` (`INVALID_PDF`)
- Risk-flag detection (`SourceInspection.riskFlags`): JavaScript, embedded files, external URIs
  (including nested/inline actions), and an `/OpenAction` in the source PDF. None of these block
  the job — PDF Injection never executes anything from the source PDF — they are surfaced as
  `PDF_CONTAINS_JAVASCRIPT` / `PDF_CONTAINS_EMBEDDED_FILES` / `PDF_CONTAINS_EXTERNAL_URIS` /
  `PDF_HAS_OPEN_ACTION` warnings in `result.warnings` so the professor can see them before
  distributing the injected PDF to students.

### 2. Prompt lint (`lintPrompt()`, `packages/prompt-lint`)

Runs on the instruction + expected signals before injection is attempted. **Errors** block job
creation entirely (`PROMPT_TOO_LONG`, `PROMPT_ENCODING_FAILED`, `PROMPT_LINT_ERROR`); **warnings**
(fake citation, fabricated facts, disclose-instruction phrasing, jailbreak-style phrasing,
grading-distortion phrasing, overly long signal values, common/generic signal words,
possibly-inappropriate methodology hints) do not block the job but are recorded in
`ValidationReport.lint.warnings` and must be explicitly acknowledged by the professor in the UI.

### 3. Output round-trip validation

After `injectPdf()` produces `output.pdf`:

- The output is reloaded with `pdf-lib` (`outputLoad.passed`)
- Page count is compared against the source (`pageCount.passed`)
- Page geometry (MediaBox, CropBox, rotation, width, height, per page) is compared against the
  pre-injection snapshot via `compareGeometry()` (`geometry.passed`, with a list of any
  `mismatches`)
- A `GEOMETRY_CHANGED` hard-gate error is raised if geometry changed unexpectedly

### 4. XMP metadata payload check (`checkMetadataPayload()`, `packages/validation` — `xmp_only` mode only)

`xmp_only` never touches any page's content stream — the instruction is written to the PDF
catalog's `/Metadata` XMP stream only, so ordinary page-text extraction (step 5 below) will never
find it there, by design. Instead, immediately after injection and before text extraction runs,
`checkMetadataPayload()` re-parses the output's XMP metadata and confirms the (normalized)
instruction is present, recording the full result at
`ValidationReport.serverValidation.metadata: { xmpPresent, payloadFound, sha256OfPayload }` and
mirroring `payloadFound` into `ValidationSummary.metadataPayloadPresent: boolean` for every mode's
top-level summary. For every mode other than `xmp_only`, `metadata` is `{ xmpPresent: false,
payloadFound: false, sha256OfPayload: null }` and `metadataPayloadPresent` is `null` (not
applicable — those modes never write to XMP metadata at all). `computeOverall()` treats
`metadataPayloadPresent !== true` on `xmp_only` as a `FAIL` condition, the same role
`hiddenTextExtracted` plays for `white_text` — see
[`docs/api.md`](api.md#overall-computation-packagescontractssrcoverallts).

The round-3 probe mode `info_dict` (below) is a **different, unrelated channel**: it writes to the
classic `/Info` dictionary (`Subject`/`Keywords`), not the XMP `/Metadata` stream this step checks,
so `metadata`/`metadataPayloadPresent` stay at their non-`xmp_only` defaults for `info_dict` too —
its own payload is verified by `readInfoDictPayload()` instead, described below.

### 5. PDF.js text validation (`extractText()`, `packages/validation`)

Runs `pdfjs-dist`'s legacy build under Bun (server-side) and calls `getTextContent()` per page of
the **output** PDF. For each page it records:

- Extracted text length
- Exact match, whitespace-normalized match, and case-insensitive match against the normalized
  instruction
- The character offset where the instruction was found (if any)
- Whether the **target page** specifically matched, and whether **any** page matched

For `unicode_tags` and the four round-3 probe modes (`image_only`, `freetext_annot`,
`acroform_field`, `info_dict`), this step **always** reports no match (`hiddenTextExtracted: false`,
`targetPageMatch: false`) — deterministically, not merely uncertainly. See
[unicode_tags: verification independent of PDF.js](#unicode_tags-verification-independent-of-pdfjs)
and [Round-3 probe modes: verification independent of PDF.js](#round-3-probe-modes-verification-independent-of-pdfjs)
below for why, and for how each mode's payload is actually verified instead.

The web app's Extracted Text tab shows the equivalent client-side result and always displays:

> PDF.js parser view — may differ from actual LLM provider ingestion.

OpenAI, Anthropic, and other providers' PDF ingestion pipelines may combine text extraction and
visual/vision-based page analysis differently depending on product, plan, and API — a local
parser result never confirms what an actual provider model receives as input.

### `unicode_tags`: verification independent of PDF.js

`pdfjs-dist`'s `getTextContent()` unconditionally filters out every glyph whose `/ToUnicode`
target is Unicode General Category "Cf" (Format), and the entire Unicode Tags block
(U+E0000–U+E007F) is category Cf by definition — so step 5 above can **never** surface a
`unicode_tags` payload, on any input, regardless of which target string is searched for. This is
a deterministic property of this app's own PDF.js-based extraction, verified by direct repro
against `tests/fixtures/five-page-text.pdf` (injection succeeds, geometry stays byte-identical,
the output's `/ToUnicode` CMap carries the tag-encoded payload, yet `extractText()` reports no
match on the target page for either the encoded or the plain instruction). It is why
`computeOverall()` treats `unicode_tags`'s `hiddenTextExtracted` exactly like `render_mode_3`'s
(recorded, never required for `FAIL`) — every `unicode_tags` job is `PASS_WITH_WARNINGS`, never
plain `PASS`.

Because step 5 structurally cannot confirm this mode, `job.service.ts` instead calls
`packages/pdf-engine`'s `readUnicodeTagsPayload()` — a public-`pdf-lib`-API CMap read-back run
directly on the output bytes, independent of `pdfjs-dist` — immediately after injection:

- If the payload is genuinely absent from the output's `/ToUnicode` CMap, job creation hard-fails
  with `INJECTION_FAILED` (same hard-gate pathway as `GEOMETRY_CHANGED`: a job row with
  `status: "failed"` is still created and the `POST /jobs` response is still `201`) — a real
  correctness gate on the injector's own output, not a workaround for PDF.js's limitation.
- Otherwise (the normal case), a `ValidationWarning` with `code: "UNICODE_TAGS_NOT_EXTRACTABLE"`
  is added to `ValidationReport.serverValidation.warnings`, explaining that the payload is
  present in the file but invisible to this project's own PDF.js-based text extraction, and that
  provider-side visibility — what the Model Test benchmark measures — is unaffected by this.

### Round-3 probe modes: verification independent of PDF.js

`image_only`, `freetext_annot`, `acroform_field`, and `info_dict` are round-3
research/diagnostic probe conditions (not production channels — see
[`README.md`](../README.md#injection-modes)). Each one is **deterministically** invisible to step 5
above, for its own structural reason, not merely uncertain:

- `image_only` writes **no text object of any kind** to the page — the instruction is rasterized
  to a PNG and stamped as an image XObject. `extractText()` (or any text extractor) has nothing to
  walk.
- `freetext_annot` and `acroform_field` draw the instruction as real, invisible (`3 Tr`) text
  inside a FreeText annotation's or an AcroForm text-field widget's own `/AP /N` appearance stream
  — never the page's own content stream. `extractText()`'s `getTextContent()` only ever walks a
  page's content stream, never an annotation's or widget's appearance stream, so it structurally
  cannot see either payload — regardless of the fact that the text itself is real and drawn, unlike
  `unicode_tags`' CMap remapping. (A poppler-family extractor such as `pdftotext` walks an
  annotation/widget's appearance-stream operators the same way it walks page content, so it **is**
  expected to surface both — measured directly against this project's own injector output with
  poppler 26.08.0: `pdftotext` finds both payloads, `pdfinfo` finds neither.)
- `info_dict` writes the instruction only to the classic `/Info` dictionary's `Subject`/`Keywords`
  fields — document metadata, not page text or the XMP stream. `extractText()` never inspects
  `/Info` at all. (Measured the same way: poppler's `pdfinfo` surfaces it, `pdftotext` does not.)

Because step 5 structurally cannot confirm any of these four, `job.service.ts` calls each mode's
own dedicated reader — all in `packages/pdf-engine`, all independent of `pdfjs-dist` — immediately
after injection, the same pattern `readUnicodeTagsPayload()` established:

| Mode | Reader | Warning code (present-but-unextractable case) |
|---|---|---|
| `image_only` | `readStampedImagePresence()` | `IMAGE_ONLY_NOT_TEXT_EXTRACTABLE` |
| `freetext_annot` | `readFreetextAnnotPayload()` | `FREETEXT_ANNOT_NOT_EXTRACTABLE` |
| `acroform_field` | `readAcroFormFieldPayload()` | `ACROFORM_FIELD_NOT_EXTRACTABLE` |
| `info_dict` | `readInfoDictPayload()` | `INFO_DICT_NOT_EXTRACTABLE` |

If a reader finds the payload genuinely absent, job creation hard-fails with `INJECTION_FAILED`
(same hard-gate pathway as `GEOMETRY_CHANGED`/`unicode_tags`'s own gate — a job row with
`status: "failed"` is still created and the `POST /jobs` response is still `201`). Otherwise (the
normal case), the corresponding `ValidationWarning` above is added to
`ValidationReport.serverValidation.warnings`, explaining that the payload is present but invisible
to this project's own PDF.js-based extraction, and that provider-side visibility — what the Model
Test benchmark measures, once run — is unaffected by this. `computeOverall()` treats all four
modes' `hiddenTextExtracted` exactly like `unicode_tags`'/`render_mode_3`'s: recorded, never part
of `FAIL` — see [`docs/api.md`](api.md#overall-computation-packagescontractssrcoverallts).

`image_only` additionally requires `@napi-rs/canvas` at runtime (resolved through `pdfjs-dist`'s
own module root, mirroring `packages/robustness`'s native-canvas resolution — never a top-level
`@napi-rs/canvas` dependency of this package). When the native module can't be resolved, injection
raises `CanvasUnavailableError` (`422 CANVAS_UNAVAILABLE`) as a clean, typed hard-gate failure —
never a silent text-free no-op — on both `POST /jobs` (job creation) and a background model-test
run regenerating an `image_only` condition PDF.

### 6. Visual difference (client-side, posted back to the server)

The browser renders both `source.pdf` and `output.pdf` with the same PDF.js build under identical
conditions (scale 2.0, white background, RGBA canvas) and runs `pixelmatch` per page. Recorded
metrics: changed pixel count, changed pixel ratio, maximum channel delta, mean absolute
difference, a diff image, and a per-page pass/fail against the mode's threshold.

Default thresholds (`packages/contracts/src/overall.ts`, `diffThreshold()`):

| Injection mode | `changedPixelRatio` threshold |
|---|---|
| `white_text` | ≤ 1e-5 (0.001%) |
| `render_mode_3` | ≤ 1e-7 (0.00001%) |
| `visible_positive_control` | no threshold (`Infinity` — the instruction is meant to be visible) |
| `xmp_only` | ≤ 1e-7 (0.00001%) — no page content is touched, so any visible pixel diff at all is unexpected |
| `unicode_tags` | ≤ 1e-7 (0.00001%) — same zero-ink tier as `render_mode_3` (invisible mode 3, nothing painted) |
| `image_only` | no threshold (`Infinity`) — deliberately visible, like `visible_positive_control` (round-3 probe) |
| `freetext_annot` | ≤ 1e-7 (0.00001%) — the annotation's own `/AP /N` appearance draws under invisible render mode 3; nothing is painted on the page |
| `acroform_field` | ≤ 1e-7 (0.00001%) — same as `freetext_annot`, for the widget's own appearance |
| `info_dict` | ≤ 1e-7 (0.00001%) — no page content is touched, like `xmp_only` |

Thresholds are conservative starting points; renderer noise and test-corpus results may warrant
recalibration, but they are not currently configurable via environment variables.

### Processing time limit

The entire `POST /api/v1/jobs` pipeline (steps 1–5 plus manifest/report persistence) is wrapped in
a wall-clock budget: `PDFI_MAX_PROCESSING_MS` (default 60000 ms). If processing has not completed
within that window, the request is aborted with `504 PROCESSING_TIMEOUT` and — unlike a hard-gate
validation failure, which still creates a `status: "failed"` job row so the professor can inspect
the report — **no job row and no artifact files are left behind** at all
(`apps/api/src/lib/time-limit.ts`). This is a safety valve against a pathological input (e.g. an
extremely large or adversarially structured PDF) hanging a request indefinitely, not a normal
code path: a 50-page PDF is expected to finish in single-digit seconds, well under the default
limit (see [`docs/limitations.md`](limitations.md#performance)).

### 7. Optional qpdf validation (`qpdfCheck()`, `packages/validation`)

If `PDFI_QPDF_ENABLED=true` **and** the `qpdf` binary is found on `PATH`, the server runs
`qpdf --check output.pdf` via `Bun.spawn` and records exit code, stdout, stderr, and
warning/error counts. When disabled or the binary is missing, `qpdfCheck()` **never throws** —
it returns `{ status: "not_run" }`, and job processing proceeds normally. A clean qpdf result
(`status: "passed"`) is treated as one additional validation signal, not proof of full PDF-spec
compliance; a `status: "warning"` result contributes to `overall` becoming
`PASS_WITH_WARNINGS`, never `FAIL` on its own.

## Client-side round trip

1. After a job completes, the web app fetches `source.pdf` and `output.pdf` with `X-Job-Token`.
2. It renders both with PDF.js, diffs them with `pixelmatch`, and re-runs `getTextContent()`
   extraction in the browser.
3. It posts a `ClientValidationInput` to `POST /api/v1/jobs/:jobId/client-validation`.
4. The API merges this into `report.json` / `manifest.json` and recomputes `summary.overall`.
5. Until step 3 happens, `pdfJsRenderPassed` and `changedPixelRatio` are `null` and `overall` is
   `NOT_TESTED`.
6. If `renderPassed: false` was reported, `GET /api/v1/jobs/:jobId/output` is blocked with
   `422 RENDER_FAILED` — a PDF that a real PDF.js build could not render is never handed to the
   professor as a "ready" artifact.

## `overall` status values

Only four values are ever shown, everywhere in the UI and reports: `PASS`,
`PASS_WITH_WARNINGS`, `FAIL`, `NOT_TESTED`. See
[`docs/api.md`](api.md#overall-computation-packagescontractssrcoverallts) for the exact formula.

## End-to-end coverage of this pipeline

`tests/e2e` (Playwright, `bun run test:e2e` — see [`README.md`](../README.md#end-to-end-tests))
exercises this entire validation pipeline against live dev servers (`PDFI_RESEARCH_MODE=true`, mock
provider only) across 10 spec files / 11 scenarios. The round-1 `workflow.spec.ts` covers
`white_text` and `render_mode_3`: it uploads a fixture, generates a job, lets the browser compute
and post the client-side render/diff/extraction results, downloads and parses the resulting
`validation-report.json` and `private-manifest.json`, and asserts on the concrete values described
above (e.g. `serverValidation.outputLoad.passed`, `summary.pdfJsRenderPassed`,
`serverValidation.pageCount`/`geometry.passed`, `summary.changedPixelRatio` against the mode's
threshold, and — for `render_mode_3` — that the extraction result is explicitly `true` or `false`,
never omitted). `xmp-only.spec.ts` asserts the `xmp_only`-specific fields
(`serverValidation.metadata.{xmpPresent,payloadFound}`, `summary.metadataPayloadPresent`) directly
against a downloaded report; `korean-payload.spec.ts` asserts `payloadLanguage="ko"` survives the
extraction round-trip (`serverValidation.textExtraction.targetPageMatch: true`); the remaining
specs (`model-test`, `variants`, `student-keyed`, `submissions`, `robustness`,
`robustness-ocr-paraphrase` — `ocr_regeneration` + `paraphrase` on a 1-page fixture, covering the
two transforms `robustness.spec.ts`'s `print_to_pdf` + `human_edit` run doesn't — and
`research-mode-gate`) exercise the §1-4 research flows and the `PDFI_RESEARCH_MODE` gate itself end
to end. Every spec screenshots its validation tabs as evidence. This suite does not replace the
server/browser validation logic described above; it verifies that logic end-to-end.

## Golden tests

`tests/golden` is a separate, faster-running regression layer than `tests/e2e`: for every
`(fixture, injection mode, payloadLanguage)` combination, it re-runs `injectPdf()` /
`extractText()` / `checkMetadataPayload()` directly (no HTTP, no browser) and asserts the current
behavior still matches a committed golden file (`tests/golden/<fixture>.<mode>[.ko].json`). It
also covers the negative fixtures (encrypted/signed/oversized/malformed PDFs) against
`inspectSource()`. Deliberately **not** part of what's asserted: byte-for-byte equality of the
injected PDF output — `pdf-lib`'s output is not guaranteed byte-stable across otherwise-equivalent
runs (e.g. object ordering), so golden files instead record the extracted-text results, geometry,
warnings/`riskFlags`, and (for `xmp_only`) `metadataPayloadPresent` — the properties the tool
actually depends on being stable.

- `bun test` runs `tests/golden/golden.test.ts` like any other suite; a mismatch fails with a
  pointer to `bun run golden:update`.
- After an **intentional** `pdf-engine`/`validation` behavior change, run
  `bun run golden:update` (`scripts/update-golden.ts`) to regenerate every golden file, review the
  diff, and commit it alongside the code change — an unreviewed regeneration silently accepts
  whatever the new behavior produces, so it is a human review step, not a rubber stamp.
- Regeneration is deterministic byte-for-byte except each file's `generatedAt` timestamp
  (verified by a dedicated generator-determinism test in `golden.test.ts`), so a re-run with no
  underlying behavior change produces a diff limited to timestamps.
