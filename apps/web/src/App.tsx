import type { ExpectedSignal } from "@pdf-injection/contracts";
import { Check, FileCode2, Layers } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ErrorBoundary } from "@/components/error-boundary";
import { GenerateScreen } from "@/features/instruction-editor/generate-screen";
import { InstructionScreen } from "@/features/instruction-editor/instruction-screen";
import {
  DEFAULT_INJECTION_SETTINGS,
  type InjectionSettings,
} from "@/features/instruction-editor/instruction-types";
import { pruneAcknowledgedWarnings } from "@/features/instruction-editor/prune-acknowledged-warnings";
import { ProviderSettingsDialog } from "@/features/provider-settings/provider-settings-dialog";
import { RasterizerScreen } from "@/features/rasterizer/rasterizer-screen";
import { UploadScreen } from "@/features/upload/upload-screen";
import type { UploadedSource } from "@/features/upload/upload-types";
import { ValidationScreen } from "@/features/validation-result/validation-screen";
import { StudentKeyedSetResultScreen } from "@/features/variants/student-keyed-set-result-screen";
import { VariantSetResultScreen } from "@/features/variants/variant-set-result-screen";
import {
  type DistributionMode,
  defaultStudentKeyedDraft,
  defaultVariantDrafts,
  type StudentKeyedDraft,
  type VariantDraft,
} from "@/features/variants/variant-types";
import { clearDraft, type InstructionDraft, loadDraft, saveDraft } from "@/lib/draft-storage";
import { clearJobCredentials, loadJobCredentials, saveJobCredentials } from "@/lib/job-storage";
import { isLocalJobId } from "@/lib/local-job/run-local-job";
import { useLocalMode } from "@/lib/local-mode";
import { clearAllSetCredentials, loadSetCredentials, saveSetCredentials } from "@/lib/set-storage";
import { cn } from "@/lib/utils";
import { canNavigateBackToStep, type WizardStep } from "@/lib/wizard-navigation";

/** Debounce delay for the draft-persistence effect (r11 review M-18) — long enough that a fast
 * typist doesn't trigger a sessionStorage write on every keystroke, short enough that closing the
 * tab a moment after the last keystroke still saves. */
const DRAFT_SAVE_DEBOUNCE_MS = 600;

const STEP_LABELS: Record<WizardStep, string> = {
  1: "Upload",
  2: "Instruction",
  3: "Generate",
  4: "Validate",
};

interface JobCredentials {
  jobId: string;
  accessToken: string;
}

/** Terminal step-4 result of `distributionMode: "variants"` / `"student_keyed"` (see generate-screen.tsx). Not persisted across a page refresh — only the single-job flow is (see `job-storage.ts`), since a set has no equivalent "current set" storage slot yet. */
interface SetCredentials {
  id: string;
  accessToken: string;
}

/**
 * A locally generated job lives only in this tab's memory (see
 * `lib/local-job/local-job-store.ts`), so a restored credential pair would
 * send the wizard straight to a step-4 screen with nothing behind it. Drop it
 * and start fresh instead.
 */
function initialJob(): JobCredentials | null {
  const stored = loadJobCredentials();
  if (stored && isLocalJobId(stored.jobId)) {
    clearJobCredentials();
    return null;
  }
  return stored;
}

function initialVariantSet(): SetCredentials | null {
  const stored = loadSetCredentials("variantSet");
  return stored ? { id: stored.id, accessToken: stored.accessToken } : null;
}

function initialStudentKeyedSet(): SetCredentials | null {
  const stored = loadSetCredentials("studentKeyedSet");
  return stored ? { id: stored.id, accessToken: stored.accessToken } : null;
}

/** Only restored when there's no active job/set — an in-progress authoring draft is irrelevant
 * once a job/set already exists (the wizard jumps straight to step 4 for those). */
function initialDraft(hasActiveJobOrSet: boolean): InstructionDraft | null {
  return hasActiveJobOrSet ? null : loadDraft();
}

