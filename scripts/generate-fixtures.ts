#!/usr/bin/env bun
/**
 * Generates the fixture PDFs used by packages/pdf-engine and packages/validation
 * integration tests. Run with `bun run fixtures:generate`.
 *
 * Fixtures are committed under tests/fixtures/ so tests don't depend on
 * regenerating them; re-run this script after changing its logic.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildStandardSecurityHandlerR2,
  embedKoreanFont,
  encryptObjectBytes,
  md5,
  pdfLiteralString,
} from "@pdf-injection/pdf-engine";
import { degrees, PDFDocument, PDFName, PDFString, rgb, StandardFonts } from "pdf-lib";

const FIXTURES_DIR = path.join(import.meta.dir, "..", "tests", "fixtures");

const LOREM =
  "This assignment asks students to analyze the robustness and limitations of the proposed approach, " +
  "comparing Method A, Method B, Method C, and Method D across the provided dataset. ";

/**
 * Fixed epoch used for every fixture's /CreationDate and /ModDate. Cycle-2
 * QA (LOW) fix: pdf-lib's `PDFDocument.create()` stamps `new Date()` by
 * default, so two consecutive `bun run fixtures:generate` runs produced
 * byte-different output (timestamp only — content streams were already
 * identical). Pinning both dates makes every pdf-lib-built fixture
 * byte-reproducible.
 */
const DETERMINISTIC_DATE = new Date(0);

/**
 * `PDFDocument.create()` wrapper that pins /CreationDate, /ModDate,
 * /Producer, and /Creator so `bun run fixtures:generate` is byte-
 * reproducible across runs (verified via `sha256sum` in
 * tests/fixtures/README.md).
 */
async function createDeterministicDoc(): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  doc.setCreationDate(DETERMINISTIC_DATE);
  doc.setModificationDate(DETERMINISTIC_DATE);
  doc.setProducer("pdf-injection-fixtures");
  doc.setCreator("pdf-injection-fixtures");
  return doc;
}

async function addLoremPage(
  doc: PDFDocument,
  opts: { size?: [number, number]; extra?: string } = {},
) {
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const [width, height] = opts.size ?? [612, 792];
  const page = doc.addPage([width, height]);
  const text = (opts.extra ?? "") + LOREM;
  page.drawText(text, {
    x: 50,
    y: height - 80,
    size: 11,
    font,
    color: rgb(0, 0, 0),
    maxWidth: width - 100,
    lineHeight: 14,
  });
  return page;
}

async function buildOnePageText(): Promise<Uint8Array> {
  const doc = await createDeterministicDoc();
  await addLoremPage(doc);
  return doc.save();
}

async function buildFivePageText(): Promise<Uint8Array> {
  // The DoD fixture (PRD §29): 5-page assignment-like PDF with
  // Method A/B/C/D style assignment text on every page.
  const doc = await createDeterministicDoc();
  for (let i = 1; i <= 5; i++) {
    await addLoremPage(doc, { extra: `Section ${i}. ` });
  }
  return doc.save();
}

async function buildFiftyPageText(): Promise<Uint8Array> {
  const doc = await createDeterministicDoc();
  for (let i = 1; i <= 50; i++) {
    await addLoremPage(doc, { extra: `Page ${i} of 50. ` });
  }
  return doc.save();
}

async function buildLandscape(): Promise<Uint8Array> {
  const doc = await createDeterministicDoc();
  await addLoremPage(doc, { size: [792, 612] });
  return doc.save();
}

async function buildRotatedPage(): Promise<Uint8Array> {
  const doc = await createDeterministicDoc();
  const page = await addLoremPage(doc);
  page.setRotation(degrees(90));
  return doc.save();
}

async function buildMixedPageSize(): Promise<Uint8Array> {
  const doc = await createDeterministicDoc();
  await addLoremPage(doc, { size: [612, 792] }); // US Letter
  await addLoremPage(doc, { size: [595, 842] }); // A4
  await addLoremPage(doc, { size: [288, 432] }); // half-letter
  return doc.save();
}

async function buildNonWhiteBackground(): Promise<Uint8Array> {
  const doc = await createDeterministicDoc();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: rgb(0.85, 0.9, 0.95) });
  page.drawText(LOREM, {
    x: 50,
    y: 700,
    size: 11,
    font,
    color: rgb(0, 0, 0),
    maxWidth: 512,
    lineHeight: 14,
  });
  return doc.save();
}

async function buildAnnotations(): Promise<Uint8Array> {
  const doc = await createDeterministicDoc();
  const page = await addLoremPage(doc);

  // Low-level Link annotation (pdf-lib has no high-level annotation API).
  const linkAnnotDict = doc.context.obj({
    Type: PDFName.of("Annot"),
    Subtype: PDFName.of("Link"),
    Rect: [50, 700, 300, 720],
    Border: [0, 0, 1],
    A: {
      Type: PDFName.of("Action"),
      S: PDFName.of("URI"),
      URI: PDFString.of("https://example.org/assignment-reference"),
    },
  });
  const linkAnnotRef = doc.context.register(linkAnnotDict);
  page.node.addAnnot(linkAnnotRef);

  return doc.save();
}

