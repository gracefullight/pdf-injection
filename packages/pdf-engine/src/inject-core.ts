import type {
  InjectionMode,
  InjectPdfInput,
  InjectPdfResult,
  PayloadLanguage,
  ValidationWarning,
} from "@pdf-injection/contracts";
import { sha256Hex } from "@pdf-injection/validation/hash";
import { PDFDocument, type PDFFont } from "pdf-lib";
import { compareGeometry } from "./compare-geometry";
import {
  GeometryChangedError,
  InjectionFailedError,
  OutputParseFailedError,
  PromptEncodingFailedError,
} from "./errors";
import { injectAcroFormField } from "./inject-acroform-field";
import { injectFreetextAnnot } from "./inject-freetext-annot";
import { injectInfoDict } from "./inject-info-dict";
import { injectRenderMode3 } from "./inject-render-mode-3";
import { injectVisibleControl } from "./inject-visible-control";
import { injectWhiteText } from "./inject-white-text";
import { injectXmpOnly } from "./inject-xmp-only";
import { detectRiskFlags } from "./inspect-source";
import { normalizePrompt } from "./normalize-prompt";
import { snapshotPageGeometry } from "./page-geometry";
import { type CjkPayloadLanguage, isCjkPayloadLanguage } from "./payload-language";
import { resolveTargetPages } from "./resolve-target-page";

/**
 * Everything the dispatcher needs that is NOT portable across runtimes.
 *
 * The modules behind these three hooks are the only parts of the injection
 * engine that reach outside pdf-lib: CJK font embedding reads a font file
 * from disk (`node:fs`) and pre-subsets it with a WASM HarfBuzz build,
 * `image_only` rasterizes through `@napi-rs/canvas` (resolved via
 * `node:module`), and `unicode_tags` draws with that same disk-loaded font.
 * Passing them in — rather than importing them here — is what lets
 * `inject-browser.ts` build a dispatcher whose *static* module graph contains
 * no Node built-ins at all, so `apps/web` can run the identical pipeline
 * client-side (local mode) with zero duplicated orchestration logic.
 *
 * See `inject.ts` (the Node platform, unchanged public `injectPdf` API) and
 * `inject-browser.ts` (the browser platform).
 */
export interface InjectPlatform {
  /** Embeds the CJK font for `language`, or throws `FontUnavailableError`. */
  embedCjkFont: (language: CjkPayloadLanguage, doc: PDFDocument, text: string) => Promise<PDFFont>;
  /** `image_only` injector. Omit when the platform cannot rasterize. */
  injectImageOnly?: (input: {
    doc: PDFDocument;
    pageIndex: number;
    instruction: string;
    promptSha256: string;
    position: InjectPdfInput["position"];
    x?: number;
    y?: number;
    fontSize?: number;
    maxWidth?: number;
  }) => Promise<{
    doc: PDFDocument;
    boundingBox: [number, number, number, number];
    fontSize: number;
  }>;
  /** `unicode_tags` injector. Omit when the platform has no embeddable font for it. */
  injectUnicodeTags?: (input: {
    doc: PDFDocument;
    pageIndex: number;
    instruction: string;
    position: InjectPdfInput["position"];
    x?: number;
    y?: number;
    fontSize?: number;
    maxWidth?: number;
  }) => Promise<{
    doc: PDFDocument;
    boundingBox: [number, number, number, number];
    fontSize: number;
  }>;
}

// PRD §10.7: payloadLanguage "en" (default) is limited to printable ASCII (+
// newline). "ko" (round 2 §0.1) and "zh" allow non-ASCII and require a CJK
// font subset (embedCjkFont) for the three drawn-text modes.
const PRINTABLE_ASCII_RE = /^[\x20-\x7E\n]*$/;

