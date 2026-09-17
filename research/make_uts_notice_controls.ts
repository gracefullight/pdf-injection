/** Build exact-notice controls for the GPT-5.6 Luna document-ingestion study. */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { injectPdf } from "@pdf-injection/pdf-engine";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function wrap(text: string, font: Awaited<ReturnType<PDFDocument["embedFont"]>>, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph.trim()) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of paragraph.trim().split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (!current || font.widthOfTextAtSize(candidate, size) <= width) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    lines.push(current);
  }
  return lines;
}

async function makeVisibleCover(source: Uint8Array, notice: string): Promise<Uint8Array> {
  const sourceDoc = await PDFDocument.load(source);
  const output = await PDFDocument.create();
  const [firstPage] = sourceDoc.getPages();
  const width = firstPage?.getWidth() ?? 595.28;
  const height = firstPage?.getHeight() ?? 841.89;
  const cover = output.addPage([width, height]);
  const regular = await output.embedFont(StandardFonts.Helvetica);
  const bold = await output.embedFont(StandardFonts.HelveticaBold);
  const margin = 54;

  cover.drawText("UTS ASSESSMENT INTEGRITY NOTICE", {
    x: margin,
    y: height - 72,
    size: 17,
    font: bold,
    color: rgb(0, 0, 0),
  });

  const body = notice.replace(/^UTS ASSESSMENT INTEGRITY NOTICE\s*/i, "").trim();
  const size = 11;
  const lineHeight = 16;
  const lines = wrap(body, regular, size, width - 2 * margin);
  let y = height - 112;
  for (const line of lines) {
    if (line) {
      cover.drawText(line, { x: margin, y, size, font: regular, color: rgb(0, 0, 0) });
    }
    y -= lineHeight;
  }

  cover.drawLine({
    start: { x: margin, y: y - 8 },
    end: { x: width - margin, y: y - 8 },
    thickness: 0.8,
    color: rgb(0.35, 0.35, 0.35),
  });
  cover.drawText("The assessment specification follows on the next pages.", {
    x: margin,
    y: y - 34,
    size: 10,
    font: regular,
    color: rgb(0.25, 0.25, 0.25),
  });

  const copiedPages = await output.copyPages(sourceDoc, sourceDoc.getPageIndices());
  for (const page of copiedPages) output.addPage(page);
  return output.save();
}

async function main(): Promise<void> {
  const [sourceArg, noticeArg, outputArg] = process.argv.slice(2);
  if (!sourceArg || !noticeArg || !outputArg) {
    throw new Error(
      "usage: bun research/make_uts_notice_controls.ts SOURCE.pdf NOTICE.txt OUTPUT_DIR",
    );
  }

  const sourcePath = resolve(sourceArg);
  const noticePath = resolve(noticeArg);
  const outputDir = resolve(outputArg);
  const source = new Uint8Array(await readFile(sourcePath));
  const notice = (await readFile(noticePath, "utf8")).trim();
  await mkdir(outputDir, { recursive: true });

  const renderMode3 = await injectPdf({
    source,
    instruction: notice,
    mode: "render_mode_3",
    targetPage: "last",
    position: "bottom",
    fontSize: 1,
  });
  const acroform = await injectPdf({
    source,
    instruction: notice,
    mode: "acroform_field",
    targetPage: "last",
    position: "bottom",
    fontSize: 1,
  });
  const visibleCover = await makeVisibleCover(source, notice);

  const artifacts = {
    render_mode_3: {
      filename: "uts-notice-render-mode-3.pdf",
      bytes: renderMode3.bytes,
      page_indexes: renderMode3.pageIndexes,
      sha256: renderMode3.outputSha256,
    },
    acroform_field: {
      filename: "uts-notice-acroform-field.pdf",
      bytes: acroform.bytes,
      page_indexes: acroform.pageIndexes,
      sha256: acroform.outputSha256,
    },
    visible_cover_native: {
      filename: "uts-notice-visible-cover-native.pdf",
      bytes: visibleCover,
      page_indexes: [0],
      sha256: sha256(visibleCover),
    },
  };

  for (const artifact of Object.values(artifacts)) {
    await writeFile(resolve(outputDir, artifact.filename), artifact.bytes);
  }
  await writeFile(
    resolve(outputDir, "manifest.json"),
    `${JSON.stringify(
      {
        source: sourcePath,
        source_sha256: sha256(source),
        notice: noticePath,
        notice_sha256: sha256(new TextEncoder().encode(notice)),
        artifacts: Object.fromEntries(
          Object.entries(artifacts).map(([key, value]) => [
            key,
            {
              filename: value.filename,
              page_indexes: value.page_indexes,
              sha256: value.sha256,
            },
          ]),
        ),
      },
      null,
      2,
    )}\n`,
  );
}

await main();
