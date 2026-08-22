import { PDFArray, type PDFDocument, PDFStream } from "pdf-lib";

/**
 * Returns the raw (possibly still-encoded) bytes of a page's /Contents
 * stream(s), concatenated. Used to assert byte-for-byte equality of a page's
 * content stream across an operation (e.g. xmp_only injection) that must
 * never touch page content.
 */
export function getPageContentBytes(doc: PDFDocument, pageIndex: number): Uint8Array {
  const page = doc.getPage(pageIndex);
  const contents = page.node.Contents();
  if (!contents) return new Uint8Array(0);

  const streams =
    contents instanceof PDFArray
      ? Array.from({ length: contents.size() }, (_, i) => contents.lookup(i, PDFStream))
      : [contents];

  const parts = streams.map((s) => s.getContents());
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// Test-only helper: content streams in pdf-lib output are FlateDecode-compressed
// by default, so raw regex assertions on saved bytes need to inflate every
// `stream ... endstream` block first. This concatenates every decoded (or raw,
// for unfiltered) stream body as latin1 text for operator-pattern assertions.
// biome-ignore lint/correctness/noEmptyCharacterClassInRegex: `[^]` is the intentional idiom for "any character including newline" (a dotAll-equivalent without the /s flag) — needed here to match raw PDF stream bytes that legitimately contain newlines.
const STREAM_RE = /(<<[^]*?>>)\s*stream\r?\n([^]*?)\r?\nendstream/g;

export function decodeAllStreamsAsText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString("latin1");
  let out = "";
  STREAM_RE.lastIndex = 0;
  let match = STREAM_RE.exec(raw);
  while (match !== null) {
    const dictText = match[1] as string;
    const bodyText = match[2] as string;
    const bodyBytes = Buffer.from(bodyText, "latin1");
    if (dictText.includes("/FlateDecode")) {
      try {
        // PDF's /FlateDecode is zlib-wrapped (RFC1950: 2-byte header + trailing
        // 4-byte Adler-32), but Bun.inflateSync expects raw DEFLATE (RFC1951)
        // like Node's zlib.inflateRawSync — strip the wrapper before inflating.
        const rawDeflate = bodyBytes.subarray(2, bodyBytes.length - 4);
        out += Buffer.from(Bun.inflateSync(rawDeflate)).toString("latin1");
      } catch {
        // Not actually flate-compressed (e.g. malformed/binary fixture) — skip.
      }
    } else {
      out += bodyText;
    }
    out += "\n";
    match = STREAM_RE.exec(raw);
  }
  return out;
}