const RISK_FLAG_WARNINGS: Array<{
  check: (flags: ReturnType<typeof detectRiskFlags>) => boolean;
  code: string;
  message: string;
}> = [
  {
    check: (f) => f.javascript,
    code: "PDF_CONTAINS_JAVASCRIPT",
    message:
      "The source PDF contains embedded JavaScript. PDF Injection never executes it — surfaced for the professor's awareness only.",
  },
  {
    check: (f) => f.embeddedFiles,
    code: "PDF_CONTAINS_EMBEDDED_FILES",
    message:
      "The source PDF contains embedded files (attachments). PDF Injection does not open or execute them.",
  },
  {
    check: (f) => f.externalUriCount > 0,
    code: "PDF_CONTAINS_EXTERNAL_URIS",
    message: "The source PDF contains external URI link(s). PDF Injection never follows them.",
  },
  {
    check: (f) => f.openAction,
    code: "PDF_HAS_OPEN_ACTION",
    message: "The source PDF declares an /OpenAction. PDF Injection never executes it.",
  },
];

/**
 * Runtime-agnostic injection dispatcher (see `InjectPlatform`). PRD §10.1/§10.2: normalizes + validates the
 * instruction encoding, hashes source/prompt, resolves the target page,
 * delegates to the mode-specific injector, then round-trips the output
 * through pdf-lib and verifies geometry preservation before returning.
 *
 * Throws PdfEngineError subclasses (PROMPT_ENCODING_FAILED / INJECTION_FAILED
 * / OUTPUT_PARSE_FAILED / GEOMETRY_CHANGED / FONT_UNAVAILABLE) that callers
 * map to ApiErrorCode.
 */
