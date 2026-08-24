import type { Position } from "@pdf-injection/contracts";
import {
  beginText,
  endText,
  PDFDict,
  PDFDocument,
  type PDFFont,
  PDFHexString,
  PDFName,
  PDFString,
  StandardFonts,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  TextRenderingMode,
} from "pdf-lib";
import { InjectionFailedError, PdfEngineError } from "./errors";
import type { InjectTextResult } from "./inject-white-text";
import {
  DEFAULT_MARGIN_X,
  DEFAULT_MARGIN_Y,
  layoutTextBlock,
  resolveBoxPosition,
  wrapTextToLines,
} from "./text-layout";

/** Custom key tagging the annotation with the prompt hash, for round-trip verification independent of `/Contents`. */
export const FREETEXT_PROMPT_SHA256_KEY = "PdfiPromptSha256";
/** Resource key for the appearance stream's local font dict. */
const APPEARANCE_FONT_KEY = "FAnnot";
/** Matches render_mode_3's default — content is invisible either way. */
const DEFAULT_FONT_SIZE = 1;

export interface InjectFreetextAnnotInput {
  doc: PDFDocument;
  pageIndex: number;
  instruction: string;
  promptSha256: string;
  position: Position;
  x?: number;
  y?: number;
  fontSize?: number;
  maxWidth?: number;
  /** Custom font (e.g. embedded Noto Sans KR subset for payloadLanguage "ko"); defaults to Helvetica. */
  font?: PDFFont;
}

/**
 * FREETEXT-01 (freetext_annot) — round-3 research/diagnostic condition:
 * stores the hidden instruction in a FreeText annotation on the target
 * page. No PAGE content stream is touched — geometry and the page's own
 * visible/extracted content are byte-for-byte unaffected.
 *
 * **Design finding (empirically verified with `pdftotext`, not assumed —
 * see this package's backend result memory for the probe transcript):**
 * poppler's `pdftotext` does NOT walk an annotation's raw `/Contents`
 * string structurally. It extracts text by walking the annotation's `/AP
 * /N` APPEARANCE STREAM's content-stream operators — exactly the same
 * operator-walk it uses for ordinary page content. This means:
 *   - A real `Tj`/`TJ` text-showing operator in the appearance IS
 *     extracted by `pdftotext`, REGARDLESS of PDF text-rendering mode (`Tr
 *     3` invisible mode included) — mirroring exactly how `render_mode_3`
 *     already works for page content.
 *   - The Hidden annotation flag (`/F` bit 2) makes poppler skip the
 *     annotation's appearance walk ENTIRELY — it must NOT be set, or this
 *     mode stops being extractable via poppler, defeating its purpose.
 *   - A genuinely empty appearance (an earlier design of this injector, now
 *     replaced) is therefore extractable by NEITHER poppler NOR any
 *     rendering-based check, which made it useless as a probe.
 *
 * So this injector draws the wrapped instruction into the annotation's own
 * private `/AP /N` Form XObject using PDF text-rendering mode 3 (`3 Tr`,
 * invisible — neither filled nor stroked), the exact same technique
 * `inject-render-mode-3.ts` uses for page content, just scoped to the
 * annotation's own local (BBox-relative) coordinate space instead of the
 * page's. This achieves BOTH goals at once: `pdftotext` extraction (operator
 * walk doesn't care about render mode) and near-zero pixel diff (rendering
 * DOES respect `Tr 3` — nothing is painted).
 *
 * The raw `/Contents` string is ALSO set (via `PDFHexString.fromText`, the
 * same unicode-safe encoding `PDFDocument.setTitle`/`PDFTextField.setValue`
 * use internally) for structural completeness / non-ASCII round-tripping,
 * even though it isn't what `pdftotext` actually reads.
 */
