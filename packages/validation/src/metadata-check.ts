// pdfjs-dist legacy build runs under Bun (see text-extract.ts for the spike
// note). getMetadata() parses the catalog's /Metadata stream the same way
// getDocument() parses everything else, so it is the primary path here too.
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { sha256Hex } from "./hash";

export interface MetadataCheckResult {
  /** Whether the PDF has a non-empty XMP /Metadata stream at all. */
  xmpPresent: boolean;
  /** Whether the discovered XMP content contains the expected instruction. */
  payloadFound: boolean;
  /** sha256 of the raw XMP metadata stream content, or null when xmpPresent is false. */
  sha256OfPayload: string | null;
}

const NOT_PRESENT: MetadataCheckResult = {
  xmpPresent: false,
  payloadFound: false,
  sha256OfPayload: null,
};

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Raw-bytes fallback: locates a `/Type /Metadata` object's `stream ...
 * endstream` body directly in the PDF bytes. Used when pdfjs cannot expose
 * document metadata (e.g. a hand-built or structurally unusual fixture) so
 * this check stays useful without depending on pdfjs's own object graph.
 *
 * Scans as latin1 (1 byte = 1 char) so byte offsets for the ASCII
 * `stream`/`endstream` keywords line up exactly with the source bytes, then
 * re-decodes the extracted slice as UTF-8 (XMP packets are UTF-8 XML).
 */
function scanRawMetadataStream(bytes: Uint8Array): string | null {
  const latin1 = Buffer.from(bytes).toString("latin1");

  const typeIndex = latin1.search(/\/Type\s*\/Metadata\b/);
  if (typeIndex === -1) return null;

  // The `stream` keyword may appear before or after `/Type /Metadata` inside
  // the object; search from the start of the object dictionary (a handful of
  // bytes before /Type) rather than strictly after it.
  const searchFrom = Math.max(0, typeIndex - 200);
  const objStart = latin1.lastIndexOf("obj", typeIndex);
  const streamIndex = latin1.indexOf(
    "stream",
    Math.max(searchFrom, objStart === -1 ? searchFrom : objStart),
  );
  if (streamIndex === -1) return null;

  let dataStart = streamIndex + "stream".length;
  if (latin1[dataStart] === "\r") dataStart++;
  if (latin1[dataStart] === "\n") dataStart++;

  const endIndex = latin1.indexOf("endstream", dataStart);
  if (endIndex === -1) return null;

  const raw = latin1.slice(dataStart, endIndex);
  if (raw.trim().length === 0) return null;

  return Buffer.from(raw, "latin1").toString("utf-8");
}

/**
 * Checks whether a PDF carries an XMP `/Metadata` payload (injectionMode
 * `xmp_only` — packages/pdf-engine `inject-xmp-only.ts`) and whether it
 * contains the expected hidden instruction. PRD §13.5-equivalent server
 * validation step for the round-2 `xmp_only` research control mode.
 *
 * Two-step detection:
 *  1. pdfjs-dist's `getMetadata()` / `Metadata#getRaw()` — the same parser
 *     path used elsewhere in this package (text-extract.ts), so results are
 *     consistent with how the rest of the app "sees" the PDF.
 *  2. A raw-bytes scan for a `/Type /Metadata` stream, used only when step 1
 *     finds nothing — covers fixtures/PDFs pdfjs fails to fully parse.
 *
 * `payloadFound` matches on: the exact instruction substring, a
 * whitespace-normalized substring match, or the instruction's sha256 hex
 * digest appearing in the XMP content (in case the payload stores a hash
 * rather than — or in addition to — the plaintext instruction).
 */
export async function checkMetadataPayload(
  bytes: Uint8Array,
  expectedInstruction: string,
): Promise<MetadataCheckResult> {
  let rawXmp: string | null = null;

  try {
    const loadingTask = pdfjsLib.getDocument({
      // pdf.js detaches the underlying ArrayBuffer of `data` once loaded;
      // pass a defensive copy so the caller's buffer stays usable afterward.
      data: bytes.slice(),
      useWorkerFetch: false,
      isEvalSupported: false,
      disableFontFace: true,
    });
    const pdf = await loadingTask.promise;
    const { metadata } = await pdf.getMetadata();
    if (metadata) {
      const raw = metadata.getRaw();
      if (typeof raw === "string" && raw.trim().length > 0) {
        rawXmp = raw;
      }
    }
  } catch {
    // Fall through to the raw-bytes scan below.
  }

  if (rawXmp === null) {
    rawXmp = scanRawMetadataStream(bytes);
  }

  if (rawXmp === null || rawXmp.trim().length === 0) {
    return { ...NOT_PRESENT };
  }

  const normalizedRaw = collapseWhitespace(rawXmp).toLowerCase();
  const expectedHashHex = sha256Hex(expectedInstruction).toLowerCase();

  const payloadFound =
    rawXmp.includes(expectedInstruction) ||
    normalizedRaw.includes(collapseWhitespace(expectedInstruction).toLowerCase()) ||
    normalizedRaw.includes(expectedHashHex);

  return {
    xmpPresent: true,
    payloadFound,
    sha256OfPayload: sha256Hex(rawXmp),
  };
}
