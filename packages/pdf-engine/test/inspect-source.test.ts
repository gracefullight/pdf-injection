import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { degrees, PDFDocument, PDFName, PDFString } from "pdf-lib";
import { InvalidPdfError, PdfSignedError, TooManyPagesError } from "../src/errors";
import { detectRiskFlags, inspectSource } from "../src/inspect-source";

const FIXTURES_DIR = path.join(import.meta.dir, "..", "..", "..", "tests", "fixtures");

async function loadFixture(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path.join(FIXTURES_DIR, name)));
}

async function buildPlainPdf(
  pageCount = 1,
  size: [number, number] = [612, 792],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    doc.addPage(size);
  }
  return doc.save();
}

async function buildRotatedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.setRotation(degrees(90));
  return doc.save();
}

async function buildSignedLikePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const sigFieldDict = doc.context.obj({
    FT: PDFName.of("Sig"),
    T: PDFString.of("Signature1"),
    Type: PDFName.of("Annot"),
    Subtype: PDFName.of("Widget"),
    Rect: [0, 0, 0, 0],
  });
  const sigFieldRef = doc.context.register(sigFieldDict);
  const acroForm = doc.context.obj({
    Fields: [sigFieldRef],
    SigFlags: 3,
  });
  const acroFormRef = doc.context.register(acroForm);
  doc.catalog.set(PDFName.of("AcroForm"), acroFormRef);
  return doc.save();
}

async function buildPdfWithUnrelatedPerms(): Promise<Uint8Array> {
  // /Perms present but with NEITHER /DocMDP NOR /UR3 — must NOT be treated as signed.
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const permsDict = doc.context.obj({ SomeUnrelatedEntry: PDFString.of("not a signature") });
  const permsRef = doc.context.register(permsDict);
  doc.catalog.set(PDFName.of("Perms"), permsRef);
  return doc.save();
}

async function buildPdfWithDocMdpPerms(): Promise<Uint8Array> {
  // /Perms containing /DocMDP — a certifying signature — must be treated as signed.
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const permsDict = doc.context.obj({ DocMDP: doc.context.obj({}) });
  const permsRef = doc.context.register(permsDict);
  doc.catalog.set(PDFName.of("Perms"), permsRef);
  return doc.save();
}

describe("inspectSource", () => {
  test("rejects bytes without the %PDF- magic header", async () => {
    const bytes = new TextEncoder().encode("this is not a pdf file at all");
    await expect(inspectSource({ bytes, filename: "not-a-pdf.bin" })).rejects.toThrow(
      InvalidPdfError,
    );
  });

  test("parses a valid one-page PDF and returns geometry", async () => {
    const bytes = await buildPlainPdf(1);
    const result = await inspectSource({ bytes, filename: "one-page.pdf" });
    expect(result.pageCount).toBe(1);
    expect(result.encrypted).toBe(false);
    expect(result.signed).toBe(false);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]?.width).toBe(612);
    expect(result.pages[0]?.height).toBe(792);
    expect(result.pages[0]?.rotation).toBe(0);
    expect(result.sha256).toHaveLength(64);
    expect(result.sizeBytes).toBe(bytes.byteLength);
  });

  test("parses a multi-page PDF and returns geometry for every page", async () => {
    const bytes = await buildPlainPdf(5);
    const result = await inspectSource({ bytes, filename: "five-page.pdf" });
    expect(result.pageCount).toBe(5);
    expect(result.pages).toHaveLength(5);
    expect(result.pages.map((p) => p.pageIndex)).toEqual([0, 1, 2, 3, 4]);
  });

  test("records page rotation", async () => {
    const bytes = await buildRotatedPdf();
    const result = await inspectSource({ bytes, filename: "rotated.pdf" });
    expect(result.pages[0]?.rotation).toBe(90);
  });

  test("rejects a document exceeding maxPages", async () => {
    const bytes = await buildPlainPdf(3);
    await expect(inspectSource({ bytes, filename: "three-page.pdf", maxPages: 2 })).rejects.toThrow(
      TooManyPagesError,
    );
  });

  test("detects a signed-like PDF via AcroForm /FT /Sig field", async () => {
    const bytes = await buildSignedLikePdf();
    await expect(inspectSource({ bytes, filename: "signed-like.pdf" })).rejects.toThrow(
      PdfSignedError,
    );
  });

  test("does NOT flag a PDF with an unrelated /Perms dict as signed", async () => {
    const bytes = await buildPdfWithUnrelatedPerms();
    const result = await inspectSource({ bytes, filename: "unrelated-perms.pdf" });
    expect(result.signed).toBe(false);
  });

  test("detects a signed PDF via /Perms /DocMDP", async () => {
    const bytes = await buildPdfWithDocMdpPerms();
    await expect(inspectSource({ bytes, filename: "docmdp.pdf" })).rejects.toThrow(PdfSignedError);
  });

  test("rejects abnormal page dimensions beyond maxPageDimensionPt", async () => {
    const bytes = await buildPlainPdf(1, [20000, 20000]);
    await expect(
      inspectSource({ bytes, filename: "huge.pdf", maxPageDimensionPt: 14400 }),
    ).rejects.toThrow(InvalidPdfError);
  });

  test("plain PDFs have all riskFlags false/zero", async () => {
    const bytes = await buildPlainPdf(1);
    const result = await inspectSource({ bytes, filename: "plain.pdf" });
    expect(result.riskFlags).toEqual({
      javascript: false,
      embeddedFiles: false,
      externalUriCount: 0,
      openAction: false,
    });
  });
});

