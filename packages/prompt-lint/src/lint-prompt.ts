import {
  type ExpectedSignal,
  LIMITS,
  type LintIssue,
  type PayloadLanguage,
} from "@pdf-injection/contracts";

export interface LintPromptOptions {
  /** default: LIMITS.maxInstructionChars (1500) */
  maxLength?: number;
  /**
   * Round 2 §0.1 — default "en" (printable-ASCII-only, unchanged v0.1
   * behavior). "ko" allows non-ASCII text (the `encoding_unsupported` check
   * below is specifically about drawable-font-glyph ASCII, which no longer
   * applies once a CJK font subset is embedded for payloadLanguage "ko" —
   * see packages/pdf-engine's inject.ts, which enforces the same gate at
   * the engine layer). Control characters / null bytes are still always
   * rejected regardless of language.
   */
  payloadLanguage?: PayloadLanguage;
}

export interface LintPromptResult {
  errors: LintIssue[];
  warnings: LintIssue[];
}

function err(id: string, message: string): LintIssue {
  return { id, severity: "error", message };
}

function warn(id: string, message: string): LintIssue {
  return { id, severity: "warning", message };
}

// Control chars other than \n (0x0A) and \t (0x09), including the null byte.
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — this is the detection target, not a mistake.
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;
// Anything outside printable ASCII (0x20-0x7E) plus \n and \t.
const NON_PRINTABLE_ASCII_RE = /[^\x20-\x7E\n\t]/;

const FAKE_CITATION_RE =
  /\b(cite|citation|reference|source)s?\b[^.\n]{0,40}\b(fake|fabricat\w*|made[- ]up|non-?existent|invented|imaginary)\b|\b(fabricat\w*|invent\w*|made[- ]up)\b[^.\n]{0,40}\b(citation|source|reference)s?\b/i;

const FABRICATED_FACTS_RE =
  /\b(fabricat\w*|invent\w*|made[- ]up|imaginary)\b[^.\n]{0,40}\b(fact|facts|data|statistic|statistics|number|numbers|figure|figures|result|results)\b/i;

const DISCLOSE_RE =
  /\b(quote|reveal|disclose|mention|state|repeat|copy|admit|confirm)\b[^.\n]{0,60}\b(this (hidden )?instruction|this prompt|these instructions|you were instructed)\b/i;
