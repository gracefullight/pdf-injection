// OCR regeneration (Phase 5 robustness) via tesseract.js. Confirmed working
// under Bun 1.3.14 (macOS arm64) via a spike: `createWorker("eng")` +
// `worker.recognize(png)` on a page rendered by render-pages.ts recovered
// the source text at 95% confidence in ~400ms once the "eng" trained-data
// language file was cached.

import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createWorker, type Page as TesseractPage, type Worker } from "tesseract.js";
import { buildOcrTextLayerPdf, type OcrWordBox } from "./ocr-text-layer";
import { renderPagesToPng } from "./render-pages";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
// packages/robustness/src -> packages/robustness -> packages -> <repo root>
const REPO_ROOT = resolve(SRC_DIR, "..", "..", "..");

/** Persistent cache dir for tesseract.js trained-data language files, so the
 * (network-dependent) download only has to happen once per machine. */
export const DEFAULT_TESSDATA_CACHE_PATH = join(REPO_ROOT, ".pdf-injection-data", "tessdata");

export interface OcrPageResult {
  pageIndex: number;
  text: string;
  confidence: number;
}

export interface OcrRegenerateResult {
  available: boolean;
  reason?: string;
  pages: OcrPageResult[];
  fullText: string;
  /**
   * The "OCR-regenerated" PDF (Cycle 2): one page per source page, each the
   * rendered page image (see print-to-pdf.ts) plus an invisible
   * (render-mode-3) text layer with every OCR'd word placed at its
   * tesseract bounding box, mapped from rasterized-pixel space to PDF point
   * space (see ocr-text-layer.ts::mapWordBoxToPdfSpace) with font size ≈
   * bbox height. Always populated when `available: true` (never
   * `undefined` in that case); `undefined` when `available: false`.
   */
  bytes?: Uint8Array;
}

export interface OcrImageResult {
  available: boolean;
  reason?: string;
  text: string;
  confidence: number;
}

type WorkerHandle = { worker: Worker | null; reason: string | null };

const workerCache = new Map<string, Promise<WorkerHandle>>();

async function initWorker(lang: string): Promise<WorkerHandle> {
  try {
    await mkdir(DEFAULT_TESSDATA_CACHE_PATH, { recursive: true });
    const worker = await createWorker(lang, 1, { cachePath: DEFAULT_TESSDATA_CACHE_PATH });
    return { worker, reason: null };
  } catch (err) {
    return {
      worker: null,
      reason: `tesseract.js worker init failed for lang="${lang}": ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Lazily creates (and caches, per language) a single tesseract.js worker. Never throws. */
export function getOcrWorker(lang = "eng"): Promise<WorkerHandle> {
  let pending = workerCache.get(lang);
  if (!pending) {
    pending = initWorker(lang);
    workerCache.set(lang, pending);
  }
  return pending;
}

/** Terminates every cached worker and clears the cache. Call in test teardown / process shutdown. */
export async function dispose(): Promise<void> {
  const pending = [...workerCache.values()];
  workerCache.clear();
  await Promise.all(
    pending.map(async (p) => {
      const { worker } = await p;
      if (worker) await worker.terminate();
    }),
  );
}

/** Test-only: drops the worker cache without terminating (use `dispose()` in normal code). */
export function __resetOcrCacheForTests(): void {
  workerCache.clear();
}

/**
 * Renders every page of `bytes` and runs OCR over each rendered page.
 * `available: false` when either the canvas renderer or the OCR worker
 * cannot be initialized (reason explains which).
 */
export async function ocrRegenerate(
  bytes: Uint8Array,
  opts: { scale?: number; lang?: string; maxRenderPixels?: number } = {},
): Promise<OcrRegenerateResult> {
  const scale = opts.scale ?? 2;
  const lang = opts.lang ?? "eng";

  const rendered = await renderPagesToPng(bytes, { scale, maxRenderPixels: opts.maxRenderPixels });
  if (!rendered.available) {
    return {
      available: false,
      reason: rendered.reason ?? "canvas unavailable for OCR rendering",
      pages: [],
      fullText: "",
    };
  }

  const { worker, reason } = await getOcrWorker(lang);
  if (!worker) {
    return {
      available: false,
      reason: reason ?? "OCR worker unavailable",
      pages: [],
      fullText: "",
    };
  }

  const pages: OcrPageResult[] = [];
  const layerPages: Array<{ rendered: (typeof rendered.pages)[number]; words: OcrWordBox[] }> = [];
  for (const page of rendered.pages) {
    // `{ blocks: true }` output option is required to get word-level bbox
    // data back (tesseract.js's `data.blocks` is otherwise `null`); text and
    // confidence are populated on `data` either way.
    const { data } = await worker.recognize(page.png, {}, { blocks: true });
    pages.push({ pageIndex: page.pageIndex, text: data.text, confidence: data.confidence });
    layerPages.push({ rendered: page, words: extractWords(data) });
  }
  const fullText = pages.map((p) => p.text).join("\n\n");
  const layerBytes = await buildOcrTextLayerPdf(layerPages);

  return { available: true, pages, fullText, bytes: layerBytes };
}

/** Flattens tesseract's blocks -> paragraphs -> lines -> words tree into a flat word list with pixel-space bboxes. */
function extractWords(data: TesseractPage): OcrWordBox[] {
  const words: OcrWordBox[] = [];
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        for (const word of line.words ?? []) {
          if (word.text.trim().length === 0) continue;
          words.push({ text: word.text, bbox: word.bbox });
        }
      }
    }
  }
  return words;
}

/** OCRs a single already-rasterized image (screenshot upload path). */
export async function ocrImage(
  imageBytes: Uint8Array,
  opts: { lang?: string } = {},
): Promise<OcrImageResult> {
  const lang = opts.lang ?? "eng";
  const { worker, reason } = await getOcrWorker(lang);
  if (!worker) {
    return {
      available: false,
      reason: reason ?? "OCR worker unavailable",
      text: "",
      confidence: 0,
    };
  }
  const { data } = await worker.recognize(Buffer.from(imageBytes));
  return { available: true, text: data.text, confidence: data.confidence };
}
