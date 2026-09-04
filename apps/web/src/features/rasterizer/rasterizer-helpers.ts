export interface ResolutionOption {
  scale: number;
  dpi: number;
  label: string;
  description: string;
}

export const RESOLUTION_OPTIONS: ResolutionOption[] = [
  {
    scale: 1.5,
    dpi: 108,
    label: "1.5x (108 DPI)",
    description: "Compact file size, suitable for quick reviews or previews",
  },
  {
    scale: 2.0,
    dpi: 144,
    label: "2.0x (144 DPI) · Recommended",
    description: "Standard clarity, optimal balance between legibility and file size",
  },
  {
    scale: 3.0,
    dpi: 216,
    label: "3.0x (216 DPI)",
    description: "High quality, crisp rendering suitable for printing or detailed inspection",
  },
];

export interface FormatOption {
  format: "image/png" | "image/jpeg";
  label: string;
  description: string;
}

export const FORMAT_OPTIONS: FormatOption[] = [
  {
    format: "image/png",
    label: "PNG (Lossless)",
    description: "Best text sharpness without compression artifacts; larger file size",
  },
  {
    format: "image/jpeg",
    label: "JPEG (85% Quality)",
    description: "Significantly smaller file size; ideal for documents with many pages",
  },
];

/** Formats byte counts into human-readable B, KB, or MB strings. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Calculates the percentage difference between original and new size. */
export function calculateSizeDelta(
  originalBytes: number,
  newBytes: number,
): { percent: number; isIncrease: boolean; label: string } {
  if (originalBytes <= 0) return { percent: 0, isIncrease: false, label: "0%" };
  const diff = newBytes - originalBytes;
  const percent = Math.round(Math.abs(diff / originalBytes) * 100);
  const isIncrease = diff > 0;
  return {
    percent,
    isIncrease,
    label: `${isIncrease ? "+" : "-"}${percent}%`,
  };
}
