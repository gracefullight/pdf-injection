// Round 2 (Phase 3/4/5) request/response wire types shared between apps/api
// and apps/web. Source: .agents/results/api-contracts/pdf-injection-phase3-5-api.md §1-§4.
import type {
  BenchmarkCondition,
  DistributionStrategy,
  ExpectedSignal,
  InjectionMode,
  JobStatus,
  PayloadLanguage,
  PdfTransform,
  Position,
  ProviderName,
  RunStatus,
  SubmissionLabel,
  TargetPage,
  TextTransform,
  ValidationSummary,
} from "./types";

// ---------------------------------------------------------------------------
// §1 Variant sets & student-keyed sets
// ---------------------------------------------------------------------------

export interface VariantSpec {
  label: string;
  instruction: string;
  expectedSignals: ExpectedSignal[];
}

/** Shared injection-settings fields reused by variant-set / student-keyed-set creation. */
export interface VariantInjectionSettings {
  injectionMode: InjectionMode;
  targetPage?: TargetPage;
  position?: Position;
  x?: number;
  y?: number;
  fontSize?: number;
  maxWidth?: number;
  payloadLanguage?: PayloadLanguage;
  acknowledgedWarnings?: string[];
}

export interface VariantJobSummary {
  label: string;
  jobId: string;
  /**
   * The member job's own individual access token. `string` on
   * `POST /variant-sets` (shown once, at creation). `null` on
   * `GET /variant-sets/:id` — never re-displayed once created; the SET's
   * own `accessToken` (round-2 §1 note below) authorizes reads against
   * every member job's `/jobs/:jobId*` endpoints without it.
   */
  accessToken: string | null;
  status: JobStatus;
  errorCode: string | null;
  /** Present on GET /variant-sets/:id; absent (or omitted) right after creation. */
  summary?: ValidationSummary | null;
}

export interface VariantSetResponse {
  variantSetId: string;
  accessToken: string;
  sourceSha256: string;
  createdAt: string;
  variants: VariantJobSummary[];
}

export interface DistributionRequest {
  studentIds: string[];
  strategy: DistributionStrategy;
  seed?: string;
}

export interface DistributionAssignment {
  studentId: string;
  label: string;
  jobId: string;
}

export interface DistributionResponse {
  strategy: DistributionStrategy;
  seed: string | null;
  assignments: DistributionAssignment[];
  counts: Record<string, number>;
}

export interface StudentKeySummary {
  studentId: string;
  key: string;
  jobId: string;
  /** `string` on `POST /student-keyed-sets` (shown once). `null` on `GET /student-keyed-sets/:id` — the set's own token authorizes member-job reads instead. */
  accessToken: string | null;
  status: JobStatus;
  errorCode?: string | null;
}

export interface StudentKeyedSetResponse {
  setId: string;
  accessToken: string;
  sourceSha256?: string;
  createdAt?: string;
  students: StudentKeySummary[];
}

// ---------------------------------------------------------------------------
// §2 Model tests (Phase 3 — provider benchmark)
// ---------------------------------------------------------------------------

export interface ModelTestProviderSpec {
  name: ProviderName;
  model?: string;
}

export interface ModelTestRequest {
  providers: ModelTestProviderSpec[];
  conditions: BenchmarkCondition[] | "all";
  repeats: number;
  outerPrompt?: string;
  acknowledgeExternalTransfer: boolean;
}

export interface CreateRunResponse {
  runId: string;
  status: "queued";
  totalCalls: number;
}

export interface ModelTestRunListItem {
  runId: string;
  status: RunStatus;
  createdAt: string;
  progress: { done: number; total: number };
  providers: ModelTestProviderSpec[];
  conditions: BenchmarkCondition[];
  repeats: number;
}

export interface SignalMatch {
  signal: ExpectedSignal;
  matched: boolean;
  evidence: unknown;
}

export interface ModelTestResult {
  provider: ProviderName;
  modelId: string;
  condition: BenchmarkCondition;
  repeat: number;
  executedAt: string;
  outerPromptSha256: string;
  pdfSha256: string;
  rawResponse: string;
  responseSha256: string;
  signalMatches: SignalMatch[];
  allSignalsMatched: boolean;
  anySignalMatched: boolean;
  /** Normalized hidden instruction (or >= 12-word window of it) appears in the response. */
  disclosure: boolean;
  /** provider stop_reason === "refusal" or refusal heuristics. */
  refusal: boolean;
  latencyMs: number;
  usage: { inputTokens: number | null; outputTokens: number | null };
  error: string | null;
  /**
   * How the provider ingested the PDF (round-2 addendum §6): "provider_native"
   * for anthropic/openai (native PDF document input), "text_extraction" for
   * ollama (server-side page text extraction, since Ollama cannot ingest
   * PDFs directly), "mock" for the deterministic mock provider. Optional /
   * additive — absent on results produced before this field existed.
   */
  ingestion?: "provider_native" | "text_extraction" | "mock";
}

export interface ModelTestAggregate {
  provider: ProviderName;
  condition: BenchmarkCondition;
  n: number;
  allSignalsRate: number;
  anySignalRate: number;
  disclosureRate: number;
  refusalRate: number;
  meanLatencyMs: number;
  /** (condition rate - original rate) x 100 */
  deltaVsOriginalPp: number | null;
}

