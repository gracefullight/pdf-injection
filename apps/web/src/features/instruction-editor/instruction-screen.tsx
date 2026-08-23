import type { ExpectedSignal } from "@pdf-injection/contracts";
import { lintPrompt } from "@pdf-injection/prompt-lint";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { RequiredMark } from "@/components/ui/required-mark";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GuidedEditor } from "@/features/instruction-editor/guided-editor";
import { InjectionSettingsForm } from "@/features/instruction-editor/injection-settings-form";
import type { InjectionSettings } from "@/features/instruction-editor/instruction-types";
import { LintPanel } from "@/features/instruction-editor/lint-panel";
import { RawEditor } from "@/features/instruction-editor/raw-editor";
import { SignalBuilder } from "@/features/instruction-editor/signal-builder";
import { DistributionModeSelector } from "@/features/variants/distribution-mode-selector";
import { StudentKeyedEditor } from "@/features/variants/student-keyed-editor";
import { isStudentKeyedDraftValid } from "@/features/variants/student-keyed-validation";
import { VariantEditor } from "@/features/variants/variant-editor";
import type {
  DistributionMode,
  StudentKeyedDraft,
  VariantDraft,
} from "@/features/variants/variant-types";
import { isVariantSetValid } from "@/features/variants/variant-validation";
import { useFeatures } from "@/lib/features";

export interface InstructionScreenProps {
  instruction: string;
  onInstructionChange: (instruction: string) => void;
  signals: ExpectedSignal[];
  onSignalsChange: (signals: ExpectedSignal[]) => void;
  settings: InjectionSettings;
  onSettingsChange: (settings: InjectionSettings) => void;
  acknowledgedWarnings: string[];
  onAcknowledgedWarningsChange: (ids: string[]) => void;
  pageCount: number | null;
  onBack: () => void;
  onContinue: () => void;
  distributionMode: DistributionMode;
  onDistributionModeChange: (mode: DistributionMode) => void;
  variantDrafts: VariantDraft[];
  onVariantDraftsChange: (variants: VariantDraft[]) => void;
  studentKeyedDraft: StudentKeyedDraft;
  onStudentKeyedDraftChange: (draft: StudentKeyedDraft) => void;
}