export async function injectPdfWith(
  platform: InjectPlatform,
  input: InjectPdfInput,
): Promise<InjectPdfResult> {
  const normalizedInstruction = normalizePrompt(input.instruction);
  const payloadLanguage: PayloadLanguage = input.payloadLanguage ?? "en";
  const hasNonAscii = !PRINTABLE_ASCII_RE.test(normalizedInstruction);

  if (hasNonAscii && payloadLanguage === "en") {
    throw new PromptEncodingFailedError(
      "Instruction contains characters outside printable ASCII (0x20-0x7E) plus newline. " +
        'Set payloadLanguage="ko" or payloadLanguage="zh" to allow non-ASCII text (requires a CJK font).',
    );
  }

  // unicode_tags: the Unicode Tag block only has a defined mapping for the
  // ASCII range (0x00-0x7F) — payloadLanguage="ko"/"zh" is rejected up front,
  // before any font embedding is attempted (fail fast, no wasted work, no
  // partial PDF state). Round 2 addendum §7 / plan architecture_decisions #2.
  if (input.mode === "unicode_tags" && isCjkPayloadLanguage(payloadLanguage)) {
    throw new PromptEncodingFailedError(
      `unicode_tags does not support payloadLanguage="${payloadLanguage}" — the Unicode Tag ` +
        "block (U+E0000-U+E007F) only has a defined mapping for printable ASCII (0x20-0x7E).",
    );
  }

  const sourceSha256 = sha256Hex(input.source);
  const promptSha256 = sha256Hex(normalizedInstruction);

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(input.source);
  } catch (err) {
    throw new InjectionFailedError(`Failed to load source PDF: ${(err as Error).message}`);
  }

  const riskFlags = detectRiskFlags(doc);

  const pageGeometryBefore = snapshotPageGeometry(doc);
  // targetPage="all" resolves to every page; every other value to exactly one.
  const targetPageIndexes = resolveTargetPages(input.targetPage, doc.getPageCount());

  const warnings: ValidationWarning[] = [];

  const boundingBoxes: Array<[number, number, number, number]> = [];
  let fontSize = input.fontSize ?? 1;
  /**
   * The pages actually written to — equal to `targetPageIndexes` for every
   * page-level mode, and a single entry for the two document-level modes,
   * which have no page content to repeat.
   */
  let pageIndexes: number[];

  // Korean/Chinese (non-ASCII) payload on a drawn-text mode requires the
  // matching CJK font; ASCII text under payloadLanguage="ko"/"zh" can still
  // use Helvetica. See korean-font.ts's doc comment on embedCjkFont for the
  // cycle-2/3/4 QA investigation and the HarfBuzz-pre-subsetting fix
  // (correct rendering AND extraction, for every mode including
  // visible_positive_control). Shared by every mode that draws text with a
  // pdf-lib font — white_text / render_mode_3 / visible_positive_control
  // (page content) and freetext_annot / acroform_field (their own
  // annotation/widget appearance streams, drawn under invisible render mode
  // 3 — see those injectors' module docs for why they need a real font at
  // all).
  let font: PDFFont | undefined;
  if (
    isCjkPayloadLanguage(payloadLanguage) &&
    hasNonAscii &&
    (input.mode === "white_text" ||
      input.mode === "render_mode_3" ||
      input.mode === "visible_positive_control" ||
      input.mode === "freetext_annot" ||
      input.mode === "acroform_field")
  ) {
    font = await platform.embedCjkFont(payloadLanguage, doc, normalizedInstruction);
  }

  // Runtime-capability gates run before any page is touched, so an
  // unavailable mode fails without leaving the document half-injected.
  if (input.mode === "image_only" && !platform.injectImageOnly) {
    throw new InjectionFailedError(
      'injectionMode "image_only" is not available in this runtime: it rasterizes the ' +
        "instruction through a native canvas, which only the server has. Generate this mode " +
        "against a running API server.",
    );
  }
  if (input.mode === "unicode_tags" && !platform.injectUnicodeTags) {
    throw new InjectionFailedError(
      'injectionMode "unicode_tags" is not available in this runtime: it draws with the ' +
        "bundled CJK font subset, which is only loadable on the server. Generate this mode " +
        "against a running API server.",
    );
  }

  if (input.mode === "xmp_only" || input.mode === "info_dict") {
    // Document-level payloads: no page content stream is touched, so
    // targetPage="all" has nothing to repeat — write the single payload and
    // report the first resolved page. No font needed regardless of language.
    pageIndexes = [targetPageIndexes[0] as number];
    const result =
      input.mode === "xmp_only"
        ? await injectXmpOnly({ doc, instruction: normalizedInstruction, promptSha256 })
        : await injectInfoDict({ doc, instruction: normalizedInstruction, promptSha256 });
    boundingBoxes.push(result.boundingBox);
    fontSize = result.fontSize;
  } else {
    // Page-level modes. With targetPage="all" the mode's injector simply runs
    // once per page; image_only and unicode_tags each perform their own
    // internal save/reload cycle and hand back a fresh PDFDocument, so `doc`
    // is rebound every iteration and the next page draws into that instance.
    // That makes "all" cost one full save/reload per page for those two modes —
    // acceptable because page count is already bounded (LIMITS.maxPages).
    pageIndexes = targetPageIndexes;

    for (const pageIndex of pageIndexes) {
      if (input.mode === "freetext_annot") {
        // Appearance draws the instruction for real under invisible render mode
        // 3 (see injectFreetextAnnot's module doc for why) — needs a font.
        const result = await injectFreetextAnnot({
          doc,
          pageIndex,
          instruction: normalizedInstruction,
          promptSha256,
          position: input.position,
          x: input.x,
          y: input.y,
          fontSize: input.fontSize,
          maxWidth: input.maxWidth,
          font,
        });
        boundingBoxes.push(result.boundingBox);
        fontSize = result.fontSize;
      } else if (input.mode === "acroform_field") {
        // Appearance draws the instruction for real under invisible render mode
        // 3 (see injectAcroFormField's module doc for why) — needs a font.
        const result = await injectAcroFormField({
          doc,
          pageIndex,
          instruction: normalizedInstruction,
          promptSha256,
          position: input.position,
          x: input.x,
          y: input.y,
          fontSize: input.fontSize,
          maxWidth: input.maxWidth,
          font,
        });
        boundingBoxes.push(result.boundingBox);
        fontSize = result.fontSize;
      } else if (input.mode === "image_only") {
        // Rasterizes via @napi-rs/canvas (never pdf-lib text APIs) + a post-save,
        // public-pdf-lib-API image-XObject-dict tag — the injector performs its
        // OWN internal save/reload cycle and returns the reloaded PDFDocument
        // instance; swap the dispatcher's local `doc` to it BEFORE the
        // dispatcher's own final save/reload/geometry-check step below (which
        // then runs unchanged) — same contract as unicode_tags below.
        const result = await (
          platform.injectImageOnly as NonNullable<InjectPlatform["injectImageOnly"]>
        )({
          doc,
          pageIndex,
          instruction: normalizedInstruction,
          promptSha256,
          position: input.position,
          x: input.x,
          y: input.y,
          fontSize: input.fontSize,
          maxWidth: input.maxWidth,
        });
        doc = result.doc;
        boundingBoxes.push(result.boundingBox);
        fontSize = result.fontSize;
      } else if (input.mode === "unicode_tags") {
        // Draws via embedKoreanFont() (ASCII-complete, never shared with any
        // visible text) + a post-save, public-pdf-lib-API /ToUnicode CMap
        // rewrite — the injector performs its OWN internal save/reload cycle
        // and returns the reloaded, CMap-rewritten PDFDocument instance; swap
        // the dispatcher's local `doc` to it BEFORE the dispatcher's own final
        // save/reload/geometry-check step below (which then runs unchanged).
        // Each iteration registers its own font on its own page, so an earlier
        // page's already-rewritten CMap is never revisited.
        const result = await (
          platform.injectUnicodeTags as NonNullable<InjectPlatform["injectUnicodeTags"]>
        )({
          doc,
          pageIndex,
          instruction: normalizedInstruction,
          position: input.position,
          x: input.x,
          y: input.y,
          fontSize: input.fontSize,
          maxWidth: input.maxWidth,
        });
        doc = result.doc;
        boundingBoxes.push(result.boundingBox);
        fontSize = result.fontSize;
      } else {
        // white_text / render_mode_3 / visible_positive_control — `font` was
        // already resolved above (shared with freetext_annot/acroform_field).
        const injectorInput = {
          doc,
          pageIndex,
          instruction: normalizedInstruction,
          position: input.position,
          x: input.x,
          y: input.y,
          fontSize: input.fontSize,
          maxWidth: input.maxWidth,
          font,
        };

        const result =
          input.mode === "white_text"
            ? await injectWhiteText(injectorInput)
            : input.mode === "render_mode_3"
              ? await injectRenderMode3(injectorInput)
              : await injectVisibleControl(injectorInput);
        boundingBoxes.push(result.boundingBox);
        fontSize = result.fontSize;
      }
    }

    if (input.mode === "white_text") {
      // Best-effort: we don't sample the page background, so we can't assert
      // BACKGROUND_NOT_WHITE either way — surface an informational
      // accessibility warning instead (PRD §10.3 "필수 보호"). One warning for
      // the whole job, not one per page: `pageIndex` is only meaningful when a
      // single page was injected.
      warnings.push({
        code: "ACCESSIBILITY_HIDDEN_TEXT",
        message:
          `White-on-white hidden text${pageIndexes.length > 1 ? ` (on all ${pageIndexes.length} pages)` : ""} ` +
          "may be exposed by dark-mode viewers, screen readers, or select-all/copy. Background color was not sampled (best-effort check).",
        ...(pageIndexes.length === 1 ? { pageIndex: pageIndexes[0] as number } : {}),
      });
    }
  }

  for (const rule of RISK_FLAG_WARNINGS) {
    if (rule.check(riskFlags)) {
      warnings.push({ code: rule.code, message: rule.message });
    }
  }

  let bytes: Uint8Array;
  try {
    bytes = await doc.save();
  } catch (err) {
    throw new InjectionFailedError(`Failed to save the injected PDF: ${(err as Error).message}`);
  }

  const outputSha256 = sha256Hex(bytes);

  let reloaded: PDFDocument;
  try {
    reloaded = await PDFDocument.load(bytes);
  } catch (err) {
    throw new OutputParseFailedError(
      `Failed to re-parse the generated PDF: ${(err as Error).message}`,
    );
  }

  const pageGeometryAfter = snapshotPageGeometry(reloaded);
  const geometryResult = compareGeometry(pageGeometryBefore, pageGeometryAfter);
  if (!geometryResult.passed) {
    throw new GeometryChangedError(
      `Page geometry changed after injection: ${geometryResult.mismatches.map((m) => `${m.field}@page${m.pageIndex}`).join(", ")}`,
    );
  }

  return {
    bytes,
    sourceSha256,
    outputSha256,
    promptSha256,
    pageIndex: pageIndexes[0] as number,
    pageIndexes,
    modes: [input.mode],
    pageGeometryBefore,
    pageGeometryAfter,
    warnings,
    boundingBox: boundingBoxes[0] as [number, number, number, number],
    boundingBoxes,
    fontSize,
  };
}

