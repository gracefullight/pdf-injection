import { LIMITS } from "@pdf-injection/contracts";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EXAMPLE_INSTRUCTION } from "@/features/instruction-editor/instruction-types";
import { normalizedPromptHash } from "@/lib/prompt-normalize";

export interface RawEditorProps {
  instruction: string;
  onChange: (instruction: string) => void;
}

export function RawEditor({ instruction, onChange }: RawEditorProps) {
  const [showPreview, setShowPreview] = useState(false);
  const [hash, setHash] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");

  useEffect(() => {
    let cancelled = false;
    if (instruction.trim().length === 0) {
      setHash(null);
      return;
    }
    normalizedPromptHash(instruction).then((digest) => {
      if (!cancelled) setHash(digest);
    });
    return () => {
      cancelled = true;
    };
  }, [instruction]);

  async function handleCopy() {
    await navigator.clipboard.writeText(instruction);
    setCopyState("copied");
    setTimeout(() => setCopyState("idle"), 1500);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Label htmlFor="raw-instruction" required>
          Hidden instruction
        </Label>
        <span
          className={
            instruction.length > LIMITS.maxInstructionChars
              ? "text-xs text-destructive"
              : "text-xs text-muted-foreground"
          }
          data-testid="instruction-char-count"
        >
          {instruction.length}/{LIMITS.maxInstructionChars}
        </span>
      </div>
      <Textarea
        id="raw-instruction"
        data-testid="instruction-textarea"
        rows={8}
        value={instruction}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Write the hidden instruction the model should follow…"
        aria-required="true"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange(EXAMPLE_INSTRUCTION)}
          data-testid="instruction-example-button"
        >
          Insert example
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange("")}
          data-testid="instruction-reset-button"
        >
          Reset
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleCopy}
          data-testid="instruction-copy-button"
        >
          {copyState === "copied" ? "Copied" : "Copy"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setShowPreview((v) => !v)}
          data-testid="instruction-preview-toggle"
        >
          {showPreview ? "Hide preview" : "Show preview"}
        </Button>
      </div>

      {showPreview && (
        <div
          className="rounded-md border border-border bg-secondary p-3 text-sm whitespace-pre-wrap"
          data-testid="instruction-preview"
        >
          {instruction || <span className="text-muted-foreground">Nothing to preview yet.</span>}
        </div>
      )}

      <p className="text-xs text-muted-foreground" data-testid="instruction-hash-preview">
        Normalized prompt SHA-256: <code className="break-all">{hash ?? "—"}</code>
      </p>
    </div>
  );
}
