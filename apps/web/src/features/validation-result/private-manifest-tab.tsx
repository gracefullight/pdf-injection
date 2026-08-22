import type { PrivateManifest } from "@pdf-injection/contracts";
import { ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export interface PrivateManifestTabProps {
  manifest: PrivateManifest | null;
  onDownload: () => void;
  downloading: boolean;
}

function maskInstruction(instruction: string): string {
  const visibleChars = Math.min(24, Math.floor(instruction.length / 3));
  return `${instruction.slice(0, visibleChars)}${instruction.length > visibleChars ? "…[masked]" : ""}`;
}

/** Screen 4 "Private Manifest" tab — masked preview + prominent do-not-distribute warning. */
export function PrivateManifestTab({ manifest, onDownload, downloading }: PrivateManifestTabProps) {
  if (!manifest) {
    return <p className="text-sm text-muted-foreground">Manifest not available yet.</p>;
  }

  return (
    <div className="flex flex-col gap-4" data-testid="private-manifest-tab">
      <Alert variant="destructive" data-testid="private-manifest-warning">
        <ShieldAlert />
        <AlertTitle>PRIVATE: contains the hidden instruction</AlertTitle>
        <AlertDescription>
          Do not distribute this file to students. Keep it for your own records only.
        </AlertDescription>
      </Alert>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <dt className="text-muted-foreground">Masked instruction preview</dt>
        <dd className="font-mono" data-testid="private-manifest-masked-instruction">
          {maskInstruction(manifest.prompt.instruction)}
        </dd>
        <dt className="text-muted-foreground">Prompt SHA-256</dt>
        <dd className="break-all font-mono text-xs">{manifest.prompt.sha256}</dd>
        <dt className="text-muted-foreground">Injection mode</dt>
        <dd>{manifest.injection.mode}</dd>
        <dt className="text-muted-foreground">Target page</dt>
        <dd>{manifest.injection.pageIndex + 1}</dd>
      </dl>

      <div>
        <Button
          type="button"
          onClick={onDownload}
          disabled={downloading}
          data-testid="download-private-manifest-button"
        >
          {downloading ? "Downloading…" : "Download private manifest"}
        </Button>
      </div>
    </div>
  );
}
