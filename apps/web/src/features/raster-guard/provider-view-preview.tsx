import { getProviderProfile, type VisionProviderId } from "@pdf-injection/raster-guard";
import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { renderProviderView } from "@/features/raster-guard/simulate-provider-view";
import { loadPdf, renderPageToCanvas } from "@/lib/pdfjs";

interface PreviewImage {
  providerId: VisionProviderId;
  label: string;
  src: string;
  width: number;
  height: number;
}

/**
 * Renders the guarded first page the way each selected assistant would receive
 * it, at 1:1.
 *
 * This is the honest half of the verification story. The coverage table asserts
 * a cap height in provider pixels; this shows the actual pixels, JPEG artifacts
 * included, so a claim that the notice survives can be checked by looking
 * rather than believed.
 */
export function ProviderViewPreview({
  pdfBytes,
  providers,
  rasterScale,
}: {
  pdfBytes: Uint8Array;
  providers: VisionProviderId[];
  rasterScale: number;
}) {
  const [images, setImages] = useState<PreviewImage[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function build() {
      setError(null);
      try {
        const doc = await loadPdf(pdfBytes);
        try {
          const page = await doc.getPage(1);
          const source = await renderPageToCanvas(page, {
            scale: rasterScale,
            whiteBackground: true,
          });
          const built: PreviewImage[] = [];
          for (const providerId of providers) {
            const profile = getProviderProfile(providerId);
            // Every one of these pipelines re-encodes lossily; previewing
            // without that step would flatter a faint watermark.
            const view = await renderProviderView(source, profile, { jpegQuality: 0.8 });
            built.push({
              providerId,
              label: profile.label,
              src: view.toDataURL("image/png"),
              width: view.width,
              height: view.height,
            });
          }
          if (!cancelled) setImages(built);
        } finally {
          await doc.destroy();
        }
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error ? cause.message : "Could not build the provider preview.",
          );
        }
      }
    }

    void build();
    return () => {
      cancelled = true;
    };
  }, [pdfBytes, providers, rasterScale]);

  if (error) {
    return (
      <Alert variant="warning" data-testid="provider-preview-error">
        <AlertTitle>Preview unavailable</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="provider-view-preview">
      <p className="text-sm text-muted-foreground">
        Page 1, resampled to each assistant's documented ingestion size and re-encoded as JPEG.
        Shown at 1:1 — if you cannot read the notice here, neither can the model.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {images.map((image) => (
          <figure key={image.providerId} className="flex flex-col gap-2">
            <figcaption className="text-xs font-medium text-foreground">
              {image.label}
              <span className="ml-1 font-normal text-muted-foreground">
                {image.width} x {image.height} px
              </span>
            </figcaption>
            <div className="overflow-auto rounded-md border border-border bg-muted p-1">
              <img
                src={image.src}
                alt={`Guarded page 1 as ${image.label} receives it`}
                width={image.width}
                height={image.height}
                style={{ width: `${image.width}px`, maxWidth: "none" }}
              />
            </div>
          </figure>
        ))}
      </div>
    </div>
  );
}