export interface SmokeTestGate {
  threshold: 50;
  best: { provider: ProviderName; condition: BenchmarkCondition; deltaPp: number } | null;
  passed: boolean;
  positiveControlRate: number | null;
  originalFalsePositiveRate: number | null;
  disclosureRateInjected: number | null;
  variationAcrossRepeats: number | null;
}

export interface ModelTestRun {
  runId: string;
  jobId: string;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  config: {
    providers: ModelTestProviderSpec[];
    conditions: BenchmarkCondition[];
    repeats: number;
    outerPrompt: string;
    outerPromptSha256: string;
  };
  progress: { done: number; total: number };
  results: ModelTestResult[];
  aggregates: ModelTestAggregate[];
  smokeTestGate: SmokeTestGate;
  /** Fixed non-overclaiming sentence(s); never "AI detected". */
  interpretation: string;
  errorCode: string | null;
}

// ---------------------------------------------------------------------------
// §3 Submissions (Phase 4 — submission detection research)
// ---------------------------------------------------------------------------

export type SubmissionSource = "text" | "txt" | "md" | "pdf" | "image_ocr";
export type SignalGroup = "methodology" | "lexical" | "structural";

export interface SubmissionSignalMatch {
  signal: ExpectedSignal;
  group: SignalGroup;
  matched: boolean;
  evidence: unknown;
  weight: number;
}

export interface SubmissionScores {
  methodology: number;
  lexical: number;
  structural: number;
  combined: number;
}

export type CalibrationMethod = "binomial_vs_baseline" | "insufficient_baseline";

export interface SubmissionCalibration {
  baselineCount: number;
  baselineCombinedScoreMean: number | null;
  baselineFalsePositiveRate: number | null;
  perSignalBaselineRate: Array<{ index: number; rate: number | null }>;
  pValue: number | null;
  holmAdjustedPValue: number | null;
  method: CalibrationMethod;
}

export type SubmissionInterpretationHeadline =
  | "Hidden instruction signal matched"
  | "Behavioral canary detected"
  | "No consistent signal";

export interface SubmissionInterpretation {
  headline: SubmissionInterpretationHeadline;
  text: string;
  alternatives: string[];
  uncertainty: string;
}

export interface SubmissionAnalysis {
  submissionId: string;
  jobId: string;
  label: SubmissionLabel;
  createdAt: string;
  textSha256: string;
  textLength: number;
  source: SubmissionSource;
  signals: SubmissionSignalMatch[];
  scores: SubmissionScores;
  calibration: SubmissionCalibration;
  interpretation: SubmissionInterpretation;
}

export interface SubmissionPerSignalStatistic {
  index: number;
  candidateRate: number | null;
  baselineRate: number | null;
  fisherExactP: number | null;
  holmAdjustedP: number | null;
  significant: boolean | null;
}

export interface SubmissionStatistics {
  candidateCount: number;
  baselineCount: number;
  perSignal: SubmissionPerSignalStatistic[];
  combined: {
    candidateAllRate: number | null;
    baselineAllRate: number | null;
    fisherExactP: number | null;
    deltaPp: number | null;
  };
  familyWiseAlpha: 0.05;
  notes: string[];
}

export interface SubmissionCalibrationSummary {
  baselineCount: number;
  candidateCount: number;
  baselineCombinedScoreMean: number | null;
  candidateCombinedScoreMean: number | null;
}

export interface SubmissionListResponse {
  submissions: SubmissionAnalysis[];
  calibrationSummary: SubmissionCalibrationSummary;
  statistics: SubmissionStatistics;
}

// ---------------------------------------------------------------------------
// §4 Robustness (Phase 5 — transformations)
// ---------------------------------------------------------------------------

export type TextSourceSpec =
  | { kind: "model_test_run"; runId: string }
  | { kind: "custom"; texts: string[] };

export interface RobustnessRequest {
  pdfTransforms: PdfTransform[];
  textTransforms: TextTransform[];
  textSource: TextSourceSpec;
  providers: ModelTestProviderSpec[];
  repeats: number;
  seed?: string;
  acknowledgeExternalTransfer: boolean;
}

export interface RobustnessExtraction {
  hiddenTextExtracted: boolean;
  targetPageMatch: boolean;
  anyPageMatch: boolean;
}

export interface RobustnessPdfResult {
  transform: PdfTransform;
  available: boolean;
  reason?: string;
  outputSha256: string | null;
  pageCount: number | null;
  extraction: RobustnessExtraction | null;
  geometryPreserved: boolean | null;
  ocrConfidence?: number | null;
}

export interface RobustnessTextSample {
  inputSha256: string;
  outputSha256: string;
  signalsBefore: number;
  signalsAfter: number;
  allMatchedBefore: boolean;
  allMatchedAfter: boolean;
}

export interface RobustnessTextResult {
  transform: TextTransform;
  provider: ProviderName;
  available: boolean;
  reason?: string;
  samples: RobustnessTextSample[];
  /** Fraction of samples where all signals still match after transform. */
  survivalRate: number | null;
}

export interface RobustnessRun {
  runId: string;
  jobId: string;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  progress: { done: number; total: number };
  pdfResults: RobustnessPdfResult[];
  textResults: RobustnessTextResult[];
  summary: string;
  errorCode: string | null;
}

export interface ScreenshotOcrResult {
  text: string;
  extraction: RobustnessExtraction;
  ocrConfidence: number | null;
}
