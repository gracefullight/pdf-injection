import pixelmatch from "pixelmatch";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PageDiffResult } from "@/features/visual-diff/diff-metrics";
import { type PDFDocumentProxy, renderPageToCanvas } from "@/lib/pdfjs";

export interface VisualDiffTabProps {
  sourceDocument: PDFDocumentProxy | null;
  outputDocument: PDFDocumentProxy | null;
  pageDiffs: PageDiffResult[];
  overallChangedPixelRatio: number | null;
  overallPassed: boolean | null;
}

export function VisualDiffTab({
  sourceDocument,
  outputDocument,
  pageDiffs,
  overallChangedPixelRatio,
  overallPassed,
}: VisualDiffTabProps) {
  const [selectedPageIndex, setSelectedPageIndex] = useState(0);
  const [overlayOpacity, setOverlayOpacity] = useState(50);
  const [zoom, setZoom] = useState(1);
  const sourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const outputCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const diffCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!sourceDocument || !outputDocument) return;
    const source = sourceDocument;
    const output = outputDocument;

    async function render() {
      const pageNumber = selectedPageIndex + 1;
      const [sourcePage, outputPage] = await Promise.all([
        source.getPage(Math.min(pageNumber, source.numPages)),
        output.getPage(pageNumber),
      ]);
      const [sourceCanvas, outputCanvas] = await Promise.all([
        renderPageToCanvas(sourcePage, { scale: 2, whiteBackground: true }),
        renderPageToCanvas(outputPage, { scale: 2, whiteBackground: true }),
      ]);
      if (cancelled) return;

      if (sourceCanvasRef.current) {
        sourceCanvasRef.current.width = sourceCanvas.width;
        sourceCanvasRef.current.height = sourceCanvas.height;
        sourceCanvasRef.current.getContext("2d")?.drawImage(sourceCanvas, 0, 0);
      }
      if (outputCanvasRef.current) {
        outputCanvasRef.current.width = outputCanvas.width;
        outputCanvasRef.current.height = outputCanvas.height;
        outputCanvasRef.current.getContext("2d")?.drawImage(outputCanvas, 0, 0);
      }
      if (diffCanvasRef.current) {
        const width = Math.min(sourceCanvas.width, outputCanvas.width);
        const height = Math.min(sourceCanvas.height, outputCanvas.height);
        diffCanvasRef.current.width = width;
        diffCanvasRef.current.height = height;
        const sourceCtx = sourceCanvas.getContext("2d");
        const outputCtx = outputCanvas.getContext("2d");
        const diffCtx = diffCanvasRef.current.getContext("2d");
        if (sourceCtx && outputCtx && diffCtx) {
          const sourceData = sourceCtx.getImageData(0, 0, width, height);
          const outputData = outputCtx.getImageData(0, 0, width, height);
          const diffData = diffCtx.createImageData(width, height);
          pixelmatch(sourceData.data, outputData.data, diffData.data, width, height, {
            threshold: 0.1,
          });
          diffCtx.putImageData(diffData, 0, 0);
        }
      }
    }

    render().catch(() => {
      // rendering failures surface via the pageDiffs table (renderErrors are tracked upstream)
    });

    return () => {
      cancelled = true;
    };
  }, [sourceDocument, outputDocument, selectedPageIndex]);

  return (
    <div className="flex flex-col gap-4" data-testid="visual-diff-tab">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted-foreground">Overall changed pixel ratio:</span>
        <span data-testid="visual-diff-overall-ratio">
          {overallChangedPixelRatio !== null
            ? `${(overallChangedPixelRatio * 100).toFixed(6)}%`
            : "not computed yet"}
        </span>
        {overallPassed !== null && (
          <Badge
            variant={overallPassed ? "success" : "destructive"}
            data-testid="visual-diff-overall-badge"
          >
            {overallPassed ? "PASS" : "FAIL"}
          </Badge>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Page</TableHead>
            <TableHead>Changed pixels</TableHead>
            <TableHead>Ratio</TableHead>
            <TableHead>Max channel delta</TableHead>
            <TableHead>Mean abs diff</TableHead>
            <TableHead>Result</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pageDiffs.map((page) => (
            <TableRow
              key={page.pageIndex}
              className={page.pageIndex === selectedPageIndex ? "bg-secondary" : undefined}
              onClick={() => setSelectedPageIndex(page.pageIndex)}
              data-testid={`visual-diff-row-${page.pageIndex}`}
            >
              <TableCell>{page.pageIndex + 1}</TableCell>
              <TableCell>{page.changedPixels}</TableCell>
              <TableCell>{(page.changedPixelRatio * 100).toFixed(6)}%</TableCell>
              <TableCell>{page.maxChannelDelta}</TableCell>
              <TableCell>{page.meanAbsoluteDifference.toFixed(3)}</TableCell>
              <TableCell>
                <Badge variant={page.passed ? "success" : "destructive"}>
                  {page.passed ? "PASS" : "FAIL"}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="visual-diff-zoom">Zoom ({Math.round(zoom * 100)}%)</Label>
          <Slider
            id="visual-diff-zoom"
            min={50}
            max={300}
            step={10}
            value={[zoom * 100]}
            onValueChange={([value]) => setZoom((value ?? 100) / 100)}
            data-testid="visual-diff-zoom-slider"
          />
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="visual-diff-overlay">
            Blend original ↔ modified ({overlayOpacity}% modified)
          </Label>
          <Slider
            id="visual-diff-overlay"
            min={0}
            max={100}
            step={1}
            value={[overlayOpacity]}
            onValueChange={([value]) => setOverlayOpacity(value ?? 50)}
            data-testid="visual-diff-overlay-slider"
          />
        </div>
      </div>

      {/*
       * Canvases are rendered at `scale: 2` (device-pixel-ratio-equivalent) for crispness, then
       * displayed at `zoom * 100%` of the *container's* width (not their own intrinsic pixel
       * size) — zoom 100% therefore means "fit the available column", matching the "Fit"
       * default a professor expects instead of a fixed 1224x1584px canvas overflowing a ~414px
       * column. `width` (a layout property) drives the zoom instead of `transform: scale()`
       * (paint-only, doesn't affect the scrollable area), so the `overflow-auto` viewport's
       * scrollbars are correct at zoom > 100% (r11 review H-04).
       */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p
            className="mb-2 text-sm font-medium text-muted-foreground"
            data-testid="visual-diff-overlay-caption"
          >
            Overlay: viewing page {selectedPageIndex + 1} (drag slider above; click a table row to
            select a different page)
          </p>
          <div className="relative overflow-auto rounded border border-border">
            <canvas
              ref={sourceCanvasRef}
              className="block h-auto"
              style={{ width: `${zoom * 100}%` }}
            />
            <canvas
              ref={outputCanvasRef}
              className="absolute left-0 top-0 block h-auto"
              style={{ width: `${zoom * 100}%`, opacity: overlayOpacity / 100 }}
            />
          </div>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium text-muted-foreground">Diff image</p>
          <div className="overflow-auto rounded border border-border">
            <canvas
              ref={diffCanvasRef}
              className="block h-auto"
              style={{ width: `${zoom * 100}%` }}
              data-testid="visual-diff-image-canvas"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
