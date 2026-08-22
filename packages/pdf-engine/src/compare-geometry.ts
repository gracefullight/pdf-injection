import type { PageGeometry } from "@pdf-injection/contracts";

export interface GeometryMismatch {
  pageIndex: number;
  field: string;
  before: unknown;
  after: unknown;
}

export interface CompareGeometryResult {
  passed: boolean;
  mismatches: GeometryMismatch[];
}

const BOX_EPSILON = 0.001; // pt — tolerate float round-trip noise, not real changes

function boxesEqual(
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean {
  return a.every((v, i) => Math.abs(v - (b[i] as number)) <= BOX_EPSILON);
}

/**
 * Compares page geometry before/after injection. PRD §10.8: page count,
 * MediaBox, CropBox, rotation, width, height must be preserved exactly
 * (within floating point noise). Used to gate GEOMETRY_CHANGED.
 */
export function compareGeometry(
  before: PageGeometry[],
  after: PageGeometry[],
): CompareGeometryResult {
  const mismatches: GeometryMismatch[] = [];

  if (before.length !== after.length) {
    mismatches.push({
      pageIndex: -1,
      field: "pageCount",
      before: before.length,
      after: after.length,
    });
    return { passed: false, mismatches };
  }

  for (let i = 0; i < before.length; i++) {
    const b = before[i] as PageGeometry;
    const a = after[i] as PageGeometry;

    if (!boxesEqual(b.mediaBox, a.mediaBox)) {
      mismatches.push({ pageIndex: i, field: "mediaBox", before: b.mediaBox, after: a.mediaBox });
    }
    if (!boxesEqual(b.cropBox, a.cropBox)) {
      mismatches.push({ pageIndex: i, field: "cropBox", before: b.cropBox, after: a.cropBox });
    }
    if (b.rotation !== a.rotation) {
      mismatches.push({ pageIndex: i, field: "rotation", before: b.rotation, after: a.rotation });
    }
    if (Math.abs(b.width - a.width) > BOX_EPSILON) {
      mismatches.push({ pageIndex: i, field: "width", before: b.width, after: a.width });
    }
    if (Math.abs(b.height - a.height) > BOX_EPSILON) {
      mismatches.push({ pageIndex: i, field: "height", before: b.height, after: a.height });
    }
  }

  return { passed: mismatches.length === 0, mismatches };
}
