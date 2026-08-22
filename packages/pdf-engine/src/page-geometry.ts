import type { PageGeometry } from "@pdf-injection/contracts";
import type { PDFDocument } from "pdf-lib";

/**
 * Snapshots MediaBox/CropBox/rotation/width/height for every page of a
 * loaded pdf-lib document. Shared by inspect-source.ts (source validation)
 * and inject.ts (before/after geometry comparison).
 */
export function snapshotPageGeometry(doc: PDFDocument): PageGeometry[] {
  return doc.getPages().map((page, pageIndex) => {
    const mediaRect = page.getMediaBox();
    const cropRect = page.getCropBox();
    const mediaBox: [number, number, number, number] = [
      mediaRect.x,
      mediaRect.y,
      mediaRect.x + mediaRect.width,
      mediaRect.y + mediaRect.height,
    ];
    const cropBox: [number, number, number, number] = [
      cropRect.x,
      cropRect.y,
      cropRect.x + cropRect.width,
      cropRect.y + cropRect.height,
    ];
    return {
      pageIndex,
      mediaBox,
      cropBox,
      rotation: page.getRotation().angle,
      width: page.getWidth(),
      height: page.getHeight(),
    };
  });
}