describe("inspectSource riskFlags (round 2 fixtures)", () => {
  test("javascript-openaction.pdf: javascript=true and openAction=true, never executed", async () => {
    const bytes = await loadFixture("javascript-openaction.pdf");
    const result = await inspectSource({ bytes, filename: "javascript-openaction.pdf" });
    expect(result.riskFlags.javascript).toBe(true);
    expect(result.riskFlags.openAction).toBe(true);
    expect(result.riskFlags.embeddedFiles).toBe(false);
    expect(result.riskFlags.externalUriCount).toBe(0);
  });

  test("embedded-file.pdf: embeddedFiles=true", async () => {
    const bytes = await loadFixture("embedded-file.pdf");
    const result = await inspectSource({ bytes, filename: "embedded-file.pdf" });
    expect(result.riskFlags.embeddedFiles).toBe(true);
    expect(result.riskFlags.javascript).toBe(false);
  });

  test("external-uri.pdf: externalUriCount=2 (two Link annotations)", async () => {
    const bytes = await loadFixture("external-uri.pdf");
    const result = await inspectSource({ bytes, filename: "external-uri.pdf" });
    expect(result.riskFlags.externalUriCount).toBe(2);
    expect(result.riskFlags.javascript).toBe(false);
    expect(result.riskFlags.embeddedFiles).toBe(false);
  });

  test("annotations.pdf (round-1 fixture with a single URI link) is detected as externalUriCount=1", async () => {
    const bytes = await loadFixture("annotations.pdf");
    const result = await inspectSource({ bytes, filename: "annotations.pdf" });
    expect(result.riskFlags.externalUriCount).toBe(1);
  });
});

describe("detectRiskFlags", () => {
  test("detects a JavaScript action nested inline inside another dict (not just top-level indirect objects)", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    // Inline (non-indirect) Link annotation /A action — regression guard for
    // the walker that must recurse into inline sub-dicts (e.g. an
    // annotation's /A dict embedded directly, not as its own indirect
    // object), not just enumerate top-level indirect objects.
    const page = doc.getPage(0);
    const annotDict = doc.context.obj({
      Type: PDFName.of("Annot"),
      Subtype: PDFName.of("Link"),
      Rect: [0, 0, 10, 10],
      A: { S: PDFName.of("JavaScript"), JS: PDFString.of("app.alert(1)") },
    });
    page.node.addAnnot(doc.context.register(annotDict));

    const flags = detectRiskFlags(doc);
    expect(flags.javascript).toBe(true);
  });
});
