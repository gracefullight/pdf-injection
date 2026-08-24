import type { Position } from "@pdf-injection/contracts";
import {
  beginText,
  endText,
  PDFDocument,
  type PDFFont,
  PDFName,
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

/** Prefix shared by the injector and reader to locate the probe field among any pre-existing AcroForm fields. */
export const ACROFORM_FIELD_NAME_PREFIX = "pdfi_probe_";
/** Matches render_mode_3's default — content is invisible either way. */
const DEFAULT_FONT_SIZE = 1;

export interface InjectAcroFormFieldInput {
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
 * Picks a fully-qualified field name that doesn't collide with any
 * pre-existing field in `form` (relevant when injecting into a source PDF
 * that already has an AcroForm, e.g. `tests/fixtures/form.pdf`).
 */
function uniqueFieldName(form: ReturnType<PDFDocument["getForm"]>, base: string): string {
  if (!form.getFieldMaybe(base)) return base;
  let suffix = 1;
  while (form.getFieldMaybe(`${base}_${suffix}`)) suffix++;
  return `${base}_${suffix}`;
}

/**
 * ACROFORM-01 (acroform_field) — round-3 research/diagnostic condition:
 * stores the hidden instruction in a new AcroForm text field on the target
 * page. No PAGE content stream is touched — geometry and the page's own
 * visible/extracted content are byte-for-byte unaffected. Adds a brand-new
 * field (never mutates a pre-existing field, even if the source PDF
 * already has an AcroForm — see `uniqueFieldName`).
 *
 * **Design finding (empirically verified with `pdftotext`, not assumed —
 * see this package's backend result memory for the probe transcript, and
 * `inject-freetext-annot.ts`'s module doc for the identical finding on
 * annotations generally):** poppler's `pdftotext` extracts a form widget's
 * text by walking its `/AP /N` appearance-stream OPERATORS, not the field's
 * raw `/V` value structurally — and it skips the widget's appearance
 * entirely if the Hidden annotation flag is set. So this injector must
 * NOT set `hidden: true`, and must draw the actual instruction into the
 * widget's appearance using PDF text-rendering mode 3 (`3 Tr`, invisible)
 * rather than relying on an empty appearance or the Hidden flag — both of
 * which (an earlier design of this injector) made the payload
 * unextractable by anything, defeating the mode's purpose.
 *
 * Uses pdf-lib's public high-level `PDFForm`/`PDFTextField` API
 * (`doc.getForm()`, `form.createTextField()`, `textField.setText()`,
 * `textField.addToPage()`, `textField.updateAppearances(font, provider)`
 * with a custom appearance provider drawing the `3 Tr` operators — the
 * same public escape hatch `pdf-lib`'s own docs describe for replacing the
 * default text-field appearance). `/V` is ALSO set via `setText()` (which
 * internally encodes through pdf-lib's own unicode-safe
 * `PDFHexString.fromText`) for structural completeness / non-ASCII
 * round-tripping, even though it isn't what `pdftotext` actually reads.
 *
 * Returns `boundingBox` as the widget's actual placement rect.
 */
export async function injectAcroFormField(
  input: InjectAcroFormFieldInput,
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

    // Lays out the wrapped lines within the widget's OWN local (0,0)-origin
    // coordinate space (the appearance stream's BBox), treating the box
    // like a tiny "page" — same approach as inject-freetext-annot.ts.
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

    const form = doc.getForm();
    const fieldName = uniqueFieldName(
      form,
      `${ACROFORM_FIELD_NAME_PREFIX}${promptSha256.slice(0, 12)}`,
    );
    const textField = form.createTextField(fieldName);
    textField.setText(instruction);
    textField.addToPage(page, {
      x,
      y,
      width: boxWidth,
      height: boxHeight,
      borderWidth: 0,
      font,
    });
    // Interactive PDF viewers (Chrome/pdfium, macOS Preview, Acrobat) render a
    // text field's `/V` value through its `/DA` (black, real fill mode) instead
    // of the invisible `3 Tr` appearance stream below — so without this the
    // payload shows up as visible black text on screen. Setting the widget's
    // NoView flag (annotation flag bit 6) tells viewers not to DISPLAY the
    // widget on screen, while Print stays on and `pdftotext`/providers still
    // walk the appearance stream (they skip Hidden widgets, not NoView ones).
    // That keeps the channel extractable but genuinely invisible on screen.
    const NOVIEW_FLAG = 1 << 5; // PDF annotation flag bit 6 (NoView) = 32
    // 1×1 /Rect: form editors that ignore NoView otherwise draw a full-width
    // selection box with drag handles over the field. Collapse the on-page
    // widget rect to a single point while the invisible appearance (built at
    // full boxWidth×boxHeight above) stays in the widget's own /AP BBox — the
    // viewer scales it into the 1×1 rect, and pdftotext still walks the
    // appearance operators regardless of rect size.
    const tinyRect = doc.context.obj([x, y, x + 1, y + 1]);
    for (const widget of textField.acroField.getWidgets()) {
      widget.setFlags(widget.getFlags() | NOVIEW_FLAG);
      widget.dict.set(PDFName.of("Rect"), tinyRect);
    }
    // Overrides pdf-lib's default text-field appearance provider (which
    // would paint a visible background/border and real fill-mode glyphs)
    // with a custom one drawing the SAME wrapped lines under `3 Tr`
    // (invisible render mode) — extractable by pdftotext's operator walk,
    // painted as nothing by any renderer.
    textField.updateAppearances(font, (_field, _widget, widgetFont) => {
      const ops = [
        beginText(),
        setTextRenderingMode(TextRenderingMode.Invisible),
        setFontAndSize(widgetFont.name, fontSize),
      ];
      local.linePositions.forEach((pos, i) => {
        const line = lines[i];
        if (line === undefined) return;
        ops.push(setTextMatrix(1, 0, 0, 1, pos.x, pos.y), showText(widgetFont.encodeText(line)));
      });
      ops.push(endText());
      return ops;
    });

    return { boundingBox: [x, y, x + boxWidth, y + boxHeight], fontSize };
  } catch (err) {
    if (err instanceof PdfEngineError) throw err;
    throw new InjectionFailedError(`acroform_field injection failed: ${(err as Error).message}`);
  }
}

export interface AcroFormFieldPayload {
  fieldPresent: boolean;
  fieldName: string | null;
  value: string | null;
}

/**
 * Reads back the probe AcroForm text field (name-prefixed with
 * `ACROFORM_FIELD_NAME_PREFIX`) added by `injectAcroFormField`, using only
 * pdf-lib's public `PDFForm` API — independent of pdfjs-dist page-text
 * extraction (and of `pdftotext`'s actual extraction mechanism, which reads
 * the appearance stream instead — see this module's doc comment).
 */
export async function readAcroFormFieldPayload(bytes: Uint8Array): Promise<AcroFormFieldPayload> {
  const doc = await PDFDocument.load(bytes);
  const form = doc.getForm();

  for (const field of form.getFields()) {
    const name = field.getName();
    if (!name.startsWith(ACROFORM_FIELD_NAME_PREFIX)) continue;

    const textField = form.getTextField(name);
    return { fieldPresent: true, fieldName: name, value: textField.getText() ?? null };
  }

  return { fieldPresent: false, fieldName: null, value: null };
}