export async function injectFreetextAnnot(
  input: InjectFreetextAnnotInput,
): Promise<InjectTextResult> {
  try {
    const { doc, pageIndex, instruction, promptSha256 } = input;
    const page = doc.getPage(pageIndex);
    const font = input.font ?? (await doc.embedFont(StandardFonts.Helvetica));
    const fontSize = input.fontSize ?? DEFAULT_FONT_SIZE;
    const lineHeight = fontSize * 1.2;
    const boxWidth = input.maxWidth ?? page.getWidth() - 2 * DEFAULT_MARGIN_X;
    const innerMaxWidth = boxWidth - 2 * DEFAULT_MARGIN_X;

    const lines = wrapTextToLines(instruction, font, fontSize, innerMaxWidth);
    const boxHeight = Math.max(lines.length, 1) * lineHeight + 2 * DEFAULT_MARGIN_Y;

    // Lays out the wrapped lines within the annotation's OWN local
    // (0,0)-origin coordinate space, treating the box like a tiny "page".
    const local = layoutTextBlock({
      pageWidth: boxWidth,
      pageHeight: boxHeight,
      lines,
      fontSize,
      lineHeight,
      maxWidth: innerMaxWidth,
      position: "top",
      font,
    });

    const { x, y } = resolveBoxPosition({
      pageHeight: page.getHeight(),
      width: boxWidth,
      height: boxHeight,
      position: input.position,
      x: input.x,
      y: input.y,
    });
    // Clamp the on-page annotation /Rect to a 1×1 point. Annotation EDITORS
    // (Ed workspace, Acrobat comment mode, …) deliberately ignore NoView to let
    // users edit, and otherwise render a full-width selection box with drag
    // handles over the whole payload region. A 1×1 /Rect collapses that
    // selectable footprint to a single point. The instruction still lives, at
    // full layout size, in the /AP /N appearance stream's own BBox below — which
    // poppler's pdftotext walks by operator, independent of /Rect — so
    // extraction is unaffected; the viewer just scales the (invisible) appearance
    // into the 1×1 rect.
    const rect: [number, number, number, number] = [x, y, x + 1, y + 1];
    const bbox: [number, number, number, number] = [0, 0, boxWidth, boxHeight];

    const contentOps = [
      beginText(),
      setTextRenderingMode(TextRenderingMode.Invisible),
      setFontAndSize(APPEARANCE_FONT_KEY, fontSize),
    ];
    local.linePositions.forEach((pos, i) => {
      const line = lines[i];
      if (line === undefined) return;
      contentOps.push(setTextMatrix(1, 0, 0, 1, pos.x, pos.y), showText(font.encodeText(line)));
    });
    contentOps.push(endText());

    const appearanceStream = doc.context.contentStream(contentOps, {
      Type: "XObject",
      Subtype: "Form",
      FormType: 1,
      BBox: bbox,
      Resources: { Font: { [APPEARANCE_FONT_KEY]: font.ref } },
    });
    const appearanceRef = doc.context.register(appearanceStream);

    // Without an explicit /F, the annotation defaults to flags 0 — displayed,
    // printed AND interactive. Even though the /AP /N below paints nothing
    // (3 Tr), the annotation's /Rect stays a live hotspot: viewers show a
    // selection cursor there and double-click enters FreeText edit mode. The
    // NoView flag (bit 6) tells viewers not to render it on screen OR let it
    // interact with the user (PDF 32000-1 Table 165) — so no click target
    // exists — while Print stays on and, crucially, it is NOT Hidden (bit 2),
    // which is the only flag poppler's pdftotext skips (same finding as the
    // acroform_field NoView fix). Extraction survives; the annotation can't be
    // clicked or edited.
    const NOVIEW_FLAG = 1 << 5; // bit 6 (NoView) = 32
    const PRINT_FLAG = 1 << 2; // bit 3 (Print) = 4
    const annotDict = doc.context.obj({
      Type: "Annot",
      Subtype: "FreeText",
      F: NOVIEW_FLAG | PRINT_FLAG,
      Rect: rect,
      Contents: PDFHexString.fromText(instruction),
      // /DA is a fixed, always-ASCII "default appearance" operator string
      // (advisory, never actually rendered — the real content lives in
      // /AP /N above) — a plain PDFString avoids a spurious UTF-16BE BOM
      // that some viewers' /DA mini-parsers warn about (harmless, but
      // avoidable) when the value instead carries no real payload data.
      DA: PDFString.of("0 g"),
      AP: { N: appearanceRef },
      [FREETEXT_PROMPT_SHA256_KEY]: PDFHexString.fromText(promptSha256),
    });
    const annotRef = doc.context.register(annotDict);
    page.node.addAnnot(annotRef);

    return { boundingBox: rect, fontSize };
  } catch (err) {
    if (err instanceof PdfEngineError) throw err;
    throw new InjectionFailedError(`freetext_annot injection failed: ${(err as Error).message}`);
  }
}

export interface FreetextAnnotPayload {
  contentsPresent: boolean;
  contents: string | null;
  promptSha256: string | null;
}

/**
 * Reads back the first FreeText annotation on `pageIndex` (if any) and
 * extracts its `/Contents` + the custom prompt-hash tag, using only public
 * pdf-lib APIs — independent of pdfjs-dist page-text extraction (and of
 * `pdftotext`'s actual extraction mechanism, which reads the appearance
 * stream instead — see this module's doc comment).
 */
export async function readFreetextAnnotPayload(
  bytes: Uint8Array,
  pageIndex: number,
): Promise<FreetextAnnotPayload> {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(pageIndex);
  const annots = page.node.Annots();
  if (!annots) return { contentsPresent: false, contents: null, promptSha256: null };

  for (let i = 0; i < annots.size(); i++) {
    const annot = annots.lookupMaybe(i, PDFDict);
    if (!annot) continue;

    const subtype = annot.lookupMaybe(PDFName.of("Subtype"), PDFName);
    if (subtype !== PDFName.of("FreeText")) continue;

    const contents = annot.lookupMaybe(PDFName.of("Contents"), PDFHexString);
    const sha = annot.lookupMaybe(PDFName.of(FREETEXT_PROMPT_SHA256_KEY), PDFHexString);
    if (contents) {
      return {
        contentsPresent: true,
        contents: contents.decodeText(),
        promptSha256: sha ? sha.decodeText() : null,
      };
    }
  }

  return { contentsPresent: false, contents: null, promptSha256: null };
}
