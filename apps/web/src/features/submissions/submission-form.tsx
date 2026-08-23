import type { SubmissionAnalysis, SubmissionLabel } from "@pdf-injection/contracts";
import { type FormEvent, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createSubmission } from "@/lib/api-submissions";
import { ResearchApiError } from "@/lib/research-fetch";

export interface SubmissionFormProps {
  jobId: string;
  accessToken: string;
  /** `submittedText` is passed back for text-paste submissions only — see submissions-tab's text cache. */
  onCreated: (analysis: SubmissionAnalysis, submittedText: string | null) => void;
}

const ACCEPTED_EXTENSIONS = ".txt,.md,.pdf,.png,.jpg,.jpeg";

/**
 * Upload/paste + label + explicit acknowledgement per phase3-5 contract §3.
 * This MVP must not receive real student work — the acknowledgement gate
 * enforces that before any request leaves the browser.
 */
export function SubmissionForm({ jobId, accessToken, onCreated }: SubmissionFormProps) {
  const [inputKind, setInputKind] = useState<"text" | "file">("text");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState<SubmissionLabel>("candidate");
  const [acknowledged, setAcknowledged] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const hasContent = inputKind === "text" ? text.trim().length > 0 : file !== null;
  const canSubmit = acknowledged && hasContent && status !== "loading";

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setStatus("loading");
    setErrorMessage(null);
    try {
      const analysis = await createSubmission({
        jobId,
        accessToken,
        label,
        text: inputKind === "text" ? text : undefined,
        file: inputKind === "file" ? (file ?? undefined) : undefined,
      });
      onCreated(analysis, inputKind === "text" ? text : null);
      setText("");
      setFile(null);
      setStatus("idle");
    } catch (error) {
      setErrorMessage(
        error instanceof ResearchApiError ? error.message : "Could not analyze this submission.",
      );
      setStatus("error");
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} data-testid="submission-form">
      <Alert data-testid="submission-ack-notice">
        <AlertTitle>Research use only</AlertTitle>
        <AlertDescription>
          This MVP must not receive real student work. Paste synthetic or de-identified text, or
          upload a synthetic file, for methodology research and false-positive calibration only.
        </AlertDescription>
      </Alert>

      <div className="flex items-center gap-2">
        <Checkbox
          id="submission-ack"
          checked={acknowledged}
          onCheckedChange={(checked) => setAcknowledged(checked === true)}
          data-testid="submission-ack-checkbox"
        />
        <Label htmlFor="submission-ack" className="font-normal">
          I confirm this is not real student data (synthetic/de-identified text only).
        </Label>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="submission-label">Label</Label>
        <Select value={label} onValueChange={(value) => setLabel(value as SubmissionLabel)}>
          <SelectTrigger
            id="submission-label"
            className="w-full sm:w-72"
            data-testid="submission-label-select"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="candidate">Candidate (suspected injected)</SelectItem>
            <SelectItem value="baseline">Baseline (known-original, for calibration)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          variant={inputKind === "text" ? "default" : "outline"}
          size="sm"
          onClick={() => setInputKind("text")}
          data-testid="submission-input-kind-text"
        >
          Paste text
        </Button>
        <Button
          type="button"
          variant={inputKind === "file" ? "default" : "outline"}
          size="sm"
          onClick={() => setInputKind("file")}
          data-testid="submission-input-kind-file"
        >
          Upload file
        </Button>
      </div>

      {inputKind === "text" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="submission-text" required>
            Submission text
          </Label>
          <Textarea
            id="submission-text"
            rows={8}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Paste synthetic/de-identified submission text…"
            data-testid="submission-text-input"
            aria-required="true"
          />
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="submission-file" required>
            File (.txt, .md, .pdf, .png, .jpg)
          </Label>
          <input
            id="submission-file"
            type="file"
            accept={ACCEPTED_EXTENSIONS}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="text-sm"
            data-testid="submission-file-input"
            required
          />
          {file && <p className="text-xs text-muted-foreground">{file.name}</p>}
        </div>
      )}

      {errorMessage && (
        <Alert variant="destructive" data-testid="submission-form-error">
          <AlertTitle>Could not analyze this submission</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      <div>
        <Button type="submit" disabled={!canSubmit} data-testid="submission-submit-button">
          {status === "loading" ? "Analyzing…" : "Analyze submission"}
        </Button>
      </div>
    </form>
  );
}