/** Deduplicate an injection-mode list, preserving first-seen order. */
function dedupeModes(modes: readonly InjectionMode[]): InjectionMode[] {
  const seen = new Set<InjectionMode>();
  const out: InjectionMode[] = [];
  for (const mode of modes) {
    if (!seen.has(mode)) {
      seen.add(mode);
      out.push(mode);
    }
  }
  return out;
}

/**
 * Multi-channel injection dispatcher. Applies every mode in `input.modes`
 * (deduped, in first-seen order) to the same document by chaining the existing
 * single-mode `injectPdfWith` — each mode injects into the previous mode's
 * output bytes.
 *
 * This composes rather than re-implementing the per-mode dispatch because the
 * mode-specific injectors each touch an independent PDF structure (page
 * content stream / AcroForm widget / FreeText annotation / /Info dict / XMP
 * metadata), so a serial pass is equivalent to injecting them together, and
 * every mode's own geometry-preservation gate re-runs against the combined
 * output. A `["render_mode_3", "acroform_field"]` selection therefore yields
 * one PDF carrying both an invisible page text object and a hidden form-field
 * payload.
 *
 * Single-mode input (`modes` absent, empty, or length 1) delegates straight to
 * `injectPdfWith` and returns an identical result.
 *
 * The aggregated result reports the ORIGINAL source geometry/hash as `before`/
 * `sourceSha256`, the FINAL combined output as `bytes`/`outputSha256`, the
 * union of every injected page index, and every mode's bounding boxes in
 * application order. Duplicate warnings (e.g. a source risk flag re-detected on
 * each pass) are collapsed by `code` + `pageIndex`.
 */
