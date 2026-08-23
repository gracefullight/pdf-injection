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
- General-purpose font glyph remapping or arbitrary custom `/ToUnicode` manipulation, beyond the
  one narrow, documented exception the `unicode_tags` mode makes for its own tag-block codec (see
  [`unicode_tags` caveats](#unicode_tags-caveats) below) — this tool never remaps glyphs to alter
  what a sighted reader or a font-rendering pipeline sees, only what a `/ToUnicode` CMap reports
  for an already-invisible (render-mode-3) text object
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

**Both `white_text` and `render_mode_3` are reliably detectable, by design.** Independent
metamorphic-detection research (PhantomLint) reports 100% recall and a 0.092% false-positive rate
against exactly these two channels — see
[`docs/related-work.md`](related-work.md#5-detectability-finding-and-what-it-implies). This project
treats that as expected, disclosed behavior, not a defect to work around: see
[`docs/ethics-and-privacy.md`](ethics-and-privacy.md#detectability-is-by-design).

## `unicode_tags` caveats

`unicode_tags` is an **experimental** injection mode that draws the instruction as ordinary ASCII
in an invisible (`3 Tr`) text object, then rewrites the embedded font's `/ToUnicode` CMap
(post-save, public `pdf-lib` APIs only) so each glyph decodes to a Unicode Tag character
(U+E0000–U+E007F) instead of its drawn ASCII value. It shares `render_mode_3`'s zero-ink geometry
contract (nothing is painted) but has its own, more specific extraction story:

- **`hiddenTextExtracted` is ALWAYS `false` for this mode via this app's own PDF.js-based
  validation — not merely uncertain, but deterministic.** `pdfjs-dist`'s `getTextContent()`
  unconditionally filters out every glyph whose `/ToUnicode` target is Unicode General Category
  "Cf" (Format), and the entire Unicode Tags block (U+E0000–U+E007F) is category Cf by
  definition — verified by direct repro against `tests/fixtures/five-page-text.pdf` (injection
  succeeds, geometry stays identical, the output's `/ToUnicode` CMap carries the tag-encoded
  payload, yet `extractText()` reports no match on the target page for either the encoded or the
  plain instruction). This is why `computeOverall()` treats `unicode_tags` exactly like
  `render_mode_3` (recorded, never required for `FAIL`) rather than like `white_text` — every
  `unicode_tags` job is `PASS_WITH_WARNINGS`, never plain `PASS`, and that is expected/tracked
  behavior for this mode, not a validation defect.
- **The payload's actual presence in the output file is verified a different way.** Because
  `extractText()` structurally cannot confirm this mode, `packages/pdf-engine`'s
  `readUnicodeTagsPayload()` reads the output PDF's font `/ToUnicode` CMap directly (public
  `pdf-lib` APIs, independent of `pdfjs-dist`) immediately after injection. If the payload is
  genuinely absent, job creation hard-fails with `INJECTION_FAILED` (a real defect in the
  injector, not a PDF.js limitation); when it is present (the normal case), a
  `UNICODE_TAGS_NOT_EXTRACTABLE` warning is recorded in `serverValidation.warnings` explaining
  that the payload is present but invisible to this project's own PDF.js-based extraction.
- **The copy-paste-robustness hypothesis this mode exists to test is about real LLM providers'
  document ingestion, not about this app's own validation layer.** Whether a given provider's
  PDF-parsing/ingestion pipeline surfaces Unicode Tag characters (e.g. when a student copies page
  text into a chat) is an open empirical question that the Model Test benchmark measures —
  `unicode_tags` is a selectable benchmark condition alongside `original`/`white_text`/
  `render_mode_3`/`visible_positive_control`/`xmp_only` and the four round-3 probe conditions
  (see [below](#image_only--freetext_annot--acroform_field--info_dict-caveats-round-3-probes)).
  This app's own PDF.js-based parser view is known in advance to never see the payload,
  regardless of what any provider does.
- **Raster-based robustness transforms are expected to destroy this channel entirely, for two
  independent, compounding reasons**: `print_to_pdf`/`ocr_regeneration`/`screenshot_ocr` rebuild
  page content from a rasterized image (discarding any invisible text object outright, the same
  risk `render_mode_3` already carries), and even if the tag-carrying text object somehow
  survived a transform, `pdfjs-dist`'s Cf-category filtering would still hide it from this app's
  own post-transform extraction.
- **ASCII-only.** `payloadLanguage="ko"` is rejected for this mode specifically with
  `422 PROMPT_ENCODING_FAILED` — the Unicode Tag block only has a defined mapping for the ASCII
  range (0x20–0x7E); see [Instruction and payload constraints](#instruction-and-payload-constraints)
  below.

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

## `image_only` / `freetext_annot` / `acroform_field` / `info_dict` caveats (round-3 probes)

These four modes are **research/diagnostic probe conditions**, added in round 3 to answer two
narrow questions: "does the provider's ingestion pipeline have a vision path at all?"
(`image_only`) and "which text-extractor family does it use?" (the other three, via
poppler-family-vs-PDF.js-family divergence). They are **not production hiding channels** — see
[`README.md`](../README.md#injection-modes) for the disclaimer that applies to all four, and
[`docs/related-work.md`](related-work.md#5-detectability-finding-and-what-it-implies) for the
detectability framing.

- **All four are deterministically unextractable by this app's own PDF.js-based `extractText()`.**
  `hiddenTextExtracted` is always `false` for every one of them — not merely uncertain — so every
  job using one of these modes is `PASS_WITH_WARNINGS`, never plain `PASS`, and the web UI's
  Extracted Text tab shows no matched text. This is expected/tracked behavior, the same treatment
  `render_mode_3`/`unicode_tags` already get (see [`docs/validation.md`](validation.md#round-3-probe-modes-verification-independent-of-pdfjs)),
  not a validation defect.
- **`image_only` writes no text object at all.** The instruction is rasterized to a PNG
  (`@napi-rs/canvas`) and stamped in the page margin — grey, small, deliberately visible (like
  `visible_positive_control`; `diffThreshold("image_only")` is `Infinity`, not a near-zero tier).
  No text extractor can ever surface it, by construction, regardless of which PDF library or
  provider ingestion pipeline is used. Requires `@napi-rs/canvas` to be resolvable at runtime
  (through `pdfjs-dist`'s own module root, never a top-level dependency of this package); when it
  isn't, injection fails closed with `422 CANVAS_UNAVAILABLE` — on both synchronous job creation
  and a background model-test run regenerating an `image_only` condition PDF — never a silent
  text-free no-op.
- **`freetext_annot` and `acroform_field` draw real, invisible (`3 Tr`) text**, but inside a
  FreeText annotation's or an AcroForm text-field widget's own `/AP /N` appearance stream, never
  the page's own content stream — this app's PDF.js-based `extractText()` only ever walks a page's
  content stream, so it cannot see either payload regardless of the fact that the drawn text is
  real (unlike `unicode_tags`, whose invisibility is a CMap-remapping trick, not an
  appearance-stream location). Measured directly against this project's own injector output with
  poppler `pdftotext`/`pdfinfo` v26.08.0: both payloads **are** surfaced by `pdftotext` (poppler
  walks an annotation/widget's appearance-stream operators the same way it walks page content —
  render mode doesn't matter to that walk) and are **not** present in `pdfinfo` metadata. Whether
  other PDF.js-family or poppler-family extractors, or a given LLM provider's own ingestion
  pipeline, behave the same way is what the Model Test benchmark measures — not something
  concluded here. `acroform_field` never mutates a pre-existing AcroForm field, even when the
  source PDF already has one — it always adds a brand-new, uniquely-named field.
- **`info_dict` writes only to the classic `/Info` dictionary** (`Subject`/`Keywords`) — document
  metadata, not page text and not the XMP `/Metadata` stream `xmp_only` uses (a different,
  unrelated channel — see [`xmp_only` caveats](#xmp_only-caveats) above). The original `/Info
  /Title` is preserved. Measured directly: `pdftotext` does not find it, `pdfinfo` does.
- **None of the four are claimed to reach or influence a model.** Whether any provider's ingestion
  actually surfaces one of these channels is exactly what the Model Test benchmark measures — that
  measurement is separate from, and not settled by, anything on this page or by the deterministic
  local-extraction facts above.

## Instruction and payload constraints

- The hidden instruction must be **printable ASCII** (plus `\n`) when `payloadLanguage="en"`
  (the default) — anything else is rejected with `PROMPT_ENCODING_FAILED` (see
  `packages/prompt-lint`'s `NON_PRINTABLE_ASCII_RE` / `CONTROL_CHAR_RE` checks). This ASCII gate
  applies uniformly across **all nine** injection modes, including `xmp_only`/`info_dict` (which
  never draw glyphs and so have no font-rendering reason to require ASCII) — kept uniform for
  predictability rather than carving out a mode-specific exception. `unicode_tags` goes further: it
  rejects
  `payloadLanguage="ko"` outright (not just non-ASCII text under `"en"`), since its Unicode Tag
  codec only has a defined mapping for the ASCII range — see
  [`unicode_tags` caveats](#unicode_tags-caveats) above.
- The instruction is capped at `PDFI_MAX_INSTRUCTION_CHARS` (default **1500** characters).
- `payloadLanguage="ko"` lifts the ASCII restriction for Korean text and requires the bundled
  Korean font to be available on the server (`PDFI_FONT_DIR`, default
  `packages/pdf-engine/fonts/`) — see
  [Korean payload (`payloadLanguage="ko"`) mechanism](#korean-payload-payloadlanguageko-mechanism)
  below. No language besides `"en"`/`"ko"` is supported; `PrivateManifest.prompt.language` records
  whichever of the two was used (no longer hardcoded to `"en"`).

## Korean payload (`payloadLanguage="ko"`) mechanism

`payloadLanguage="ko"` embeds a Korean (Noto Sans KR, static Regular, OFL-licensed) font subset
for the three page-content drawn-text modes (`white_text`, `render_mode_3`,
`visible_positive_control`) plus the two round-3 probe modes that draw their own private
appearance-stream text the same way (`freetext_annot`, `acroform_field`). `xmp_only`/`info_dict`
accept non-ASCII Korean text too but never embed a font (no glyphs are drawn into any page or
appearance stream at all). `unicode_tags` is the one mode that does **not** accept `"ko"` at
all — it is rejected outright with `422 PROMPT_ENCODING_FAILED` before any font embedding is
attempted, since its Unicode Tag codec has no defined mapping outside printable ASCII (see
[`unicode_tags` caveats](#unicode_tags-caveats) above). The font is pre-subset with a WASM build
of HarfBuzz (`subset-font`, BSD-3-Clause,
wrapping `harfbuzzjs`, MIT) to just the instruction's codepoints plus printable ASCII, then handed
to `pdf-lib`'s own CID-keyed subset embedding path (`@pdf-lib/fontkit` provides the font
registration `pdf-lib` needs to embed any font at all) — see `packages/pdf-engine/src/korean-font.ts`.
This renders at the correct weight with full, correctly-shaped glyphs and extracts with an exact
`pdfjs-dist` text match, verified for the three page-content drawn-text modes including
`visible_positive_control`. `freetext_annot`/`acroform_field` embed and use the same font subset
for their own appearance-stream text, but — since neither mode is ever extracted by `pdfjs-dist`
at all, regardless of language (see [above](#image_only--freetext_annot--acroform_field--info_dict-caveats-round-3-probes))
— their own Korean-payload tests confirm only that the font renders and the structural
`/Contents`/`/V` value round-trips correctly; a `pdftotext` exact-text-match with Korean text
specifically is not part of this project's automated test suite (only ASCII marker strings were
checked against `pdftotext`).

`image_only` also accepts `"ko"`, but is a structural outlier: it rasterizes via
`@napi-rs/canvas`'s own `sans-serif` font resolution, never the bundled Noto Sans KR subset path
above (nothing goes through `@pdf-lib/fontkit` for this mode at all). Whether the native canvas
module has a CJK-capable system font available depends on the deployment machine — this project's
own test suite does not exercise non-ASCII text for `image_only`, so Korean glyph rendering
quality on this mode is unverified here, neither confirmed to work nor known to fail.

- Missing the font on the server (e.g. `PDFI_FONT_DIR` misconfigured, or the font file removed)
  returns `422 FONT_UNAVAILABLE` rather than silently falling back to a Latin-only font or failing
  extraction — this applies to every mode that embeds the bundled subset (the three page-content
  modes plus `freetext_annot`/`acroform_field`), not to `image_only`'s separate canvas-font path.
- No language besides Korean has a supported non-ASCII payload path; adding another script would
  require bundling and verifying its own font following the same process.

## PDF support constraints

- **Encrypted PDFs are rejected outright** (`PDF_ENCRYPTED`) — this tool never attempts to modify
  an encrypted source PDF.
- **Digitally signed PDFs are rejected outright** (`PDF_SIGNED`) — a `/Sig` field or `/DocMDP`
  entry is enough to trigger this gate; modifying a signed PDF would invalidate its signature
  anyway.
- Source PDFs over `PDFI_MAX_PAGES` (default 100) or `PDFI_MAX_FILE_BYTES` (default 25 MB) are
  rejected.
- `qpdf` structural validation is **optional and off by default**
  (`PDFI_QPDF_ENABLED=false`); it requires the `qpdf` binary to be present on `PATH`. When disabled
  or the binary is missing, `qpdfCheck()` always returns `{ status: "not_run" }` and never blocks
  a job — a clean `qpdf --check` result is treated as one extra validation signal, not proof of
  full PDF-specification compliance.

## Phase 3–5 research features: implemented, but gated and caveated

Provider benchmarking (`POST /jobs/:jobId/model-tests`), robustness transforms
(`POST /jobs/:jobId/robustness`), and submission-side detection (`POST /jobs/:jobId/submissions`)
are all implemented — see [`docs/api.md`](api.md) and
[`docs/research-protocol.md`](research-protocol.md). What remains true of every one of them:

- **Off by default, gated behind explicit env vars and per-request acknowledgements.**
  `PDFI_ALLOW_EXTERNAL_PROVIDERS=false` and `PDFI_RESEARCH_MODE=false` are the defaults; see
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
a hard, enforced limit is `PDFI_MAX_PROCESSING_MS` (default 60000 ms) on `POST /jobs`: exceeding it
aborts the request with `504 PROCESSING_TIMEOUT` and leaves no job row or files behind (see
[`docs/validation.md`](validation.md#processing-time-limit)) — a much longer ceiling than the
30-second soft target, meant to catch pathological inputs, not to certify normal-case latency.
