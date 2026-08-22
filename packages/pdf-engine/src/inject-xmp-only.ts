import { PDFDocument, PDFName, PDFStream } from "pdf-lib";
import { InjectionFailedError, PdfEngineError } from "./errors";
import type { InjectTextResult } from "./inject-white-text";

/** Custom XMP namespace for the pdfi:instruction / pdfi:promptSha256 properties. */
export const PDF_INJECTION_XMP_NAMESPACE = "http://pdf-injection.dev/ns/1.0/";

export interface InjectXmpOnlyInput {
  doc: PDFDocument;
  instruction: string;
  promptSha256: string;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Builds an XMP packet carrying the hidden instruction in a `dc:description`
 * (standard, provider-agnostic) and a custom `pdfi:instruction` +
 * `pdfi:promptSha256` pair (round-trip verifiable, unambiguous).
 * PRD §10.6.
 */
export function buildXmpPacket(instruction: string, promptSha256: string): string {
  const escaped = escapeXml(instruction);
  return (
    `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/">\n` +
    `  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n` +
    `    <rdf:Description rdf:about=""\n` +
    `      xmlns:dc="http://purl.org/dc/elements/1.1/"\n` +
    `      xmlns:pdfi="${PDF_INJECTION_XMP_NAMESPACE}">\n` +
    `      <dc:description>\n` +
    `        <rdf:Alt>\n` +
    `          <rdf:li xml:lang="x-default">${escaped}</rdf:li>\n` +
    `        </rdf:Alt>\n` +
    `      </dc:description>\n` +
    `      <pdfi:instruction>${escaped}</pdfi:instruction>\n` +
    `      <pdfi:promptSha256>${promptSha256}</pdfi:promptSha256>\n` +
    `    </rdf:Description>\n` +
    `  </rdf:RDF>\n` +
    `</x:xmpmeta>\n` +
    `<?xpacket end="w"?>`
  );
}

/**
 * XMP-01 (xmp_only) — research control: stores the hidden instruction ONLY
 * in an XMP `/Metadata` stream on the document catalog. No page content
 * stream is touched (geometry + visible/extracted content are byte-for-byte
 * unaffected). PRD §10.6.
 *
 * Returns boundingBox=[0,0,0,0] and fontSize=0 (no drawn text) so the shape
 * stays compatible with the other injectors' InjectTextResult for manifest
 * continuity.
 */
export async function injectXmpOnly(input: InjectXmpOnlyInput): Promise<InjectTextResult> {
  try {
    const { doc, instruction, promptSha256 } = input;
    const xmpXml = buildXmpPacket(instruction, promptSha256);
    const xmpBytes = new TextEncoder().encode(xmpXml);

    const stream = doc.context.stream(xmpBytes, {
      Type: "Metadata",
      Subtype: "XML",
    });
    const streamRef = doc.context.register(stream);
    doc.catalog.set(PDFName.of("Metadata"), streamRef);

    return { boundingBox: [0, 0, 0, 0], fontSize: 0 };
  } catch (err) {
    if (err instanceof PdfEngineError) throw err;
    throw new InjectionFailedError(`xmp_only injection failed: ${(err as Error).message}`);
  }
}

export interface XmpPayload {
  xmpPresent: boolean;
  instruction: string | null;
  promptSha256: string | null;
}

const INSTRUCTION_RE = /<pdfi:instruction>([\s\S]*?)<\/pdfi:instruction>/;
const PROMPT_SHA256_RE = /<pdfi:promptSha256>([\s\S]*?)<\/pdfi:promptSha256>/;

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Reads back the catalog `/Metadata` XMP stream (if any) of a PDF and
 * extracts the pdf-injection instruction/hash, for server-side validation
 * (ValidationReport.serverValidation.metadata) and tests. Returns
 * xmpPresent=false when there is no /Metadata stream at all or the PDF fails
 * to load.
 */
export async function readXmpPayload(bytes: Uint8Array): Promise<XmpPayload> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch {
    return { xmpPresent: false, instruction: null, promptSha256: null };
  }

  const stream = doc.catalog.lookupMaybe(PDFName.of("Metadata"), PDFStream);
  if (!stream) {
    return { xmpPresent: false, instruction: null, promptSha256: null };
  }

  const xml = new TextDecoder("utf-8").decode(stream.getContents());
  const instructionMatch = INSTRUCTION_RE.exec(xml);
  const shaMatch = PROMPT_SHA256_RE.exec(xml);

  return {
    xmpPresent: true,
    instruction: instructionMatch ? unescapeXml(instructionMatch[1] as string) : null,
    promptSha256: shaMatch ? (shaMatch[1] as string) : null,
  };
}