export function InstructionScreen({
  instruction,
  onInstructionChange,
  signals,
  onSignalsChange,
  settings,
  onSettingsChange,
  acknowledgedWarnings,
  onAcknowledgedWarningsChange,
  pageCount,
  onBack,
  onContinue,
  distributionMode,
  onDistributionModeChange,
  variantDrafts,
  onVariantDraftsChange,
  studentKeyedDraft,
  onStudentKeyedDraftChange,
}: InstructionScreenProps) {
  // Bug fix (r9): must pass `payloadLanguage` through — otherwise `lintPrompt`'s
  // non-printable-ASCII check always runs in "en" mode (opts.payloadLanguage undefined
  // !== "ko"), so any non-ASCII instruction is always flagged `encoding_unsupported` as a
  // lint ERROR even after the user selects payload language "ko" in InjectionSettingsForm
  // below, permanently blocking "Continue to generate" for the entire ko-payload feature.
  // Regression-covered by tests/e2e/tests/korean-payload.spec.ts (this component has no
  // dedicated render-level unit tests in this codebase — see api.test.ts-style pure-helper
  // convention; the E2E flow is the regression test for this UI-wiring bug).
  const lint = useMemo(
    () => lintPrompt(instruction, signals, { payloadLanguage: settings.payloadLanguage }),
    [instruction, signals, settings.payloadLanguage],
  );
  const { features } = useFeatures();

  // "single" mode reuses the existing raw/guided instruction + signals above;
  // "variants"/"student_keyed" (Phase 5, contract §1/§5) instead validate
  // their own dedicated editor's state below and don't require the shared
  // instruction/signals fields to be filled in.
  const unacknowledgedWarnings = lint.warnings.filter(
    (warning) => !acknowledgedWarnings.includes(warning.id),
  );
  const canContinue =
    distributionMode === "single"
      ? lint.errors.length === 0 && unacknowledgedWarnings.length === 0
      : distributionMode === "variants"
        ? isVariantSetValid(variantDrafts, settings.payloadLanguage)
        : isStudentKeyedDraftValid(studentKeyedDraft, settings.payloadLanguage);

  // Neutral disabled-state explanation for the "unmet requirement" lint id that `LintPanel`
  // deliberately never renders as a red alert before the user has typed anything (r11 review
  // H-09) — the reason still needs to be discoverable somewhere. (Expected signals used to be a
  // second hard requirement; they are now optional at generation and surface as the
  // acknowledgeable `no_expected_signals` warning instead.)
  const missingRequirements =
    distributionMode === "single"
      ? lint.errors.filter((issue) => issue.id === "empty_prompt").map((issue) => issue.message)
      : [];
  const continueTooltip =
    !canContinue && missingRequirements.length > 0 ? missingRequirements.join(" ") : undefined;
  const handleSwitchToKorean =
    features.koPayload && settings.payloadLanguage !== "ko"
      ? () => onSettingsChange({ ...settings, payloadLanguage: "ko" })
      : undefined;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">2. Write the hidden instruction</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Author the instruction the model should follow, define expected signals, and choose how
          it's embedded.
        </p>
      </div>

      {/*
       * Distribution mode moved to the top (r11 review M-02): it used to sit at the bottom of
       * the form, yet switching it replaces everything above (raw/guided editor + signals
       * disappear, a different editor takes their place) — a control that reshapes the form
       * belongs before the content it reshapes, not after it.
       */}
      <div>
        <h3 className="text-lg font-semibold text-foreground">Distribution mode</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Generate one output (below), a labeled A/B/C variant set, or a per-student keyed set.
        </p>
        <div className="mt-3">
          <DistributionModeSelector mode={distributionMode} onChange={onDistributionModeChange} />
        </div>
        {distributionMode !== "single" && instruction.trim().length > 0 && (
          <p
            className="mt-2 text-xs text-muted-foreground"
            data-testid="single-instruction-kept-note"
          >
            Your single instruction is kept. Switch back to Single to use it.
          </p>
        )}
      </div>

      <Separator />

      {distributionMode === "single" && (
        <>
          <Tabs defaultValue="raw">
            <TabsList>
              <TabsTrigger value="raw" data-testid="instruction-tab-raw">
                Raw editor
              </TabsTrigger>
              <TabsTrigger value="guided" data-testid="instruction-tab-guided">
                Guided editor
              </TabsTrigger>
            </TabsList>
            <TabsContent value="raw">
              <RawEditor instruction={instruction} onChange={onInstructionChange} />
            </TabsContent>
            <TabsContent value="guided">
              <GuidedEditor
                onCopyToRaw={onInstructionChange}
                signals={signals}
                onSignalsChange={onSignalsChange}
              />
            </TabsContent>
          </Tabs>

          <LintPanel
            errors={lint.errors}
            warnings={lint.warnings}
            acknowledged={acknowledgedWarnings}
            onAcknowledgedChange={onAcknowledgedWarningsChange}
            onSwitchToKorean={handleSwitchToKorean}
          />

          <Separator />

          <div>
            <h3 className="text-lg font-semibold text-foreground">
              Expected signals
              <RequiredMark />
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Signals a matching submission should contain (used later to score compliance, never to
              render an "AI detected" verdict).
            </p>
            <div className="mt-3">
              <SignalBuilder signals={signals} onChange={onSignalsChange} />
            </div>
          </div>

          <Separator />
        </>
      )}

      {distributionMode === "variants" && (
        <>
          <VariantEditor
            variants={variantDrafts}
            onChange={onVariantDraftsChange}
            payloadLanguage={settings.payloadLanguage}
            onSwitchToKorean={handleSwitchToKorean}
          />
          <Separator />
        </>
      )}

      {distributionMode === "student_keyed" && (
        <>
          <StudentKeyedEditor
            draft={studentKeyedDraft}
            onChange={onStudentKeyedDraftChange}
            payloadLanguage={settings.payloadLanguage}
            onSwitchToKorean={handleSwitchToKorean}
          />
          <Separator />
        </>
      )}

      <div>
        <h3 className="text-lg font-semibold text-foreground">Injection settings</h3>
        <div className="mt-3">
          <InjectionSettingsForm
            settings={settings}
            onChange={onSettingsChange}
            pageCount={pageCount}
            instruction={instruction}
            koPayloadAvailable={features.koPayload}
            zhPayloadAvailable={features.zhPayload}
            canvasAvailable={features.canvasAvailable}
          />
        </div>
      </div>

      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button
          type="button"
          disabled={!canContinue}
          onClick={onContinue}
          title={continueTooltip}
          data-testid="instruction-continue-button"
        >
          Continue to generate
        </Button>
      </div>
    </div>
  );
}
