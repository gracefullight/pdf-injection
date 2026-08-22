// Phase 5 robustness text transforms (PRD §26/§27): human_edit and
// paraphrase have deterministic seeded local fallbacks so robustness runs
// always produce a result even without a configured provider; translation
// has no meaning-preserving local fallback and is gated on a provider.
import { seededRandom } from "./prng";

export type TextTransformKind = "paraphrase" | "translation" | "human_edit";

/**
 * Minimal structural provider interface for text transforms. r3's
 * `ProviderAdapter` (packages/benchmark) exposes `askText({ prompt, text })
 * => Promise<ProviderAnswer>` alongside its PDF-oriented `askWithPdf`, where
 * `ProviderAnswer` is `{ text, stopReason, refusal, usage, latencyMs, raw?,
 * error? }` — critically, `askText` never throws on a provider/config
 * failure: it *resolves* with `error` set (a message, e.g.
 * `PROVIDER_NOT_CONFIGURED`) and `text: ""`. Any `ProviderAdapter` instance
 * structurally satisfies this interface as-is (extra fields ignored) — no
 * adapter shim needed. Callers implementing a custom `TextProvider` may
 * still `throw` instead; both failure modes are handled (see
 * `runProvider()` below).
 */
export interface TextProvider {
  name?: string;
  askText(input: { prompt: string; text: string }): Promise<{ text: string; error?: string }>;
}

export interface TransformTextOptions {
  /** Determinism seed for human_edit / paraphrase-mock. Defaults to a fixed constant when omitted (still deterministic, just not caller-chosen). */
  seed?: string;
  provider?: TextProvider;
  targetLanguage?: string;
  /** human_edit only: words that must never be dropped by the ~5% word-drop step (case-insensitive, punctuation-stripped match). */
  protectedTerms?: string[];
}

export interface TransformTextResult {
  available: boolean;
  reason?: string;
  text: string | null;
  provider: "mock" | string;
}

const DEFAULT_SEED = "pdf-injection-default-seed";

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function wordCore(token: string): string {
  return token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").toLowerCase();
}

/**
 * Deterministic (given `seed`) simulation of a human lightly editing a
 * document: drops ~10% of sentences (never all of them), swaps two adjacent
 * sentences, and drops ~5% of words that aren't in `protectedTerms`.
 */
function humanEditTransform(text: string, opts: TransformTextOptions): TransformTextResult {
  const seed = opts.seed ?? DEFAULT_SEED;
  const protectedSet = new Set((opts.protectedTerms ?? []).map((t) => t.toLowerCase()));
  const rand = seededRandom(`human_edit:${seed}`);

  const original = splitSentences(text);
  const firstSentence = original[0];
  if (firstSentence === undefined) {
    return { available: true, text, provider: "mock" };
  }

  // 1. Delete ~10% of sentences (keep at least one).
  let kept = original.filter(() => rand() >= 0.1);
  if (kept.length === 0) kept = [firstSentence];

  // 2. Swap two adjacent sentences (deterministic position from the seed).
  if (kept.length >= 2) {
    const i = Math.floor(rand() * (kept.length - 1));
    const a = kept[i];
    const b = kept[i + 1];
    if (a !== undefined && b !== undefined) {
      kept[i] = b;
      kept[i + 1] = a;
    }
  }

  // 3. Drop ~5% of words, skipping protected terms.
  const edited = kept.map((sentence) => {
    const tokens = sentence.split(/(\s+)/); // odd indices are whitespace runs, kept verbatim
    const survivors = tokens.filter((token) => {
      if (token === "" || /^\s+$/.test(token)) return true;
      const core = wordCore(token);
      if (core && protectedSet.has(core)) return true;
      return rand() >= 0.05;
    });
    return survivors.join("");
  });

  return { available: true, text: edited.join(" "), provider: "mock" };
}

// Seeded synonym table (~60 common academic-writing words). One direction
// only (deterministic, not randomized per-word) — the seed instead drives
// whether clause reordering is applied per sentence, so different seeds
// still produce different (but reproducible) paraphrases.
// TODO(oma-deferred): replace with a real paraphrase provider call
// (anthropic/openai via @pdf-injection/benchmark) when PS_ALLOW_EXTERNAL_PROVIDERS
// is configured; this table is a deterministic, offline-safe stand-in.
const SYNONYM_TABLE: Record<string, string> = {
  analyze: "examine",
  analyzed: "examined",
  analyzes: "examines",
  analyzing: "examining",
  approach: "method",
  method: "technique",
  methods: "techniques",
  methodology: "approach",
  significant: "notable",
  significantly: "notably",
  indicate: "suggest",
  indicates: "suggests",
  indicated: "suggested",
  demonstrate: "show",
  demonstrates: "shows",
  demonstrated: "showed",
  evaluate: "assess",
  evaluated: "assessed",
  evaluates: "assesses",
  evaluation: "assessment",
  investigate: "explore",
  investigated: "explored",
  investigates: "explores",
  utilize: "use",
  utilized: "used",
  utilizes: "uses",
  comprehensive: "thorough",
  extensive: "wide-ranging",
  substantial: "considerable",
  robust: "reliable",
  framework: "structure",
  dataset: "data set",
  hypothesis: "premise",
  findings: "results",
  contribute: "add",
  contribution: "addition",
  novel: "new",
  existing: "current",
  prior: "earlier",
  previous: "earlier",
  subsequently: "afterward",
  consequently: "as a result",
  moreover: "furthermore",
  additionally: "in addition",
  however: "nonetheless",
  therefore: "thus",
  furthermore: "in addition",
  crucial: "essential",
  fundamental: "core",
  underlying: "underpinning",
  comprise: "consist of",
  reveal: "show",
  revealed: "showed",
  establish: "confirm",
  established: "confirmed",
  validate: "verify",
  validated: "verified",
  compare: "contrast",
  compared: "contrasted",
  enhance: "improve",
  enhanced: "improved",
  facilitate: "enable",
  facilitated: "enabled",
  mitigate: "reduce",
  address: "tackle",
  addressed: "tackled",
  outline: "summarize",
  outlines: "summarizes",
  highlight: "emphasize",
  highlights: "emphasizes",
};

