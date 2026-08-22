# Limitations

This page lists what PDF Injection v0.1 deliberately does not do, what is experimental or
capability-gated rather than production-ready, and residual risks in what has been built.

## Non-goals (out of scope for this PoC)

The following are explicitly out of scope, matching the PRD's MVP non-goals:

- Student accounts or LMS integration
- **Automated judgment of student submissions.** `packages/detector`'s matchers (used by both
  submissions and robustness) return match **evidence** only — no verdict field exists anywhere
  in the codebase, by design (see [`docs/api.md`](api.md#submissions-3--phase-4-submission-side-detection-research-only)).
- Any definitive "AI cheating" determination
- General AI-generated-text detection (style/token-distribution based)
- Token-probability watermarking
- Font glyph remapping or custom `/ToUnicode` manipulation
- PDF JavaScript of any kind (a source PDF that already contains JavaScript is flagged via
  `riskFlags`, never executed or added to)
- Aggressively optimized jailbreak-style prompts
- Insertion of fake citations or fabricated facts
- Modifying encrypted PDFs
- Modifying digitally signed PDFs
- Full PDF/A preservation guarantees
- Full accessibility guarantees (see the accessibility caveat in
  [`docs/ethics-and-privacy.md`](ethics-and-privacy.md#accessibility-caveat))
- A dedicated mobile UI
- Real student data anywhere in the submissions/robustness research protocol (see
  [`docs/ethics-and-privacy.md`](ethics-and-privacy.md#submissions-research-mode-phase-4--no-real-student-data))
- LLM-as-a-judge detection (PRD §21.5) — signal detection is deterministic-rules-only, by design,
  so it never adds its own model uncertainty into the measurement

Per-student PDF generation is **implemented** as of round 2 (`POST /variant-sets`,
`POST /student-keyed-sets` — see [`docs/api.md`](api.md#variant-sets-and-student-keyed-sets-1)),
but only as a batch-authoring/distribution feature on top of the same one-shared-instruction
injection pipeline: there is still no LMS integration, no automated grading, and no per-student
*content* customization beyond a variant label or an embedded traceability key.

## `render_mode_3` caveats

`render_mode_3` (PDF text-rendering mode 3 / `3 Tr`) is an **experimental** injection mode, not
the production default (`white_text` is the default). It is not visible in any renderer regardless
of background color, and produces no pixel difference when implemented correctly — but it comes
with real risk of the payload simply disappearing before it ever reaches a model:

- Some PDF parsers or sanitizers strip invisible/non-rendering text objects entirely.
- Some provider document-ingestion pipelines may ignore render-mode-3 text, since it is not part
  of the visible page.
- "Print to PDF" or other re-flattening pipelines can drop it.
- Different parsers (PDF.js vs. others) may disagree on whether the text is present at all.

Because of this, the extraction result for `render_mode_3` is always **recorded explicitly** as
success or failure (`ValidationReport.serverValidation.textExtraction`,
`ClientValidationInput.extractedText`) — it is never assumed to have worked, and a failed
extraction on this mode contributes `PASS_WITH_WARNINGS` rather than `FAIL` to `overall`
(a failure to extract is expected/tracked behavior for this mode, not a hard validation failure).
See [`docs/validation.md`](validation.md#6-visual-difference-client-side-posted-back-to-the-server)
for the (tighter) pixel-diff threshold applied to this mode.

`white_text` also has its own caveats (visible on non-white backgrounds, discoverable via
select-all/copy-paste, readable by screen readers, exposed in dark-mode PDF viewers, and
removable by a PDF sanitizer) — see [`README.md`](../README.md#injection-modes).

## `xmp_only` caveats

`xmp_only` (PDF XMP metadata injection) writes the instruction into the catalog's `/Metadata`
stream and touches no page content stream at all — the safest mode with respect to visual/
accessibility side effects, but with its own risk profile:

- It is **not extracted by ordinary page-text extraction** — `hiddenTextExtracted` is not part of
  its validation gate at all; presence is checked via `metadataPayloadPresent` instead (see
  [`docs/validation.md`](validation.md#4-xmp-metadata-payload-check-checkmetadatapayload-packagesvalidation--xmp_only-mode-only)).
  Whether any given LLM provider's PDF-ingestion pipeline reads document metadata at all (as
  opposed to only page content) is unverified and provider-specific — this mode is a research
  probe for that question, not a mode known to work against any particular provider.
- Nearly every robustness transform in `packages/robustness` (print-to-PDF, OCR regeneration,
  screenshot OCR) rebuilds the output from a rasterized image, which discards XMP metadata
  entirely — near-zero survival under those transforms is the **expected**, recorded result for
  this mode, not a bug (see [`docs/architecture.md`](architecture.md#data-flow-robustness-runs-4)).
- Some PDF viewers/sanitizers strip metadata on save/re-export, same caveat category as
  `render_mode_3`'s content-stream stripping risk above.

## Instruction and payload constraints

- The hidden instruction must be **printable ASCII** (plus `\n`) when `payloadLanguage="en"`
  (the default) — anything else is rejected with `PROMPT_ENCODING_FAILED` (see
  `packages/prompt-lint`'s `NON_PRINTABLE_ASCII_RE` / `CONTROL_CHAR_RE` checks). This ASCII gate
  applies uniformly across **all four** injection modes, including `xmp_only` (which never draws
  glyphs and so has no font-rendering reason to require ASCII) — kept uniform for predictability
  rather than carving out a mode-specific exception.
- The instruction is capped at `PS_MAX_INSTRUCTION_CHARS` (default **1500** characters).
- `payloadLanguage="ko"` lifts the ASCII restriction for Korean text and requires the bundled
  Korean font to be available on the server (`PS_FONT_DIR`, default
  `packages/pdf-engine/fonts/`) — see
  [Korean payload (`payloadLanguage="ko"`) mechanism](#korean-payload-payloadlanguageko-mechanism)
  below. No language besides `"en"`/`"ko"` is supported; `PrivateManifest.prompt.language` records
  whichever of the two was used (no longer hardcoded to `"en"`).

## Korean payload (`payloadLanguage="ko"`) mechanism

`payloadLanguage="ko"` embeds a Korean (Noto Sans KR, static Regular, OFL-licensed) font subset
for the three drawn-text modes (`white_text`, `render_mode_3`, `visible_positive_control`);
`xmp_only` accepts non-ASCII Korean text too but never embeds a font (no glyphs are drawn into any
page). The font is pre-subset with a WASM build of HarfBuzz (`subset-font`, BSD-3-Clause,
wrapping `harfbuzzjs`, MIT) to just the instruction's codepoints plus printable ASCII, then handed
to `pdf-lib`'s own CID-keyed subset embedding path (`@pdf-lib/fontkit` provides the font
registration `pdf-lib` needs to embed any font at all) — see `packages/pdf-engine/src/korean-font.ts`.
This renders at the correct weight with full, correctly-shaped glyphs and extracts with an exact
`pdfjs-dist` text match, verified for all three drawn-text modes including
`visible_positive_control`.

- Missing the font on the server (e.g. `PS_FONT_DIR` misconfigured, or the font file removed)
  returns `422 FONT_UNAVAILABLE` rather than silently falling back to a Latin-only font or failing
  extraction.
- No language besides Korean has a supported non-ASCII payload path; adding another script would
  require bundling and verifying its own font following the same process.

## PDF support constraints

- **Encrypted PDFs are rejected outright** (`PDF_ENCRYPTED`) — this tool never attempts to modify
  an encrypted source PDF.
- **Digitally signed PDFs are rejected outright** (`PDF_SIGNED`) — a `/Sig` field or `/DocMDP`
  entry is enough to trigger this gate; modifying a signed PDF would invalidate its signature
  anyway.
- Source PDFs over `PS_MAX_PAGES` (default 100) or `PS_MAX_FILE_BYTES` (default 25 MB) are
  rejected.
- `qpdf` structural validation is **optional and off by default**
  (`PS_QPDF_ENABLED=false`); it requires the `qpdf` binary to be present on `PATH`. When disabled
  or the binary is missing, `qpdfCheck()` always returns `{ status: "not_run" }` and never blocks
  a job — a clean `qpdf --check` result is treated as one extra validation signal, not proof of
  full PDF-specification compliance.

## Phase 3–5 research features: implemented, but gated and caveated

Provider benchmarking (`POST /jobs/:jobId/model-tests`), robustness transforms
(`POST /jobs/:jobId/robustness`), and submission-side detection (`POST /jobs/:jobId/submissions`)
are all implemented — see [`docs/api.md`](api.md) and
[`docs/research-protocol.md`](research-protocol.md). What remains true of every one of them:

- **Off by default, gated behind explicit env vars and per-request acknowledgements.**
  `PS_ALLOW_EXTERNAL_PROVIDERS=false` and `PS_RESEARCH_MODE=false` are the defaults; see
  [`docs/ethics-and-privacy.md`](ethics-and-privacy.md#external-provider-transfer-consent-phase-35).
- **Detection is deterministic, evidence-only, never a verdict.** `packages/detector`'s
  `matchSignals()` (`exact_phrase`, `regex`, `methodology_label`, `ordered_terms`,
  `section_order`) and its Phase 4 scoring/calibration/statistics layer never produce a
  cheating/AI-use verdict field — only match evidence, rates, and (for submissions)
  Fisher's-exact/Holm-Bonferroni statistics against a baseline. LLM-as-a-judge detection is
  explicitly out of scope (PRD §21.5) — it would add its own model uncertainty into the
  measurement.
- **The §23.2 smoke-test gate is a research finding, not a product claim.** A model-test run
  either passes or fails the "≥50 percentage point delta vs. original" threshold; failing it means
  the "LLM-mediated detection" hypothesis is unsupported for that (provider, condition) pair — it
  is never surfaced as "this tool doesn't work" or reworded into a stronger claim anywhere in the
  UI or exports. See [`docs/research-protocol.md`](research-protocol.md#interpreting-the-smoke-test-gate).

### Capability-gated sub-features

- **OCR (`tesseract.js`) and native canvas rendering (`@napi-rs/canvas`, resolved through
  `pdfjs-dist`) are live-probed, not assumed available.** `GET /health`'s
  `features.ocrAvailable`/`features.canvasAvailable` reflect whether the current process can
  actually use them (see [`docs/api.md`](api.md#get-apiv1health)); when unavailable, the
  print-to-PDF, OCR-regeneration, and screenshot-OCR robustness transforms, and image-upload
  submissions, fail closed with `422 CANVAS_UNAVAILABLE`/`422 OCR_UNAVAILABLE` rather than
  silently skipping or producing a degraded result. `tesseract.js` additionally downloads its
  `eng` trained-data file over the network on first use (cached thereafter) — the very first OCR
  call in a fresh environment may be slow or fail in a fully offline sandbox.
- **`translation` (robustness text transform) has no local fallback.** Unlike `paraphrase` and
  `human_edit` (deterministic seeded local implementations, always available), a meaning-preserving
  translation requires a real LLM call — `available: false` with a `reason` when no allowed
  provider is configured, never a fake/no-op translation.
- **The `mock` provider is seeded/reproducible but not a model.** It exists so the entire
  model-test / robustness research protocol can be exercised with zero network calls and zero API
  keys (see [`docs/research-protocol.md`](research-protocol.md)). Its behavior is a fixed
  probabilistic rule, not a real judgment: it "follows" the hidden instruction with 90%
  probability when the instruction is actually present in the given PDF, and spuriously "follows"
  with 10% probability when it is not (`original` condition) — modeling a plausible
  true-positive/false-positive shape for pipeline testing, using a seeded RNG for reproducibility.
  This is useful for exercising the *pipeline* (aggregation, the smoke-test gate, exports) end to
  end, but its rates are a synthetic fixture and must never be reported or compared as if they
  were a real provider's behavior.
- **Regex `ExpectedSignal` matching has a residual (mitigated, not eliminated) ReDoS surface.**
  `packages/detector` rejects the common nested-quantifier catastrophic-backtracking shape
  (`NESTED_QUANTIFIER_RE`) and, for HTTP-facing callers (submissions, model-tests),
  additionally runs regex evaluation on a Worker thread with a 200ms wall-clock timeout
  (`regexMatchWithTimeout()`) so a pathological pattern is forcibly terminated rather than
  hanging the process. This is **defense-in-depth, not full static analysis**: some catastrophic
  shapes (e.g. alternation patterns like `(a|aa)+`) aren't caught by the nested-quantifier
  heuristic and rely on the Worker timeout as the actual backstop. `MAX_REGEX_SIGNALS_PER_CALL`
  (20) and `MAX_HAYSTACK_LENGTH` (1,000,000 chars) bound the per-request worst case further.

## Performance

The soft target is a 50-page PDF processed in ≤ 30 seconds and a first-page browser preview in
≤ 3 seconds; these remain soft targets, not SLAs the server measures itself against. What **is**
a hard, enforced limit is `PS_MAX_PROCESSING_MS` (default 60000 ms) on `POST /jobs`: exceeding it
aborts the request with `504 PROCESSING_TIMEOUT` and leaves no job row or files behind (see
[`docs/validation.md`](validation.md#processing-time-limit)) — a much longer ceiling than the
30-second soft target, meant to catch pathological inputs, not to certify normal-case latency.
