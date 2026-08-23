import { ERROR_MESSAGES, type ExpectedSignal } from "@pdf-injection/contracts";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { InjectionSettings } from "@/features/instruction-editor/instruction-types";
import type { UploadedSource } from "@/features/upload/upload-types";
import { parseStudentIdList } from "@/features/variants/student-id-list";
import type {
  DistributionMode,
  StudentKeyedDraft,
  VariantDraft,
} from "@/features/variants/variant-types";
import { ApiRequestError, createJob } from "@/lib/api";
import { createStudentKeyedSet, createVariantSet } from "@/lib/api-variant-sets";
import { ResearchApiError } from "@/lib/research-fetch";

export interface GenerateScreenProps {
  source: UploadedSource;
  instruction: string;
  signals: ExpectedSignal[];
  settings: InjectionSettings;
  acknowledgedWarnings: string[];
  onBack: () => void;
  onGenerated: (jobId: string, accessToken: string) => void;
  /** Defaults to "single" (round-1 behavior) when the caller doesn't pass a distribution mode. */
  distributionMode?: DistributionMode;
  variantDrafts?: VariantDraft[];
  studentKeyedDraft?: StudentKeyedDraft;
  onVariantSetGenerated?: (variantSetId: string, accessToken: string) => void;
  onStudentKeyedSetGenerated?: (setId: string, accessToken: string) => void;
}

function targetPageLabel(settings: InjectionSettings, pageCount: number): string {
  if (settings.targetPage === "first") return "First page";
  if (settings.targetPage === "last") return "Last page";
  return `Page ${settings.targetPage} of ${pageCount}`;
}

// Friendly labels matching the ones shown one screen earlier, in InjectionSettingsForm — the
// summary used to show raw enum values instead (`white_text`, `bottom`), which don't match what
// the professor just picked (r11 review M-03).
const MODE_LABELS: Record<InjectionSettings["mode"], string> = {
  white_text: "White text (default)",
  render_mode_3: "Render mode 3 (non-rendering)",
  visible_positive_control: "Visible positive control",
  xmp_only: "XMP metadata only (research control)",
  unicode_tags: "Unicode tags (research)",
  image_only: "Image only (visible)",
  freetext_annot: "FreeText annotation",
  acroform_field: "AcroForm field",
  info_dict: "Info dictionary",
};
const POSITION_LABELS: Record<string, string> = {
  top: "Top margin",
  bottom: "Bottom margin (default)",
  custom: "Custom coordinates",
};

const PAYLOAD_LANGUAGE_LABELS: Record<InjectionSettings["payloadLanguage"], string> = {
  en: "English",
  ko: "Korean",
  zh: "Chinese",
};

/** Same masking rule as `private-manifest-tab.tsx`'s `maskInstruction` — kept local since this
 * screen never sees a `PrivateManifest` (the job doesn't exist yet at this point in the wizard). */
function maskInstruction(instruction: string): string {
  if (instruction.trim().length === 0) return "(empty)";
  const visibleChars = Math.min(24, Math.floor(instruction.length / 3));
  return `${instruction.slice(0, visibleChars)}${instruction.length > visibleChars ? "…[masked]" : ""}`;
}