export async function injectPdfMultiWith(
  platform: InjectPlatform,
  input: InjectPdfInput,
): Promise<InjectPdfResult> {
  const modes = dedupeModes(input.modes?.length ? input.modes : [input.mode]);
  if (modes.length === 1) {
    return injectPdfWith(platform, { ...input, mode: modes[0] as InjectionMode });
  }

  let source = input.source;
  let first: InjectPdfResult | undefined;
  let last: InjectPdfResult | undefined;
  const boundingBoxes: Array<[number, number, number, number]> = [];
  const pageIndexSet = new Set<number>();
  const warnings: ValidationWarning[] = [];
  const seenWarnings = new Set<string>();

  for (const mode of modes) {
    const result = await injectPdfWith(platform, { ...input, source, mode });
    // Chain: the next mode injects into this mode's output. `sourceSha256`/
    // geometry-before below deliberately come from the FIRST pass (the real
    // original document), not from these intermediate bytes.
    source = result.bytes;
    first ??= result;
    last = result;
    boundingBoxes.push(...result.boundingBoxes);
    for (const pageIndex of result.pageIndexes) pageIndexSet.add(pageIndex);
    for (const warning of result.warnings) {
      const key = `${warning.code}@${warning.pageIndex ?? "-"}`;
      if (!seenWarnings.has(key)) {
        seenWarnings.add(key);
        warnings.push(warning);
      }
    }
  }

  const firstResult = first as InjectPdfResult;
  const lastResult = last as InjectPdfResult;
  const pageIndexes = [...pageIndexSet].sort((a, b) => a - b);

  return {
    bytes: lastResult.bytes,
    sourceSha256: firstResult.sourceSha256,
    outputSha256: lastResult.outputSha256,
    promptSha256: firstResult.promptSha256,
    pageIndex: pageIndexes[0] as number,
    pageIndexes,
    modes,
    pageGeometryBefore: firstResult.pageGeometryBefore,
    pageGeometryAfter: lastResult.pageGeometryAfter,
    warnings,
    boundingBox: boundingBoxes[0] as [number, number, number, number],
    boundingBoxes,
    fontSize: firstResult.fontSize,
  };
}