async function buildForm(): Promise<Uint8Array> {
  const doc = await createDeterministicDoc();
  const page = await addLoremPage(doc);
  const form = doc.getForm();
  const field = form.createTextField("student_name");
  field.setText("");
  field.addToPage(page, { x: 50, y: 650, width: 200, height: 20 });
  return doc.save();
}

async function buildSignedLike(): Promise<Uint8Array> {
  // Not a real cryptographic signature — just an AcroForm field with
  // /FT /Sig, which is what inspectSource() scans for (PDF_SIGNED gate).
  const doc = await createDeterministicDoc();
  const page = await addLoremPage(doc);

  const sigFieldDict = doc.context.obj({
    FT: PDFName.of("Sig"),
    T: PDFString.of("Signature1"),
    Type: PDFName.of("Annot"),
    Subtype: PDFName.of("Widget"),
    Rect: [50, 50, 250, 90],
    F: 4,
  });
  const sigFieldRef = doc.context.register(sigFieldDict);
  page.node.addAnnot(sigFieldRef);

  const acroForm = doc.context.obj({
    Fields: [sigFieldRef],
    SigFlags: 3,
  });
  const acroFormRef = doc.context.register(acroForm);
  doc.catalog.set(PDFName.of("AcroForm"), acroFormRef);

  return doc.save();
}

async function buildNotAPdf(): Promise<Uint8Array> {
  return new TextEncoder().encode(
    "This file is intentionally not a PDF, for INVALID_PDF fixture tests.\n",
  );
}

async function buildKoreanText(): Promise<Uint8Array> {
  // Round 2 fixture: Korean body text using the embedded Noto Sans KR font
  // (@pdf-lib/fontkit + HarfBuzz pre-subsetting, see korean-font.ts), for
  // payloadLanguage="ko" injection tests.
  const doc = await createDeterministicDoc();
  const page = doc.addPage([612, 792]);
  const text =
    "이 과제는 학생들이 제안된 접근 방식의 견고성과 한계를 분석하도록 요구합니다. " +
    "방법론 A, 방법론 B, 방법론 C, 방법론 D를 비교하여 제공된 데이터셋에 적용하세요.";
  const font = await embedKoreanFont(doc, text);
  page.drawText(text, {
    x: 50,
    y: 700,
    size: 11,
    font,
    color: rgb(0, 0, 0),
    maxWidth: 512,
    lineHeight: 16,
  });
  return doc.save();
}

async function buildJavascriptOpenAction(): Promise<Uint8Array> {
  // Round 2 fixture: catalog /OpenAction running a /JavaScript action.
  // inspectSource() must detect + surface this without ever executing it.
  const doc = await createDeterministicDoc();
  await addLoremPage(doc);

  const jsActionDict = doc.context.obj({
    Type: PDFName.of("Action"),
    S: PDFName.of("JavaScript"),
    JS: PDFString.of("app.alert('pdf-injection risk-flag fixture — never executed');"),
  });
  const jsActionRef = doc.context.register(jsActionDict);
  doc.catalog.set(PDFName.of("OpenAction"), jsActionRef);

  return doc.save();
}

async function buildEmbeddedFile(): Promise<Uint8Array> {
  // Round 2 fixture: catalog /Names /EmbeddedFiles name tree with one entry.
  const doc = await createDeterministicDoc();
  await addLoremPage(doc);

  const attachmentBytes = new TextEncoder().encode(
    "pdf-injection embedded-file risk-flag fixture\n",
  );
  const embeddedFileStream = doc.context.stream(attachmentBytes, {
    Type: "EmbeddedFile",
    Subtype: "text/plain",
  });
  const embeddedFileStreamRef = doc.context.register(embeddedFileStream);

  const fileSpecDict = doc.context.obj({
    Type: PDFName.of("Filespec"),
    F: PDFString.of("notes.txt"),
    UF: PDFString.of("notes.txt"),
    EF: doc.context.obj({ F: embeddedFileStreamRef }),
  });
  const fileSpecRef = doc.context.register(fileSpecDict);

  const namesArray = doc.context.obj([PDFString.of("notes.txt"), fileSpecRef]);
  const embeddedFilesNameTree = doc.context.obj({ Names: namesArray });
  const embeddedFilesRef = doc.context.register(embeddedFilesNameTree);

  const namesDict = doc.context.obj({ EmbeddedFiles: embeddedFilesRef });
  const namesRef = doc.context.register(namesDict);
  doc.catalog.set(PDFName.of("Names"), namesRef);

  return doc.save();
}

async function buildExternalUri(): Promise<Uint8Array> {
  // Round 2 fixture: two /URI link annotations, for externalUriCount > 1.
  const doc = await createDeterministicDoc();
  const page = await addLoremPage(doc);

  for (const [rect, url] of [
    [[50, 700, 300, 720], "https://example.org/assignment-reference-1"],
    [[50, 670, 300, 690], "https://example.org/assignment-reference-2"],
  ] as const) {
    const linkAnnotDict = doc.context.obj({
      Type: PDFName.of("Annot"),
      Subtype: PDFName.of("Link"),
      Rect: rect,
      Border: [0, 0, 1],
      A: {
        Type: PDFName.of("Action"),
        S: PDFName.of("URI"),
        URI: PDFString.of(url),
      },
    });
    const linkAnnotRef = doc.context.register(linkAnnotDict);
    page.node.addAnnot(linkAnnotRef);
  }

  return doc.save();
}