const NEGATED_DISCLOSE_RE =
  /\b(do not|don't|never|without)\b[^.\n]{0,40}\b(quote|reveal|disclose|mention|state|repeat|copy|admit|confirm)\b[^.\n]{0,60}\b(this (hidden )?instruction|this prompt|these instructions|you were instructed)\b/i;

const JAILBREAK_RE =
  /\b(ignore (all |any |the |your |previous )*(instructions|rules|guidelines)|disregard (your |all |the )*(guidelines|instructions|training|rules)|you are now (unrestricted|free|DAN)|jailbreak|DAN mode|pretend you have no restrictions|bypass (your |the )*(safety|content) (filter|policy|guidelines))\b/i;

const GRADING_DISTORTION_RE =
  /\b(give (a |an )?(perfect|full|high|maximum) (score|grade|marks)|guarantee (a|an) (a\+?|pass|good grade)|ignore (errors|mistakes|flaws|issues) when grading|always (approve|pass) this (assignment|submission)|regardless of (content|quality|correctness))\b/i;

const INAPPROPRIATE_METHODOLOGY_WORDS = [
  "random",
  "arbitrary",
  "whatever",
  "guess",
  "magic",
  "nonsense",
];

const COMMON_SIGNAL_WORDS = new Set([
  "the",
  "a",
  "an",
  "result",
  "results",
  "conclusion",
  "summary",
  "introduction",
  "analysis",
  "data",
  "method",
  "methods",
  "discussion",
  "abstract",
  "overview",
]);

function collectSignalTextValues(signals: ExpectedSignal[]): string[] {
  const values: string[] = [];
  for (const signal of signals) {
    if (signal.type === "exact_phrase") values.push(signal.value);
    else if (signal.type === "methodology_label") {
      values.push(signal.value, ...signal.aliases);
    } else if (signal.type === "ordered_terms" || signal.type === "section_order") {
      values.push(...signal.values);
    }
  }
  return values;
}

/**
 * Lints a hidden instruction + its expected signals per PRD §11.3. Pure,
 * dependency-free (browser-safe): usable from apps/web for live linting and
 * from apps/api for server-side enforcement (PROMPT_LINT_ERROR).
 */
export function lintPrompt(
  instruction: string,
  expectedSignals: ExpectedSignal[],
  opts: LintPromptOptions = {},
): LintPromptResult {
  const maxLength = opts.maxLength ?? LIMITS.maxInstructionChars;
  const errors: LintIssue[] = [];
  const warnings: LintIssue[] = [];

  if (instruction.trim().length === 0) {
    errors.push(err("empty_prompt", "Hidden instruction is empty."));
  }

  if (instruction.length > maxLength) {
    errors.push(
      err(
        "prompt_too_long",
        `Hidden instruction exceeds the maximum length of ${maxLength} characters.`,
      ),
    );
  }

  if (instruction.includes("\0")) {
    errors.push(err("null_byte", "Hidden instruction contains a null byte."));
  }

  if (CONTROL_CHAR_RE.test(instruction)) {
    errors.push(
      err("control_character", "Hidden instruction contains an unsupported control character."),
    );
  }

  if (opts.payloadLanguage !== "ko" && NON_PRINTABLE_ASCII_RE.test(instruction)) {
    errors.push(
      err(
        "encoding_unsupported",
        "Hidden instruction contains characters that cannot be encoded with the selected font (non-printable ASCII).",
      ),
    );
  }

  if (expectedSignals.length === 0) {
    errors.push(err("empty_expected_signals", "At least one expected signal is required."));
  }

  if (FAKE_CITATION_RE.test(instruction)) {
    warnings.push(
      warn("fake_citation", "This instruction appears to request a fake or fabricated citation."),
    );
  }

  if (FABRICATED_FACTS_RE.test(instruction)) {
    warnings.push(
      warn(
        "fabricated_facts",
        "This instruction appears to request fabricated facts, data, or statistics.",
      ),
    );
  }

  if (DISCLOSE_RE.test(instruction) && !NEGATED_DISCLOSE_RE.test(instruction)) {
    warnings.push(
      warn(
        "disclose_instruction",
        "This instruction appears to ask the model to disclose the hidden instruction itself.",
      ),
    );
  }

  if (JAILBREAK_RE.test(instruction)) {
    warnings.push(
      warn("jailbreak_phrasing", "This instruction contains jailbreak-style phrasing."),
    );
  }

  if (GRADING_DISTORTION_RE.test(instruction)) {
    warnings.push(
      warn(
        "grading_distortion",
        "This instruction appears to ask for grading results to be distorted.",
      ),
    );
  }

  const signalValues = collectSignalTextValues(expectedSignals);

  for (const value of signalValues) {
    if (value.length > 120) {
      warnings.push(
        warn(
          "exact_phrase_too_long",
          `Expected signal value is unusually long (${value.length} characters).`,
        ),
      );
      break;
    }
  }

  for (const value of signalValues) {
    if (COMMON_SIGNAL_WORDS.has(value.trim().toLowerCase())) {
      warnings.push(
        warn(
          "common_signal",
          `"${value}" is a common word that may appear in unrelated submissions.`,
        ),
      );
      break;
    }
  }

  for (const signal of expectedSignals) {
    if (signal.type !== "methodology_label") continue;
    const candidates = [signal.value, ...signal.aliases].map((v) => v.toLowerCase());
    const hasInappropriateWord = candidates.some((c) =>
      INAPPROPRIATE_METHODOLOGY_WORDS.some((w) => c.includes(w)),
    );
    if (hasInappropriateWord) {
      warnings.push(
        warn(
          "inappropriate_methodology_hint",
          `Methodology "${signal.value}" may be inappropriate for the assignment.`,
        ),
      );
      break;
    }
  }

  return { errors, warnings };
}
