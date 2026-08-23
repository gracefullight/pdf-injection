# PDF Injection — PDF-Native Hidden Instruction Authoring and Validation


PDF Injection is a research proof-of-concept tool for professors and academic-integrity /
LLM-ingestion researchers. It lets a professor upload an assignment PDF, write a hidden
instruction and (optionally) expected signals, generate a new PDF with a machine-readable text object
injected into it, and validate that the injected PDF still opens, renders, and looks the same
as the original.

## What this is NOT

PDF Injection is **not** an AI-cheating detector. It never claims, and never will claim, any of
the following:

- "AI cheating detected"
- "Student used ChatGPT"
- "AI-generated assignment confirmed"

If an expected signal is later found in a submission, the only thing that can be said is:

> The submission's characteristics are consistent with a hidden instruction embedded in the
> distributed PDF.

It cannot confirm which model (if any) was used, that a student used AI for the entire answer,
that a policy was intentionally violated, or that AI-written text was left unedited. A signal
match must never be used as sole disciplinary evidence — see
[`docs/ethics-and-privacy.md`](docs/ethics-and-privacy.md).

PDF Injection is also not designed to evade detection. Independent metamorphic-detection research
(PhantomLint) reports 100% recall and a 0.092% false-positive rate against exactly the two
hidden-instruction modes this tool actually works with, `white_text` and `render_mode_3` — meaning
a canary authored with this tool is discoverable by anyone who checks, not only by the professor
who embedded it. That is a property of the design, not a gap to be fixed: the private manifest is
recorded before distribution, the injection mode is disclosed in this project's own documentation,
and detectability is what keeps the practice auditable instead of covert. See
[`docs/related-work.md`](docs/related-work.md#5-detectability-finding-and-what-it-implies) for the
finding and what it implies.

## Status

**PoC v0.1 — research use only.** PDF authoring, round-trip/PDF.js/pixel-diff validation, and a
private manifest (Phase 0–2) are implemented, and so are the Phase 3–5 research extensions: LLM
provider benchmarking (`POST /jobs/:jobId/model-tests`), deterministic submission-side signal
detection (`POST /jobs/:jobId/submissions`), and robustness transforms
(`POST /jobs/:jobId/robustness`). The provider-calling and submission-analysis endpoints are
disabled by default (`PDFI_ALLOW_EXTERNAL_PROVIDERS=false`, `PDFI_RESEARCH_MODE=false`) — see
[Environment variables](#environment-variables) and [`docs/research-protocol.md`](docs/research-protocol.md).
Every path that would send data to a third-party model provider, or analyze anything resembling
student work, is gated and off unless explicitly enabled. See
[`docs/limitations.md`](docs/limitations.md) for what remains experimental or unimplemented.

## On-device mode (no server)

Authoring an injected PDF needs no backend: the injection engine is pure `pdf-lib` and validation
(render, pixel diff, text extraction) already runs in the browser through PDF.js. When the API is
unreachable — for example the static GitHub Pages deployment — the web app runs the whole
pipeline **on-device** instead of failing at "Generate": inspect → inject → re-parse → geometry
check → text extraction → validation report + private manifest, all in the tab, with the source
PDF never leaving the machine.

**All nine injection modes and all three payload languages work locally.** The two capabilities
that used to be server-only are provided by the browser itself:

- `image_only` rasterizes through the browser's own canvas (`OffscreenCanvas`, falling back to a
  detached `<canvas>`) instead of `@napi-rs/canvas`.
- `payloadLanguage` `"ko"`/`"zh"` — and `unicode_tags`, which draws with the same font — fetch the
  bundled Noto Sans KR/SC font and the HarfBuzz subsetter (`hb-subset.wasm`) on first use, then run
  the identical two-stage subset (HarfBuzz → pdf-lib) the server does. The font assets are emitted
  as separate files and downloaded only when such a payload is actually generated, never at page
  load.

It is the *same* engine code, not a reimplementation: `injectPdfInBrowser()`
(`packages/pdf-engine/src/inject-browser.ts`) is the shared `injectPdfWith()` dispatcher with a
browser capability set, and the report/manifest come from the same `buildReport()`/`buildManifest()`
the server calls. Three tests pin the equivalence: `test/inject-browser.test.ts` (identical
injection decisions per mode and payload language), `test/hb-subset.test.ts` (the browser
subsetter is byte-for-byte equal to `subset-font`), and `test/browser-entry-purity.test.ts` (no
Node built-in reaches the browser entry's module graph).

| | On-device | Needs a server |
|---|---|---|
| Injection modes | all nine | — |
| Payload language | `en`, `ko`, `zh` | — |
| Distribution | single job, variant (A/B/…) sets, student-keyed sets — including the distribution/mapping CSVs and the ZIP archive | — |
| Validation | round-trip, geometry, PDF.js text extraction, render + pixel diff, XMP read-back | qpdf structural check |
| Research tabs | — | Model Test, Submissions, Robustness |

Set generation reuses the server's own key generation, `{{KEY}}` substitution, distribution
assignment, CSV serialization and archive-name sanitization — that logic moved to
`@pdf-injection/contracts` (`src/sets.ts`) so both runtimes call the same code.

Mode is chosen automatically (local when `GET /health` fails) and can be forced either way with
`?local=1` / `?local=0`. Locally generated jobs live in tab memory only and are never written to
storage — the private manifest contains the hidden instruction in plain text — so download the
output PDF, manifest and report before reloading.

## Quick start

Requires [Bun](https://bun.sh) `>= 1.3.14`.

```bash
# Install workspace dependencies (root + all apps/packages)
bun install

# Run the API (Elysia, watches for changes) — http://localhost:3001
bun run --cwd apps/api dev

# In a second terminal, run the web app (Vite dev server) — http://localhost:5173
bun run --cwd apps/web dev

# Open http://localhost:5173 in a browser
```

```bash
# Run all unit/integration tests across every package and app
bun test

# Type-check every workspace
bun run typecheck

# Regenerate the tests/fixtures/*.pdf fixtures (pdf-lib based; see tests/fixtures/README.md)
bun run fixtures:generate

# Regenerate the tests/golden/*.json golden files after an intentional
# pdf-engine/validation behavior change (see docs/validation.md#golden-tests)
bun run golden:update
```

There is **no build step** in local dev. This project intentionally never runs `vite build` or
any bundle/compile command as part of the workflow above — `bun run dev` for both apps runs
directly against source via Bun and Vite's dev server, per the project's absolute rule of never
building until explicitly asked.

### Optional: Docker Compose

`docker-compose.yml` (plus `apps/api/Dockerfile` and `apps/web/Dockerfile`) is a local/dev-parity
stack the user can choose to build and run; it is **not executed by any agent** in this repo, and
`apps/web`'s image is the only place a `vite build` runs (inside its own Docker build stage,
`apps/web/serve.ts` then serves the static output in the container) — it is never triggered by
local `bun run dev`.

```bash
docker compose up --build
# API: http://localhost:3001/api/v1/health
# Web: http://localhost:5173/
```

All provider keys and research-mode flags default to empty/`false` in `docker-compose.yml`
unless overridden via a local (never-committed) `.env` file or the shell environment — see
[Environment variables](#environment-variables).

## End-to-end tests

`tests/e2e` is a standalone Playwright workspace member (`@pdf-injection/e2e`) that automates the
full upload → instruction → generate → validate → download → delete workflow against **live dev
servers it starts itself** (still no build step — its `webServer` config runs
`bun run --cwd apps/api dev` and `bun run --cwd apps/web dev`, on scratch storage/SQLite under
`tests/e2e/.tmp/` so it never touches the default `.pdf-injection-data`). The API `webServer` sets
`PDFI_RESEARCH_MODE=true` (so the submissions/robustness/model-test tabs are reachable) but leaves
`PDFI_ALLOW_EXTERNAL_PROVIDERS` unset — every spec uses the `mock` provider only, so no API keys or
network access are needed to run the suite.

10 spec files cover 11 scenarios: `workflow.spec.ts` (round-1, 2 scenarios — `white_text` and
`render_mode_3`), plus `xmp-only.spec.ts`, `korean-payload.spec.ts`, `model-test.spec.ts`,
`variants.spec.ts`, `student-keyed.spec.ts`, `submissions.spec.ts`, `robustness.spec.ts`,
`robustness-ocr-paraphrase.spec.ts` (`ocr_regeneration` + `paraphrase` with the `mock` provider,
on the 1-page `one-page-text.pdf` fixture to keep `tesseract.js` OCR runtime bounded — added in a
later cycle to cover the two robustness transforms `robustness.spec.ts`, which covers
`print_to_pdf` + `human_edit` + screenshot OCR, doesn't exercise), and
`research-mode-gate.spec.ts` (asserts the Submissions/Robustness tabs show the
`PDFI_RESEARCH_MODE=true` gate message when research mode is off — simulated via a
`GET /health` route interception rather than restarting the API with a different env, since the
`webServer` config is shared by every other spec).

```bash
# One-time: install the Chromium browser Playwright drives
cd tests/e2e && bunx playwright install chromium && cd -

# Run the full E2E suite from the repo root (starts both dev servers itself)
bun run test:e2e
```

`bun test` at the repo root never picks up these specs — `bunfig.toml`'s
`[test] pathIgnorePatterns = ["tests/e2e/**"]` excludes the directory, since Playwright specs use
`@playwright/test`, not `bun:test`, and are run only via Playwright's own runner.

## Linting

[Biome](https://biomejs.dev) (`biome.json` at the repo root) is the single linter/formatter for
every workspace — 2-space indent, double quotes, semicolons, trailing commas, 100-char line
width, matched to the codebase's pre-existing style to keep the tool's footprint minimal.

```bash
bun run lint       # biome check . — lint + format check + import order, no writes
bun run lint:fix   # biome check --write . — apply safe + unsafe auto-fixes
bun run format     # biome format --write . — formatting only
```

Suppressions use `// biome-ignore lint/<rule>: <reason>` (or `/* biome-ignore ... */` in CSS/JSX),
always on the line directly above the flagged node — one rule,
`lint/style/noNonNullAssertion`, is disabled repo-wide instead of suppressed per-call-site: with
`noUncheckedIndexedAccess: true` in `tsconfig.base.json`, every array/typed-array index access
already types as `T | undefined`, so `!` is the standard, already-widely-used idiom here for
indices already proven safe by a preceding bounds check, `.length` check, or regex match — an
`as T` cast would be strictly less safe (it also coerces on a type mismatch) and a project-wide
comment-per-site would just be noise.

## Environment variables

### `apps/api` (see [`apps/api/.env.example`](apps/api/.env.example))

| Variable | Default | Purpose |
|---|---|---|
| `PDFI_MAX_FILE_BYTES` | `26214400` (25 MB) | Max source PDF upload size |
| `PDFI_MAX_PAGES` | `100` | Max page count a source PDF may have |
| `PDFI_MAX_INSTRUCTION_CHARS` | `1500` | Max hidden-instruction length |
| `PDFI_RETENTION_HOURS` | `24` | Hours before the retention sweeper deletes a job's artifacts |
| `PDFI_STORAGE_DIR` | `./.pdf-injection-data` | Directory for per-job artifact files (`source.pdf`, `output.pdf`, `manifest.json`, `report.json`) |
| `PDFI_DB_PATH` | `./.pdf-injection-data/pdf-injection.sqlite` | `bun:sqlite` database file path |
| `PDFI_QPDF_ENABLED` | `false` | Enable `qpdf --check` as an additional (optional) validation step; requires the `qpdf` binary on `PATH` |
| `PDFI_MAX_PAGE_DIMENSION_PT` | `14400` | Max MediaBox/CropBox dimension (points) before a PDF is rejected as structurally abnormal |
| `PDFI_CORS_ORIGIN` | `http://localhost:5173` | Allowed CORS origin for the web app |
| `PDFI_SWEEP_INTERVAL_MS` | `600000` | How often (ms) the retention sweeper scans for expired jobs |
| `PDFI_PORT` | `3001` | Port the API listens on (`bun run dev` / `bun run start`) |
| `PDFI_RESEARCH_MODE` | `false` | Gates §3 submissions (`POST/GET /jobs/:jobId/submissions*`) and §4 robustness (`POST/GET /jobs/:jobId/robustness*`) endpoints — `403 RESEARCH_MODE_DISABLED` when off. Off by default: this PoC must not receive real student data |
| `PDFI_ALLOW_EXTERNAL_PROVIDERS` | `false` | Gates the `anthropic`/`openai` providers for §2 model-tests and §4 robustness text transforms — `403 EXTERNAL_PROVIDERS_DISABLED` when off. The `mock` provider is always allowed regardless. Off by default: no PDF/text content leaves the server without explicit opt-in |
| `ANTHROPIC_API_KEY` | (unset) | Anthropic API key, used server-side only when `PDFI_ALLOW_EXTERNAL_PROVIDERS=true` and a request selects provider `"anthropic"`; missing key → `422 PROVIDER_NOT_CONFIGURED`. Never sent to the browser |
| `OPENAI_API_KEY` | (unset) | Same gating as `ANTHROPIC_API_KEY`, for provider `"openai"` |
| `PDFI_ANTHROPIC_MODEL` | `claude-opus-5` | Model id used by the `anthropic` provider adapter |
| `PDFI_OPENAI_MODEL` | `gpt-5.5` | Model id used by the `openai` provider adapter |
| `PDFI_MAX_PROCESSING_MS` | `60000` | Per-job processing time limit; exceeding it aborts the request with `504 PROCESSING_TIMEOUT` and leaves no job row or files behind |
| `PDFI_MAX_VARIANTS` | `8` | Max A/B/C… variants in a single variant set (`TOO_MANY_VARIANTS`) |
| `PDFI_MAX_STUDENT_KEYS` | `500` | Max students in a single student-keyed set (`TOO_MANY_STUDENTS`) |
| `PDFI_MAX_SUBMISSION_BYTES` | `10485760` (10 MB) | Max bytes for a single submission upload (txt/md/pdf/image) |
| `PDFI_MAX_SUBMISSIONS_PER_JOB` | `500` | Max submissions stored per job |
| `PDFI_MODEL_TEST_MAX_REPEATS` | `10` | Max `repeats` accepted by `POST /jobs/:jobId/model-tests` |
| `PDFI_MODEL_TEST_CONCURRENCY` | `2` | Bounded parallelism for provider calls within a single model-test run |
| `PDFI_FONT_DIR` | `packages/pdf-engine/fonts` | Directory containing the CJK fonts (Noto Sans KR for `payloadLanguage="ko"`, Noto Sans SC for `"zh"`; both OFL) |
| `PDFI_RESEARCH_RESULTS_DIR` | (unset) | When set, a completed model-test run's export (JSON/CSV) is also copied here — see [`research/results/README.md`](research/results/README.md). Unset by default (no copy) |

### `apps/web` (see [`apps/web/.env.example`](apps/web/.env.example))

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | `/api` | Base URL the web client uses for API calls (proxied by Vite in dev) |
| `VITE_API_PROXY_TARGET` | `http://localhost:3001` | Target the Vite dev server proxies `/api` requests to (matches `PDFI_PORT`) |

If no API is reachable at `VITE_API_BASE_URL`, the app falls back to
[on-device mode](#on-device-mode-no-server) rather than reporting a request error.

The web app's Eden Treaty client (`apps/web/src/lib/api.ts`) requires an absolute origin: when
`VITE_API_BASE_URL` is left at its default relative `/api`, it is resolved to
`window.location.origin` at request time (Vite's dev-server proxy still forwards `/api/*` on that
same origin to `apps/api`, so behavior is unchanged from a plain relative `fetch`). Only when
`VITE_API_BASE_URL` is set to an absolute URL is that URL used directly. See
[`docs/architecture.md`](docs/architecture.md#eden-treaty-type-sharing).

### Docker only (`apps/web/serve.ts`)

| Variable | Default | Purpose |
|---|---|---|
| `PDFI_API_PROXY_TARGET` | `http://api:3001` | Target the production static-file server (`apps/web/serve.ts`, built into the `apps/web` Docker image) proxies `/api/*` requests to. Not read by Vite's dev server (that's `VITE_API_PROXY_TARGET` above) — only relevant when running via `docker compose up` (see [`docker-compose.yml`](docker-compose.yml)), where it targets the `api` service by its Compose network hostname. |

## Repository structure

```text
.
├── apps/
│   ├── api/                  # Elysia API on Bun (router -> service -> repository)
│   │   ├── src/
│   │   │   ├── routes/       # health, jobs, model-tests, robustness, variant-sets,
│   │   │   │                 # student-keyed-sets, submissions
│   │   │   ├── services/     # job.service.ts (inspect -> lint -> inject -> validate -> persist),
│   │   │   │                 # model-test.service.ts, robustness.service.ts,
│   │   │   │                 # variant-set.service.ts, student-keyed-set.service.ts,
│   │   │   │                 # submission.service.ts
│   │   │   ├── repositories/ # bun:sqlite: jobs, model_test_runs/robustness_runs (runs.repository.ts),
│   │   │   │                 # variant_sets/variant_set_members, submissions
│   │   │   ├── lib/          # background-runner.ts (in-process async run queue), zip.ts, set-token.ts,
│   │   │   │                 # student-keys.ts, time-limit.ts, job-artifacts.ts, multipart.ts, pdf-text.ts
│   │   │   ├── middleware/   # access-token guard, error mapper, security headers
│   │   │   ├── config.ts     # env-var configuration with defaults
│   │   │   ├── errors.ts     # centralized ApiError -> error envelope
│   │   │   ├── storage.ts    # per-job artifact file storage, filename sanitization
│   │   │   └── index.ts      # createApp() + `export type App` (for Eden Treaty)
│   │   ├── Dockerfile        # docker-compose api image (vite/build-free local dev unaffected)
│   │   └── test/             # bun:test integration tests over Elysia's .handle()
│   └── web/                  # React + Vite + TypeScript professor UI
│       ├── src/
│       │   ├── features/     # upload, instruction-editor, pdf-preview, visual-diff, extracted-text,
│       │   │                 # validation-result, model-test, robustness, submissions, variants (FSD-lite)
│       │   ├── components/ui/# shadcn/ui-derived primitives
│       │   └── lib/          # api.ts (Eden Treaty client + raw-fetch binary downloads), pdfjs.ts, prompt-normalize.ts, ...
│       ├── serve.ts          # Docker-only production static file server (dist/ + /api proxy) — not used in local dev
│       └── Dockerfile        # docker-compose web image (builds dist/ via vite build, then serve.ts)
├── packages/
│   ├── contracts/            # Shared wire types (incl. types-research.ts for §1-4), ApiErrorCode,
│   │                         # LIMITS, overall-status computation
│   ├── pdf-engine/           # inspectSource (incl. riskFlags), injectPdf (white_text/render_mode_3/
│   │                         # visible_positive_control/xmp_only/unicode_tags, payloadLanguage="ko" via
│   │                         # @pdf-lib/fontkit), compareGeometry, resolveTargetPage, manifest builder,
│   │                         # encodeUnicodeTags/decodeUnicodeTags/stripUnicodeTags + readUnicodeTagsPayload
│   │                         # (unicode_tags codec + CMap read-back, independent of pdfjs-dist);
│   │                         # round-3 research/diagnostic probes (not production channels):
│   │                         # injectImageOnly/injectFreetextAnnot/injectAcroFormField/injectInfoDict +
│   │                         # their dedicated readers, native-canvas.ts (@napi-rs/canvas resolved
│   │                         # through pdfjs-dist's own module root, mirroring packages/robustness)
│   ├── validation/           # sha256Hex, extractText (pdfjs-dist), checkMetadataPayload (xmp_only),
│   │                         # qpdfCheck, report builder
│   ├── prompt-lint/          # lintPrompt() — instruction/signal errors and warnings
│   ├── detector/             # Deterministic ExpectedSignal matchers (exact/regex/methodology/
│   │                         # ordered-terms/section-order) + Phase 4 scoring/calibration/statistics
│   │                         # (Fisher's exact test, Holm-Bonferroni correction) and the §23.2 smoke-test
│   │                         # gate; regex matching runs with a Worker-based timeout (DoS mitigation)
│   ├── benchmark/            # Phase 3 provider adapters (anthropic/openai/mock), runMatrix(), disclosure/
│   │                         # refusal detection, JSON/CSV export — used by apps/api's model-tests route
│   └── robustness/           # Phase 5 PDF transforms (print_to_pdf, ocr_regeneration, screenshot_ocr) and
│                             # text transforms (paraphrase, translation, human_edit); capabilities() probes
│                             # canvas (@napi-rs/canvas, via pdfjs-dist) / OCR (tesseract.js) availability
├── research/                 # PRD §21/§23.2 experiment scaffolding — see docs/research-protocol.md
│   ├── experiment-configs/   # JSON Schema + example model-test run config (mock provider, no API keys)
│   ├── datasets/             # Policy + layout for synthetic baseline text (no real student data)
│   └── results/              # Optional export destination when PDFI_RESEARCH_RESULTS_DIR is set
├── tests/
│   ├── fixtures/             # Generated + one hand-crafted PDF fixture (see tests/fixtures/README.md)
│   ├── golden/                # Golden-file regression tests for injectPdf/extractText/checkMetadataPayload
│   │                           # across every fixture x mode x language — `bun run golden:update` to refresh
│   ├── integration/          # Cross-fixture pdf-engine/validation integration tests
│   └── e2e/                  # Playwright suite (@pdf-injection/e2e) — `bun run test:e2e`
├── scripts/
│   ├── generate-fixtures.ts  # `bun run fixtures:generate`
│   └── update-golden.ts      # `bun run golden:update`
├── docker-compose.yml        # Optional local/dev-parity stack (api + web) — user-run only
└── docs/                     # Architecture, API, validation, research protocol, ethics/privacy, limitations
```

## Injection modes

| Mode | Description | Status | Caveats |
|---|---|---|---|
| `white_text` | Fills instruction text white (`1 1 1 rg`), readable by ordinary PDF text extraction | **Default** | Visible if the background isn't white; discoverable by select-all/copy-paste, screen readers, dark-mode viewers, or a PDF sanitizer; also detectable by independent metamorphic-detection tools (PhantomLint: 100% recall, 0.092% FPR — see [`docs/related-work.md`](docs/related-work.md#5-detectability-finding-and-what-it-implies)), by design |
| `render_mode_3` | Uses PDF text-rendering mode 3 (`3 Tr`, `TextRenderingMode.Invisible`) — text stays in the content stream but is never painted | **Experimental** | Some parsers/sanitizers strip render-mode-3 text entirely; provider ingestion pipelines may ignore it; extraction results are recorded explicitly (success or failure), never assumed; also detectable by independent metamorphic-detection tools (PhantomLint: 100% recall, 0.092% FPR — see [`docs/related-work.md`](docs/related-work.md#5-detectability-finding-and-what-it-implies)), by design |
| `visible_positive_control` | Injects the same instruction, visible to the reader | **Research-only positive control** | Not a stealth mode — used to establish whether a model follows the instruction at all when it can be seen, as a baseline for the other two modes |
| `xmp_only` | Writes the instruction into the PDF's XMP metadata stream (catalog `/Metadata`) only — no page content stream is touched | **Research-only, no page text** | Never extracted by ordinary page-text extraction (`hiddenTextExtracted` is not required for this mode); presence is checked via `metadataPayloadPresent` instead. Most robustness transforms (print-to-PDF, OCR regeneration, screenshot OCR) strip XMP metadata entirely, since they rebuild the page content from a raster image — this mode is expected to have near-zero survival under those transforms, which is itself a useful research data point, not a defect |
| `unicode_tags` | Draws the instruction as ordinary ASCII in an invisible (`3 Tr`) text object, then rewrites the embedded font's `/ToUnicode` CMap (post-save, public `pdf-lib` APIs only) so each glyph decodes to a Unicode Tag character (U+E0000–U+E007F) instead of its drawn ASCII value — prior art: PRD §4.2 In-Context Watermarking, §4.3 SteganoPrompt | **Experimental** | The payload is verified present in the output file's font/CMap (a server-side CMap read-back independent of PDF.js), but this app's own PDF.js-based text extraction can never display it: `pdfjs-dist` unconditionally filters Unicode General Category "Cf" (Format) characters, and the entire Unicode Tags block is Cf — so `hiddenTextExtracted` is always `false` for this mode and every job is `PASS_WITH_WARNINGS`, never plain `PASS`, by design, not a defect. Whether a given LLM provider's own document ingestion sees the payload is exactly what the Model Test benchmark measures, not something this local view can answer either way. ASCII-only: `payloadLanguage: "ko"` is rejected with `422 PROMPT_ENCODING_FAILED` for this mode |
| `image_only` | Rasterizes the instruction to a PNG (`@napi-rs/canvas`, resolved through `pdfjs-dist`'s own module root — no top-level `@napi-rs/canvas` dependency) and stamps it in the page margin. **No text object of any kind is written to the page** — verified by decoding the output content stream and asserting no `BT`/`ET` | **Round-3 research/diagnostic probe — not a production channel** | Visible by design, like `visible_positive_control` (`diffThreshold` is `Infinity`); no text extractor, including this project's own PDF.js-based one, can ever find it — that is the point: it tests whether a provider's ingestion pipeline has a vision path at all, not text extractability. Requires `@napi-rs/canvas` at runtime; raises `422 CANVAS_UNAVAILABLE` (never a silent text-free no-op) when the native module can't be resolved |
| `freetext_annot` | Draws the instruction as real invisible (`3 Tr`) text inside a FreeText annotation's own `/AP /N` appearance stream — never the page's content stream. `/Contents` is also set structurally, though it isn't what extracts the text (see caveats) | **Round-3 research/diagnostic probe — not a production channel** | Present in the output (verified via a public-`pdf-lib`-API read-back of the appearance stream), but invisible to this app's own PDF.js-based `extractText()`, which never walks an annotation's appearance stream. Measured directly against this project's own injector output with poppler `pdftotext`/`pdfinfo` v26.08.0: **surfaced** by `pdftotext` (poppler extracts a widget/annotation's text by walking its appearance-stream operators — render mode doesn't matter to that walk), **not present** in `pdfinfo` metadata |
| `acroform_field` | Same technique as `freetext_annot`, inside a brand-new AcroForm text-field widget's own appearance stream (pdf-lib's public `PDFForm`/`PDFTextField.updateAppearances()` escape hatch). Never mutates a pre-existing field, even on a source PDF that already has an AcroForm | **Round-3 research/diagnostic probe — not a production channel** | Same measured result as `freetext_annot`: surfaced by `pdftotext`, not present in `pdfinfo` metadata, invisible to this app's own PDF.js-based extraction |
| `info_dict` | Writes the instruction into the classic `/Info` dictionary's `Subject` and `Keywords` fields only — no page content stream is touched. The original `/Info /Title` is preserved | **Round-3 research/diagnostic probe — not a production channel** | Not found in page text by any of this project's tested extractors (`pdfjs-dist`, and — measured directly — poppler's `pdftotext`); surfaced by metadata reads instead (poppler's `pdfinfo`, e.g. pypdf's `reader.metadata`) |

All four round-3 probe modes (`image_only`, `freetext_annot`, `acroform_field`, `info_dict`) are
**deterministically not extractable** by this project's own PDF.js-based `extractText()` —
`hiddenTextExtracted` is always `false` for every one of them, so every such job lands
`PASS_WITH_WARNINGS`, never plain `PASS`, and the web UI's Extracted Text tab shows no matched
text for these modes. That is expected, by-design behavior — the same treatment `render_mode_3`
and `unicode_tags` already get (see
[`docs/api.md`](docs/api.md#overall-computation-packagescontractssrcoverallts)) — not a bug.
Whether a given LLM provider's own ingestion actually surfaces any of these four channels is
exactly what the Model Test benchmark measures; that measurement is separate from, and not
settled by, this local PDF.js view.

Eight of the nine modes accept `payloadLanguage: "en" | "ko" | "zh"` (default `"en"`);
`unicode_tags` is `"en"`-only (`"ko"`/`"zh"` are rejected with `PROMPT_ENCODING_FAILED`, since the
Unicode Tag block has no defined mapping outside the ASCII range). `"en"` requires the instruction
to be printable ASCII (`PROMPT_ENCODING_FAILED` otherwise, for every mode). `"ko"` embeds a Korean
(Noto Sans KR, static Regular) font subset and `"zh"` a Simplified-Chinese (Noto Sans SC, static
Regular) one — the two languages share the same pipeline and rules, so everything below about
`"ko"` applies to `"zh"` as well (`health.features.zhPayload` mirrors `koPayload`) — for the five
modes that draw real PDF text: the three page-content modes
(`white_text`/`render_mode_3`/`visible_positive_control`) plus the two round-3 annotation/widget
probes that draw their own private appearance-stream text the same way (`freetext_annot`/
`acroform_field`). The font is first pre-subset with HarfBuzz WASM (`subset-font`) to just the
instruction's codepoints plus printable ASCII, then embedded through `pdf-lib`'s CID-keyed subset
path (`@pdf-lib/fontkit` handles the font registration `pdf-lib` needs to embed it at all) — this
combination renders at the correct weight with full, correctly-shaped glyphs, at a few KB of
embedded font size (well inside the "<400KB output growth" budget for every mode). For the three
page-content modes it extracts with an exact `pdfjs-dist` text match (verified by the golden-test
suite). `freetext_annot`/`acroform_field` are never extracted by `pdfjs-dist` at all, with any
payload language (see the non-extractability note above) — their own Korean-payload tests instead
confirm the font renders and the structural `/Contents`/`/V` value round-trips correctly, not a
`pdftotext` exact-text-match, which this project's automated test suite does not check for Korean
text on these two modes specifically (only for the ASCII marker strings used in the poppler
cross-check above). Missing the font on the server returns `422 FONT_UNAVAILABLE`
(`PDFI_FONT_DIR`-configurable; see [Environment variables](#environment-variables)). `xmp_only` and
`info_dict` accept `"ko"` too but
never embed a font at all — no glyphs are drawn into any page or appearance stream; the payload is
metadata-only. `image_only` also accepts `"ko"`, but rasterizes via `@napi-rs/canvas`'s own
`sans-serif` font resolution rather than the bundled Noto Sans KR subset path — this project's own
test suite does not exercise non-ASCII text for this mode, so Korean glyph rendering quality
depends on whatever fonts are available to the native canvas module on the deployment machine and
is unverified here.

## Validation and the PDF.js disclaimer

Every generated job runs server-side round-trip validation (page count, page geometry,
`pdf-lib` reload, `pdfjs-dist` text extraction) plus optional `qpdf --check`, and the browser
posts client-side PDF.js render + `pixelmatch` pixel-diff + text-extraction results back to the
API. See [`docs/validation.md`](docs/validation.md) for the full pipeline and thresholds.

The validation report and the web UI's Extracted Text tab always carry this disclaimer, matching
the API contract's `ValidationReport.disclaimer` field:

> PDF.js parser view — may differ from actual LLM provider ingestion.

## Private manifest warning

Every job produces a `<stem>.private-manifest.json` artifact containing the **plaintext hidden
instruction**, expected signals, and hashes. This file is for the professor's own records only.

**Do not distribute the private manifest to students.** The manifest itself carries this warning
string in its `warning` field. See [`docs/ethics-and-privacy.md`](docs/ethics-and-privacy.md).

## Privacy defaults

- **No external LLM calls happen by default.** `PDFI_ALLOW_EXTERNAL_PROVIDERS=false` (default)
  blocks the `anthropic`/`openai` providers on `POST /jobs/:jobId/model-tests` and robustness text
  transforms with `403 EXTERNAL_PROVIDERS_DISABLED`; only the deterministic `mock` provider is
  reachable. Enabling external providers requires the flag, a configured API key, and the caller
  to pass `acknowledgeExternalTransfer: true` on the request itself.
- **Research-mode endpoints (submissions, robustness) are off by default.**
  `PDFI_RESEARCH_MODE=false` returns `403 RESEARCH_MODE_DISABLED` for every
  `/jobs/:jobId/submissions*` and `/jobs/:jobId/robustness*` route. `POST /jobs/:jobId/submissions`
  additionally requires `acknowledgeNoRealStudentData: true` per request — see
  [`docs/ethics-and-privacy.md`](docs/ethics-and-privacy.md).
- Job artifacts (and model-test/robustness/submission runs scoped to a job) are retained for
  `PDFI_RETENTION_HOURS` (default 24 hours), after which a background sweeper deletes them; a job
  can also be deleted immediately via `DELETE /api/v1/jobs/:jobId` (cascades to its runs and
  submissions).
- The hidden instruction text is never written to `bun:sqlite` or to server logs — only its
  SHA-256 hash (`promptSha256`) is ever logged or stored in the database. The same discipline
  applies to variant-set/student-keyed-set instructions and student-key mappings (see
  [`docs/api.md`](docs/api.md)).

## License notes for core dependencies

| Dependency | License | Role |
|---|---|---|
| [`pdf-lib`](https://pdf-lib.js.org) | MIT | PDF loading, modification, low-level injection operators |
| [`pdfjs-dist`](https://mozilla.github.io/pdf.js/) (PDF.js) | Apache-2.0 | Browser + server-side rendering and text extraction |
| [`pixelmatch`](https://github.com/mapbox/pixelmatch) | ISC | Client-side pixel-diff comparison |
| [`qpdf`](https://qpdf.sourceforge.io/) | Apache-2.0 | Optional external structural-validation binary (`PDFI_QPDF_ENABLED`) — not a package dependency, invoked via `Bun.spawn` when installed |
| [`@pdf-lib/fontkit`](https://github.com/Hopding/fontkit) | MIT | Font registration/embedding support `pdf-lib` needs for `payloadLanguage="ko"`/`"zh"` (`packages/pdf-engine`) |
| [`subset-font`](https://github.com/papandreou/subset-font) | BSD-3-Clause | Pre-subsets the CJK font with HarfBuzz before `pdf-lib` embeds it (`payloadLanguage="ko"`/`"zh"`, `packages/pdf-engine`). Its `hb_subset_*` call sequence is also the basis of `packages/pdf-engine/src/hb-subset.ts`, the browser-side driver used by on-device mode (that package reads the wasm with `node:fs`, which a browser cannot do) |
| [`harfbuzzjs`](https://github.com/harfbuzz/harfbuzzjs) | MIT | WASM HarfBuzz shaping/subsetting engine `subset-font` wraps (transitive dependency) |
| [`fflate`](https://github.com/101arrowz/fflate) | MIT | ZIP archive building for variant-set / student-keyed-set downloads (`apps/api`) |
| [`@anthropic-ai/sdk`](https://github.com/anthropics/anthropic-sdk-typescript) | MIT | Anthropic provider adapter (`packages/benchmark`) — only invoked when `PDFI_ALLOW_EXTERNAL_PROVIDERS=true` and `ANTHROPIC_API_KEY` is set |
| [`openai`](https://github.com/openai/openai-node) | Apache-2.0 | OpenAI provider adapter (`packages/benchmark`) — only invoked when `PDFI_ALLOW_EXTERNAL_PROVIDERS=true` and `OPENAI_API_KEY` is set |
| [`tesseract.js`](https://github.com/naptha/tesseract.js) | Apache-2.0 | OCR for the screenshot-OCR robustness transform and OCR-regenerated PDF text layer (`packages/robustness`) — downloads its `eng` trained-data file over the network on first use, cached thereafter |
| [`@napi-rs/canvas`](https://github.com/Brooooooklyn/canvas) | MIT | Native canvas rendering for print-to-PDF / OCR-regeneration page rasterization (`packages/robustness`) — resolved as an optional dependency through `pdfjs-dist`'s own module root (see `packages/robustness/src/native-canvas.ts`), not a direct dependency of this codebase |
| [Noto Sans KR](https://fonts.google.com/noto/specimen/Noto+Sans+KR) (static Regular) | OFL-1.1 | The bundled `payloadLanguage="ko"` CJK font (`packages/pdf-engine/fonts/`), a font asset — not an npm package dependency |
| [Noto Sans SC](https://fonts.google.com/noto/specimen/Noto+Sans+SC) (static Regular) | OFL-1.1 | The bundled `payloadLanguage="zh"` (Simplified Chinese) CJK font (`packages/pdf-engine/fonts/`), a font asset — not an npm package dependency |

## Further documentation

- [`docs/prd.md`](docs/prd.md) — the original product requirements document (English translation) this project was built from; the historical baseline, not a description of the current build
- [`docs/architecture.md`](docs/architecture.md) — system architecture, data flow, storage layout, SQLite schema
- [`docs/api.md`](docs/api.md) — full HTTP API reference
- [`docs/validation.md`](docs/validation.md) — validation pipeline, thresholds, PDF.js disclaimer
- [`docs/research-protocol.md`](docs/research-protocol.md) — running the PRD §21/§23.2 model-benchmark and robustness experiments end to end
- [`docs/ethics-and-privacy.md`](docs/ethics-and-privacy.md) — governance requirements, manifest handling, IRB note
- [`docs/limitations.md`](docs/limitations.md) — non-goals, experimental-mode caveats, remaining unimplemented pieces
- [`docs/related-work.md`](docs/related-work.md) — nearest published/preprint work, peer-review status of every cited claim, and the detectability finding