/**
 * Hand-built (not pdf-lib) 1-page PDF, encrypted with the PDF Standard
 * Security Handler Revision 2 / V1 (40-bit RC4), empty user password.
 * Regenerates tests/fixtures/encrypted.pdf with a pure-TypeScript writer —
 * no Python or other out-of-band tooling. See
 * packages/pdf-engine/src/pdf-standard-security.ts for the crypto.
 */
function buildEncryptedFixture(): Uint8Array {
  const asciiEncoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let offset = 0;

  function pushBytes(bytes: Uint8Array): void {
    chunks.push(bytes);
    offset += bytes.length;
  }
  function pushAscii(s: string): void {
    pushBytes(asciiEncoder.encode(s));
  }

  // Deterministic 16-byte /ID (MD5 of a fixed seed) — a real generator would
  // use random bytes, but this fixture is committed to git and only needs
  // to be internally consistent (the same ID used in the trailer must be
  // the one fed into the key derivation).
  const id = md5(asciiEncoder.encode("pdf-injection-encrypted-fixture-v1"));

  const security = buildStandardSecurityHandlerR2({
    userPassword: "",
    ownerPassword: "",
    permissions: -4,
    id,
  });

  const contentPlain = asciiEncoder.encode(
    "BT\n/F1 12 Tf\n50 700 Td\n(This is an encrypted PDF fixture for PDF_ENCRYPTED tests.) Tj\nET",
  );
  const contentCipher = encryptObjectBytes(security.fileKey, 5, 0, contentPlain);

  pushAscii("%PDF-1.4\n");
  pushBytes(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // binary marker comment

  const objectOffsets: number[] = new Array(7).fill(0); // index 0 unused

  objectOffsets[1] = offset;
  pushAscii("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  objectOffsets[2] = offset;
  pushAscii("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");

  objectOffsets[3] = offset;
  pushAscii(
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
      "/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
  );

  objectOffsets[4] = offset;
  pushAscii("4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n");

  objectOffsets[5] = offset;
  pushAscii(`5 0 obj\n<< /Length ${contentCipher.length} >>\nstream\n`);
  pushBytes(contentCipher);
  pushAscii("\nendstream\nendobj\n");

  objectOffsets[6] = offset;
  pushAscii(
    `6 0 obj\n<< /Filter /Standard /V 1 /R 2 /O ${pdfLiteralString(security.O)} ` +
      `/U ${pdfLiteralString(security.U)} /P ${security.P} >>\nendobj\n`,
  );

  const xrefOffset = offset;
  pushAscii("xref\n0 7\n0000000000 65535 f \n");
  for (let i = 1; i <= 6; i++) {
    pushAscii(`${String(objectOffsets[i]).padStart(10, "0")} 00000 n \n`);
  }

  const idLiteral = pdfLiteralString(id);
  pushAscii(
    `trailer\n<< /Size 7 /Root 1 0 R /Encrypt 6 0 R /ID [${idLiteral} ${idLiteral}] >>\n` +
      `startxref\n${xrefOffset}\n%%EOF`,
  );

  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const chunk of chunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  return out;
}

const FIXTURES: Array<{ name: string; build: () => Promise<Uint8Array> }> = [
  { name: "one-page-text.pdf", build: buildOnePageText },
  { name: "five-page-text.pdf", build: buildFivePageText },
  { name: "fifty-page-text.pdf", build: buildFiftyPageText },
  { name: "landscape.pdf", build: buildLandscape },
  { name: "rotated-page.pdf", build: buildRotatedPage },
  { name: "mixed-page-size.pdf", build: buildMixedPageSize },
  { name: "non-white-background.pdf", build: buildNonWhiteBackground },
  { name: "annotations.pdf", build: buildAnnotations },
  { name: "form.pdf", build: buildForm },
  { name: "signed-like.pdf", build: buildSignedLike },
  { name: "not-a-pdf.bin", build: buildNotAPdf },
  { name: "korean-text.pdf", build: buildKoreanText },
  { name: "javascript-openaction.pdf", build: buildJavascriptOpenAction },
  { name: "embedded-file.pdf", build: buildEmbeddedFile },
  { name: "external-uri.pdf", build: buildExternalUri },
  { name: "encrypted.pdf", build: async () => buildEncryptedFixture() },
];

async function main() {
  await mkdir(FIXTURES_DIR, { recursive: true });
  for (const fixture of FIXTURES) {
    const bytes = await fixture.build();
    const outPath = path.join(FIXTURES_DIR, fixture.name);
    await writeFile(outPath, bytes);
    console.log(`wrote ${fixture.name} (${bytes.byteLength} bytes)`);
  }
}

await main();
