import type {
  ExpectedSignal,
  InjectionMode,
  PayloadLanguage,
  Position,
  PrivateManifest,
  ValidationSummary,
} from "@pdf-injection/contracts";

export interface BuildManifestInput {
  jobId: string;
  sourceFile: { name: string; sha256: string; sizeBytes: number };
  outputFile: { name: string; sha256: string; sizeBytes: number };
  prompt: {
    sha256: string;
    instruction: string;
    normalizedInstruction: string;
    length: number;
    /** default "en" (backward compatible with round-1 callers that don't pass it). */
    language?: PayloadLanguage;
  };
  expectedSignals: ExpectedSignal[];
  injection: {
    mode: InjectionMode;
    pageIndex: number;
    position: Position;
    fontSize: number;
    boundingBox: [number, number, number, number];
  };
  validation: ValidationSummary;
  toolVersions: {
    bun: string;
    pdfLib: string;
    pdfJs: string;
    qpdf: string | null;
    pdfInjection: string;
  };
  createdAt?: string;
}

const PRIVATE_WARNING =
  "PRIVATE — contains the hidden instruction. Do not distribute to students." as const;

/**
 * Builds the PrivateManifest artifact. PRD §14: professor-only, contains the
 * hidden instruction in plaintext, source/output/prompt hashes, tool
 * versions, and the mandatory distribution warning.
 */
export function buildManifest(input: BuildManifestInput): PrivateManifest {
  return {
    schemaVersion: "0.2",
    jobId: input.jobId,
    sourceFile: input.sourceFile,
    outputFile: input.outputFile,
    prompt: {
      sha256: input.prompt.sha256,
      instruction: input.prompt.instruction,
      normalizedInstruction: input.prompt.normalizedInstruction,
      language: input.prompt.language ?? "en",
      length: input.prompt.length,
    },
    expectedSignals: input.expectedSignals,
    injection: input.injection,
    validation: input.validation,
    toolVersions: input.toolVersions,
    createdAt: input.createdAt ?? new Date().toISOString(),
    warning: PRIVATE_WARNING,
  };
}