export function App() {
  const hasActiveJobOrSet = Boolean(
    initialJob() || initialVariantSet() || initialStudentKeyedSet(),
  );
  const restoredDraft = initialDraft(hasActiveJobOrSet);

  const [appMode, setAppMode] = useState<"injection" | "rasterizer">("injection");
  const [step, setStep] = useState<WizardStep>(() => (hasActiveJobOrSet ? 4 : 1));
  const [source, setSource] = useState<UploadedSource | null>(null);
  const [instruction, setInstruction] = useState(() => restoredDraft?.instruction ?? "");
  const [signals, setSignals] = useState<ExpectedSignal[]>(() => restoredDraft?.signals ?? []);
  const [settings, setSettings] = useState<InjectionSettings>(
    () => restoredDraft?.settings ?? DEFAULT_INJECTION_SETTINGS,
  );
  const [acknowledgedWarnings, setAcknowledgedWarnings] = useState<string[]>([]);
  // Decides (and publishes, for `api.ts`) whether jobs run on-device — see lib/local-mode.ts.
  const localMode = useLocalMode();
  const [job, setJob] = useState<JobCredentials | null>(initialJob);
  const [distributionMode, setDistributionMode] = useState<DistributionMode>(
    () => restoredDraft?.distributionMode ?? "single",
  );
  const [variantDrafts, setVariantDrafts] = useState<VariantDraft[]>(
    () => restoredDraft?.variantDrafts ?? defaultVariantDrafts(),
  );
  const [studentKeyedDraft, setStudentKeyedDraft] = useState<StudentKeyedDraft>(
    () => restoredDraft?.studentKeyedDraft ?? defaultStudentKeyedDraft(),
  );
  // Persisted to sessionStorage (like the single-job flow's job-storage.ts) so a page refresh
  // mid-way through a variant / student-keyed result screen doesn't force a full regenerate
  // (r11 DX review L2, carried forward from r7's QA review).
  const [variantSet, setVariantSet] = useState<SetCredentials | null>(
    job ? null : initialVariantSet,
  );
  const [studentKeyedSet, setStudentKeyedSet] = useState<SetCredentials | null>(
    job || variantSet ? null : initialStudentKeyedSet,
  );
  // `source` (the uploaded PDF) is deliberately never persisted — too large for sessionStorage,
  // and asking the professor to re-select the file is a cheap ask compared to a full-page-reload
  // data-loss risk (r11 review M-18). This flag drives the "Draft restored — please re-select
  // the PDF" notice on Upload while `source` is still null.
  const [draftRestored, setDraftRestored] = useState(restoredDraft !== null);
  const draftSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced draft save — skipped once a job/set exists (the draft has become a real result;
  // handleGenerated*/resetFlow below clear it explicitly at that point instead).
  useEffect(() => {
    if (job || variantSet || studentKeyedSet) return;
    if (draftSaveTimeoutRef.current) clearTimeout(draftSaveTimeoutRef.current);
    draftSaveTimeoutRef.current = setTimeout(() => {
      saveDraft({
        instruction,
        signals,
        settings,
        distributionMode,
        variantDrafts,
        studentKeyedDraft,
      });
    }, DRAFT_SAVE_DEBOUNCE_MS);
    return () => {
      if (draftSaveTimeoutRef.current) clearTimeout(draftSaveTimeoutRef.current);
    };
  }, [
    instruction,
    signals,
    settings,
    distributionMode,
    variantDrafts,
    studentKeyedDraft,
    job,
    variantSet,
    studentKeyedSet,
  ]);

  function handleClearDraft() {
    clearDraft();
    setDraftRestored(false);
    setInstruction("");
    setSignals([]);
    setSettings(DEFAULT_INJECTION_SETTINGS);
    setAcknowledgedWarnings([]);
    setDistributionMode("single");
    setVariantDrafts(defaultVariantDrafts());
    setStudentKeyedDraft(defaultStudentKeyedDraft());
  }

  function resetFlow() {
    clearJobCredentials();
    clearAllSetCredentials();
    clearDraft();
    setJob(null);
    setVariantSet(null);
    setStudentKeyedSet(null);
    setSource(null);
    setInstruction("");
    setSignals([]);
    setSettings(DEFAULT_INJECTION_SETTINGS);
    setAcknowledgedWarnings([]);
    setDistributionMode("single");
    setVariantDrafts(defaultVariantDrafts());
    setStudentKeyedDraft(defaultStudentKeyedDraft());
    setDraftRestored(false);
    setStep(1);
  }

  function handleGenerated(jobId: string, accessToken: string) {
    const credentials = { jobId, accessToken };
    // Local jobs are memory-only, so persisting their credentials would just
    // restore an empty step 4 after a reload (see `initialJob`).
    if (!isLocalJobId(jobId)) saveJobCredentials(credentials);
    clearDraft();
    setJob(credentials);
    setStep(4);
  }

  function handleVariantSetGenerated(variantSetId: string, accessToken: string) {
    saveSetCredentials("variantSet", { id: variantSetId, accessToken });
    clearDraft();
    setVariantSet({ id: variantSetId, accessToken });
    setStep(4);
  }

  function handleStudentKeyedSetGenerated(setId: string, accessToken: string) {
    saveSetCredentials("studentKeyedSet", { id: setId, accessToken });
    clearDraft();
    setStudentKeyedSet({ id: setId, accessToken });
    setStep(4);
  }

  // Any edit to the instruction text or expected signals invalidates every prior warning
  // acknowledgement: `LintIssue.id` is a fixed string (e.g. "jailbreak_phrasing"), so the same
  // id can re-trigger on materially different content and must be re-confirmed rather than
  // silently staying checked. See result-qa-task3 MEDIUM finding.
  function handleInstructionChange(next: string) {
    setInstruction(next);
    setAcknowledgedWarnings((prev) => pruneAcknowledgedWarnings(prev, []));
  }

  function handleSignalsChange(next: ExpectedSignal[]) {
    setSignals(next);
    setAcknowledgedWarnings((prev) => pruneAcknowledgedWarnings(prev, []));
  }

  /**
   * Backwards-only navigation via the stepper — lets the professor return from
   * a later step (notably the terminal step 4 result) to step 2/3 to adjust the
   * instruction or injection settings and regenerate, instead of only being
   * able to Start Over (which wipes everything). Forward jumps are intentionally
   * NOT allowed here: step 4 is reached by generating (a new job), never by
   * clicking ahead to a stale one.
   *
   * The in-memory instruction/signals/settings survive this move (they live in
   * this component, not just the sessionStorage draft), so a step-4 → step-3
   * hop lands on the same settings the job was built from. A still-set
   * `job`/`variantSet`/`studentKeyedSet` is left untouched so the existing
   * result stays reachable until a regenerate replaces it.
   */
  function goToStep(target: WizardStep) {
    if (canNavigateBackToStep(target, step, source !== null)) setStep(target);
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-4 py-8 sm:px-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">PDF Injection</h1>
          <p className="text-sm text-muted-foreground">
            Hidden instruction authoring and validation for PDF assignments
            {localMode.enabled && (
              // Quiet marker rather than a banner: on-device is the normal mode
              // for a static deployment, so it should not shout on every screen.
              // The research tabs explain their own unavailability where they live.
              <>
                {" · "}
                <span data-testid="local-mode-indicator" title="Nothing leaves this browser">
                  on-device
                </span>
              </>
            )}
          </p>
        </div>
        <ProviderSettingsDialog />
      </header>

      {/* Top-Level Mode Navigation */}
      <nav className="flex items-center gap-2 border-b pb-3" aria-label="Main Navigation">
        <button
          type="button"
          onClick={() => setAppMode("injection")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors",
            appMode === "injection"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
          data-testid="nav-injection-mode"
        >
          <FileCode2 className="size-4" />
          <span>Injection Studio</span>
        </button>

        <button
          type="button"
          onClick={() => setAppMode("rasterizer")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors",
            appMode === "rasterizer"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
          data-testid="nav-rasterizer-mode"
        >
          <Layers className="size-4" />
          <span>PDF Rasterizer</span>
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-xs font-normal",
              appMode === "rasterizer"
                ? "bg-primary-foreground/20 text-primary-foreground"
                : "bg-muted-foreground/15 text-muted-foreground",
            )}
          >
            Sanitizer
          </span>
        </button>
      </nav>

      {appMode === "rasterizer" ? (
        <main>
          <ErrorBoundary label="PDF Rasterizer">
            <RasterizerScreen />
          </ErrorBoundary>
        </main>
      ) : (
        <>
          <div data-testid="wizard-stepper">
            {/* Compact single-line indicator below `sm` — the full step list never wraps cleanly at
                375px (r11 review H-01: `document.scrollWidth` exceeded the viewport on every screen,
                causing horizontal scroll app-wide). */}
            <div className="flex items-center justify-between gap-2 sm:hidden">
              <p
                className="text-sm font-medium text-foreground"
                role="status"
                aria-label="Progress"
              >
                Step {step} of 4 · {STEP_LABELS[step]}
              </p>
              {step > 1 &&
                canNavigateBackToStep((step - 1) as WizardStep, step, source !== null) && (
                  <button
                    type="button"
                    onClick={() => goToStep((step - 1) as WizardStep)}
                    className="shrink-0 rounded-md px-2 py-1 text-sm font-medium text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    data-testid="wizard-back-step"
                  >
                    ← {STEP_LABELS[(step - 1) as WizardStep]}
                  </button>
                )}
            </div>
            <ol className="hidden items-center gap-2 sm:flex" aria-label="Progress">
              {([1, 2, 3, 4] as WizardStep[]).map((s, index) => {
                // Earlier steps are clickable to go back (Upload needs no source;
                // Instruction/Generate do). The current and later steps are not.
                const navigable = canNavigateBackToStep(s, step, source !== null);
                const circle = (
                  <span
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                      s === step
                        ? "border-primary bg-primary text-primary-foreground"
                        : s < step
                          ? "border-primary bg-accent text-accent-foreground"
                          : "border-border text-muted-foreground",
                    )}
                    aria-current={s === step ? "step" : undefined}
                  >
                    {s < step ? <Check className="size-4" /> : s}
                  </span>
                );
                const label = (
                  <span
                    className={cn(
                      "truncate text-sm",
                      s === step ? "font-semibold text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {STEP_LABELS[s]}
                  </span>
                );
                return (
                  <li key={s} className="flex min-w-0 flex-1 items-center gap-2">
                    {navigable ? (
                      <button
                        type="button"
                        onClick={() => goToStep(s)}
                        className="-mx-1 flex min-w-0 items-center gap-2 rounded-md px-1 py-0.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={`Go back to step ${s}: ${STEP_LABELS[s]}`}
                        data-testid={`wizard-step-${s}`}
                      >
                        {circle}
                        {label}
                      </button>
                    ) : (
                      <div className="flex min-w-0 items-center gap-2">
                        {circle}
                        {label}
                      </div>
                    )}
                    {index < 3 && (
                      <span className="mx-1 h-px min-w-4 flex-1 bg-border" aria-hidden="true" />
                    )}
                  </li>
                );
              })}
            </ol>
          </div>

          <main>
            <ErrorBoundary label="this screen" key={step}>
              {step === 1 && (
                <UploadScreen
                  source={source}
                  onSourceReady={setSource}
                  onContinue={() => setStep(2)}
                  draftRestored={draftRestored && !source}
                  onClearDraft={handleClearDraft}
                  onClearSource={() => setSource(null)}
                />
              )}

              {step === 2 && source && (
                <InstructionScreen
                  instruction={instruction}
                  onInstructionChange={handleInstructionChange}
                  signals={signals}
                  onSignalsChange={handleSignalsChange}
                  settings={settings}
                  onSettingsChange={setSettings}
                  acknowledgedWarnings={acknowledgedWarnings}
                  onAcknowledgedWarningsChange={setAcknowledgedWarnings}
                  pageCount={source.pageCount}
                  onBack={() => setStep(1)}
                  onContinue={() => setStep(3)}
                  distributionMode={distributionMode}
                  onDistributionModeChange={setDistributionMode}
                  variantDrafts={variantDrafts}
                  onVariantDraftsChange={setVariantDrafts}
                  studentKeyedDraft={studentKeyedDraft}
                  onStudentKeyedDraftChange={setStudentKeyedDraft}
                />
              )}

              {step === 3 && source && (
                <GenerateScreen
                  source={source}
                  instruction={instruction}
                  signals={signals}
                  settings={settings}
                  acknowledgedWarnings={acknowledgedWarnings}
                  onBack={() => setStep(2)}
                  onGenerated={handleGenerated}
                  distributionMode={distributionMode}
                  variantDrafts={variantDrafts}
                  studentKeyedDraft={studentKeyedDraft}
                  onVariantSetGenerated={handleVariantSetGenerated}
                  onStudentKeyedSetGenerated={handleStudentKeyedSetGenerated}
                />
              )}

              {step === 4 && job && (
                <ValidationScreen
                  jobId={job.jobId}
                  accessToken={job.accessToken}
                  sourceStem={(source?.file.name ?? "assignment.pdf").replace(/\.pdf$/i, "")}
                  onDeleted={resetFlow}
                  onStartOver={resetFlow}
                />
              )}

              {step === 4 && variantSet && (
                <VariantSetResultScreen
                  variantSetId={variantSet.id}
                  accessToken={variantSet.accessToken}
                  sourceStem={(source?.file.name ?? "assignment.pdf").replace(/\.pdf$/i, "")}
                  onDeleted={resetFlow}
                  onStartOver={resetFlow}
                />
              )}

              {step === 4 && studentKeyedSet && (
                <StudentKeyedSetResultScreen
                  setId={studentKeyedSet.id}
                  accessToken={studentKeyedSet.accessToken}
                  sourceStem={(source?.file.name ?? "assignment.pdf").replace(/\.pdf$/i, "")}
                  onDeleted={resetFlow}
                  onStartOver={resetFlow}
                />
              )}
            </ErrorBoundary>
          </main>
        </>
      )}
    </div>
  );
}