export function GenerateScreen({
  source,
  instruction,
  signals,
  settings,
  acknowledgedWarnings,
  onBack,
  onGenerated,
  distributionMode = "single",
  variantDrafts = [],
  studentKeyedDraft,
  onVariantSetGenerated,
  onStudentKeyedSetGenerated,
}: GenerateScreenProps) {
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function describeError(error: unknown, fallback: string): string {
    if (error instanceof ApiRequestError || error instanceof ResearchApiError) {
      const known = ERROR_MESSAGES[error.code as keyof typeof ERROR_MESSAGES];
      return known ? `${known.en} (${known.ko})` : error.message;
    }
    return error instanceof Error ? error.message : fallback;
  }

  async function handleGenerateSingle() {
    const response = await createJob({
      file: source.file,
      instruction,
      expectedSignals: signals,
      injectionMode: settings.mode,
      targetPage: settings.targetPage,
      position: settings.position,
      x: settings.x,
      y: settings.y,
      fontSize: settings.fontSize,
      maxWidth: settings.maxWidth,
      payloadLanguage: settings.payloadLanguage,
      acknowledgedWarnings,
    });

    if (response.status === "failed") {
      const code = response.errorCode as keyof typeof ERROR_MESSAGES | null;
      setErrorMessage(
        code ? (ERROR_MESSAGES[code]?.en ?? "Generation failed.") : "Generation failed.",
      );
      setStatus("error");
      return;
    }

    onGenerated(response.jobId, response.accessToken);
  }

  async function handleGenerateVariants() {
    // Each variant card tracks its own lint-warning acknowledgements
    // (VariantDraft.acknowledgedWarnings), but the contract's `variant-sets`
    // request has a single set-level `acknowledgedWarnings` field — send the
    // union so the persisted audit trail (job.service's
    // report.lint.acknowledged) reflects every acknowledgement made across
    // the set, not just the (empty, in this mode) single-flow state.
    // QA result-qa-r7 MEDIUM 1.
    const unionAcknowledgedWarnings = [
      ...new Set(variantDrafts.flatMap((variant) => variant.acknowledgedWarnings)),
    ];
    const response = await createVariantSet({
      file: source.file,
      variants: variantDrafts.map((variant) => ({
        label: variant.label,
        instruction: variant.instruction,
        expectedSignals: variant.signals,
      })),
      injectionMode: settings.mode,
      targetPage: settings.targetPage,
      position: settings.position,
      x: settings.x,
      y: settings.y,
      fontSize: settings.fontSize,
      maxWidth: settings.maxWidth,
      payloadLanguage: settings.payloadLanguage,
      acknowledgedWarnings: unionAcknowledgedWarnings,
    });
    onVariantSetGenerated?.(response.variantSetId, response.accessToken);
  }

  async function handleGenerateStudentKeyed() {
    if (!studentKeyedDraft) return;
    const { ids } = parseStudentIdList(studentKeyedDraft.studentIdsRaw);
    const response = await createStudentKeyedSet({
      file: source.file,
      instructionTemplate: studentKeyedDraft.instructionTemplate,
      expectedSignals: studentKeyedDraft.expectedSignals,
      studentIds: ids,
      keyLength: studentKeyedDraft.keyLength,
      injectionMode: settings.mode,
      targetPage: settings.targetPage,
      position: settings.position,
      x: settings.x,
      y: settings.y,
      fontSize: settings.fontSize,
      maxWidth: settings.maxWidth,
      payloadLanguage: settings.payloadLanguage,
      // Same union rationale as handleGenerateVariants above — this mode has
      // exactly one template, so its own acknowledgedWarnings is the union.
      acknowledgedWarnings: studentKeyedDraft.acknowledgedWarnings,
    });
    onStudentKeyedSetGenerated?.(response.setId, response.accessToken);
  }

  async function handleGenerate() {
    setStatus("loading");
    setErrorMessage(null);
    try {
      if (distributionMode === "variants") {
        await handleGenerateVariants();
      } else if (distributionMode === "student_keyed") {
        await handleGenerateStudentKeyed();
      } else {
        await handleGenerateSingle();
      }
    } catch (error) {
      setErrorMessage(describeError(error, "Unexpected error while generating the PDF."));
      setStatus("error");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">3. Review and generate</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Confirm the settings below, then generate the injected PDF.
        </p>
      </div>

      <Card data-testid="generate-summary-card">
        <CardHeader>
          <CardTitle>Summary</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <span className="text-muted-foreground">Source file: </span>
            {source.file.name}
          </div>
          <div>
            <span className="text-muted-foreground">Target page: </span>
            {targetPageLabel(settings, source.pageCount)}
          </div>
          <div>
            <span className="text-muted-foreground">Injection mode: </span>
            {MODE_LABELS[settings.mode]}
          </div>
          <div>
            <span className="text-muted-foreground">Position: </span>
            {POSITION_LABELS[settings.position] ?? settings.position}
          </div>
          <div>
            <span className="text-muted-foreground">Payload language: </span>
            {PAYLOAD_LANGUAGE_LABELS[settings.payloadLanguage] ?? settings.payloadLanguage}
          </div>
          <div>
            <span className="text-muted-foreground">Font size: </span>
            {settings.mode === "visible_positive_control"
              ? "9pt (fixed for visible positive control)"
              : `${settings.fontSize}pt`}
          </div>
          <div>
            <span className="text-muted-foreground">Distribution mode: </span>
            {distributionMode === "single"
              ? "Single"
              : distributionMode === "variants"
                ? "Variants (A/B/C…)"
                : "Student-keyed"}
          </div>

          {distributionMode === "single" && (
            <>
              <div className="sm:col-span-2">
                <span className="text-muted-foreground">Instruction (masked): </span>
                <span className="font-mono" data-testid="generate-summary-instruction-preview">
                  {maskInstruction(instruction)}
                </span>
              </div>
              <div className="sm:col-span-2">
                <span className="text-muted-foreground">Expected signals: </span>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {signals.map((signal, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: read-only recap of the instruction-editor's signal list
                    <li key={index} className="text-xs">
                      <Badge variant="secondary" className="mr-1">
                        {signal.type}
                      </Badge>
                      {"value" in signal
                        ? signal.value
                        : "pattern" in signal
                          ? signal.pattern
                          : signal.values.join(", ")}
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}

          {distributionMode === "variants" && (
            <div className="sm:col-span-2" data-testid="generate-summary-variants">
              <span className="text-muted-foreground">Variants: </span>
              <ul className="mt-1 flex flex-col gap-0.5">
                {variantDrafts.map((variant) => (
                  <li key={variant.label} className="text-xs">
                    <Badge variant="secondary" className="mr-1">
                      {variant.label}
                    </Badge>
                    {maskInstruction(variant.instruction)} · {variant.signals.length} signal
                    {variant.signals.length === 1 ? "" : "s"}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {distributionMode === "student_keyed" && studentKeyedDraft && (
            <div className="sm:col-span-2" data-testid="generate-summary-student-keyed">
              <span className="text-muted-foreground">Students: </span>
              {parseStudentIdList(studentKeyedDraft.studentIdsRaw).ids.length} (key length{" "}
              {studentKeyedDraft.keyLength})
              <div
                className="mt-1 font-mono text-xs"
                data-testid="generate-summary-student-keyed-template"
              >
                Template: {maskInstruction(studentKeyedDraft.instructionTemplate)}
              </div>
            </div>
          )}

          {acknowledgedWarnings.length > 0 && (
            <div className="sm:col-span-2">
              <span className="text-muted-foreground">Acknowledged warnings: </span>
              {acknowledgedWarnings.join(", ")}
            </div>
          )}
        </CardContent>
      </Card>

      {errorMessage && (
        <Alert variant="destructive" data-testid="generate-error">
          <AlertTitle>Could not generate the PDF</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={onBack} disabled={status === "loading"}>
          Back
        </Button>
        <Button
          type="button"
          onClick={handleGenerate}
          disabled={status === "loading"}
          data-testid="generate-button"
        >
          {status === "loading" ? "Generating…" : "Generate"}
        </Button>
      </div>
    </div>
  );
}