function applySynonyms(text: string): string {
  return text.replace(/\p{L}[\p{L}'-]*/gu, (word) => {
    const lower = word.toLowerCase();
    const synonym = SYNONYM_TABLE[lower];
    if (!synonym) return word;
    // Preserve simple capitalization patterns of the matched word.
    if (word === word.toUpperCase() && word !== word.toLowerCase()) return synonym.toUpperCase();
    if (word[0] === word[0]?.toUpperCase() && word.slice(1) === word.slice(1).toLowerCase()) {
      return synonym.charAt(0).toUpperCase() + synonym.slice(1);
    }
    return synonym;
  });
}

function reorderClauses(sentence: string, rand: () => number): string {
  const commaIndex = sentence.indexOf(", ");
  if (commaIndex === -1) return sentence;
  if (rand() < 0.5) return sentence; // seed decides whether this sentence gets reordered
  const first = sentence.slice(0, commaIndex);
  const rest = sentence.slice(commaIndex + 2);
  if (!first || !rest) return sentence;
  const restTrimmed =
    rest.endsWith(".") || rest.endsWith("!") || rest.endsWith("?") ? rest.slice(0, -1) : rest;
  const terminator =
    rest.endsWith(".") || rest.endsWith("!") || rest.endsWith("?") ? rest.slice(-1) : "";
  return `${restTrimmed[0]?.toUpperCase()}${restTrimmed.slice(1)}, ${first.charAt(0).toLowerCase()}${first.slice(1)}${terminator}`;
}

function mockParaphrase(text: string, seed: string): string {
  const rand = seededRandom(`paraphrase:${seed}`);
  const sentences = splitSentences(text);
  if (sentences.length === 0) return applySynonyms(text);
  return sentences.map((s) => reorderClauses(applySynonyms(s), rand)).join(" ");
}

/**
 * Calls `provider.askText(...)` and normalizes BOTH of its failure modes
 * into `{ available: false, reason, text: null }`:
 *  - it *throws* (a custom `TextProvider` implementation, or an unexpected
 *    error), or
 *  - it *resolves* with `error` set and/or an empty `text` — the actual
 *    behavior of r3's real `ProviderAdapter.askText` on
 *    `PROVIDER_NOT_CONFIGURED` / rate-limit / API-error paths, which never
 *    throws by design (packages/benchmark/src/providers/types.ts). Treating
 *    a resolved `{ text: "" }` as success here would silently fabricate an
 *    empty transformed sample, which — fed into `survival.ts` — reports
 *    0% signal survival for a transform that was never actually applied,
 *    not "the transform destroyed every signal". Cycle 3 QA finding
 *    (HIGH).
 */
async function runProvider(
  provider: TextProvider,
  prompt: string,
  text: string,
  actionLabel: string,
): Promise<TransformTextResult> {
  const providerName = provider.name ?? "provider";
  try {
    const result = await provider.askText({ prompt, text });
    if (result.error) {
      return { available: false, reason: result.error, text: null, provider: providerName };
    }
    if (result.text === "") {
      return {
        available: false,
        reason: `${actionLabel} provider returned an empty result with no error field`,
        text: null,
        provider: providerName,
      };
    }
    return { available: true, text: result.text, provider: providerName };
  } catch (err) {
    return {
      available: false,
      reason: `${actionLabel} provider call failed: ${err instanceof Error ? err.message : String(err)}`,
      text: null,
      provider: providerName,
    };
  }
}

async function paraphraseTransform(
  text: string,
  opts: TransformTextOptions,
): Promise<TransformTextResult> {
  if (opts.provider) {
    return runProvider(
      opts.provider,
      `Paraphrase the following text preserving meaning:\n\n${text}`,
      text,
      "paraphrase",
    );
  }
  return {
    available: true,
    text: mockParaphrase(text, opts.seed ?? DEFAULT_SEED),
    provider: "mock",
  };
}

async function translationTransform(
  text: string,
  opts: TransformTextOptions,
): Promise<TransformTextResult> {
  if (!opts.provider) {
    return {
      available: false,
      reason: "translation requires a configured provider",
      text: null,
      provider: "mock",
    };
  }
  const targetLanguage = opts.targetLanguage ?? "the target language";
  return runProvider(
    opts.provider,
    `Translate the following text to ${targetLanguage}:\n\n${text}`,
    text,
    "translation",
  );
}

export async function transformText(
  kind: TextTransformKind,
  text: string,
  opts: TransformTextOptions = {},
): Promise<TransformTextResult> {
  switch (kind) {
    case "human_edit":
      return humanEditTransform(text, opts);
    case "paraphrase":
      return paraphraseTransform(text, opts);
    case "translation":
      return translationTransform(text, opts);
  }
}
