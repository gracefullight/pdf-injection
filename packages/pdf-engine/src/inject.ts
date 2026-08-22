import type {
  InjectPdfInput,
  InjectPdfResult,
  PayloadLanguage,
  ValidationWarning,
} from "@pdf-injection/contracts";
import { sha256Hex } from "@pdf-injection/validation";
import { PDFDocument, type PDFFont } from "pdf-lib";
import { compareGeometry } from "./compare-geometry";
import {
  GeometryChangedError,
  InjectionFailedError,
  OutputParseFailedError,
  PromptEncodingFailedError,
} from "./errors";
import { injectRenderMode3 } from "./inject-render-mode-3";
import { injectVisibleControl } from "./inject-visible-control";
import { injectWhiteText } from "./inject-white-text";
import { injectXmpOnly } from "./inject-xmp-only";
import { detectRiskFlags } from "./inspect-source";
import { embedKoreanFont } from "./korean-font";
import { normalizePrompt } from "./normalize-prompt";
import { snapshotPageGeometry } from "./page-geometry";
import { resolveTargetPage } from "./resolve-target-page";

// PRD §10.7: payloadLanguage "en" (default) is limited to printable ASCII (+
// newline). "ko" (round 2 §0.1) allows non-ASCII and requires a CJK font
// subset (embedKoreanFont) for the three drawn-text modes.
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
 * Injection engine dispatcher. PRD §10.1/§10.2: normalizes + validates the
 * instruction encoding, hashes source/prompt, resolves the target page,
 * delegates to the mode-specific injector, then round-trips the output
 * through pdf-lib and verifies geometry preservation before returning.
 *
 * Throws PdfEngineError subclasses (PROMPT_ENCODING_FAILED / INJECTION_FAILED
 * / OUTPUT_PARSE_FAILED / GEOMETRY_CHANGED / FONT_UNAVAILABLE) that callers
 * map to ApiErrorCode.
 */
export async function injectPdf(input: InjectPdfInput): Promise<InjectPdfResult> {
  const normalizedInstruction = normalizePrompt(input.instruction);
  const payloadLanguage: PayloadLanguage = input.payloadLanguage ?? "en";
  const hasNonAscii = !PRINTABLE_ASCII_RE.test(normalizedInstruction);

  if (hasNonAscii && payloadLanguage === "en") {
    throw new PromptEncodingFailedError(
      "Instruction contains characters outside printable ASCII (0x20-0x7E) plus newline. " +
        'Set payloadLanguage="ko" to allow non-ASCII text (requires a CJK font).',
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
  const pageIndex = resolveTargetPage(input.targetPage, doc.getPageCount());

  const warnings: ValidationWarning[] = [];

  let boundingBox: [number, number, number, number];
  let fontSize: number;

  if (input.mode === "xmp_only") {
    // No page content stream is touched — no font needed regardless of language.
    ({ boundingBox, fontSize } = await injectXmpOnly({
      doc,
      instruction: normalizedInstruction,
      promptSha256,
    }));
  } else {
    // Korean (non-ASCII) payload on a drawn-text mode requires the CJK font;
    // ASCII text under payloadLanguage="ko" can still use Helvetica. See
    // korean-font.ts's doc comment on embedKoreanFont for the cycle-2/3/4 QA
    // investigation and the HarfBuzz-pre-subsetting fix (correct rendering
    // AND extraction, for every mode including visible_positive_control).
    let font: PDFFont | undefined;
    if (payloadLanguage === "ko" && hasNonAscii) {
      font = await embedKoreanFont(doc, normalizedInstruction);
    }

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

    ({ boundingBox, fontSize } =
      input.mode === "white_text"
        ? await injectWhiteText(injectorInput)
        : input.mode === "render_mode_3"
          ? await injectRenderMode3(injectorInput)
          : await injectVisibleControl(injectorInput));

    if (input.mode === "white_text") {
      // Best-effort: we don't sample the page background, so we can't assert
      // BACKGROUND_NOT_WHITE either way — surface an informational
      // accessibility warning instead (PRD §10.3 "필수 보호").
      warnings.push({
        code: "ACCESSIBILITY_HIDDEN_TEXT",
        message:
          "White-on-white hidden text may be exposed by dark-mode viewers, screen readers, or select-all/copy. Background color was not sampled (best-effort check).",
        pageIndex,
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
    pageIndex,
    pageGeometryBefore,
    pageGeometryAfter,
    warnings,
    boundingBox,
    fontSize,
  };
}
