/**
 * Canaries: what an instructor scores a suspected AI-assisted submission
 * against.
 *
 * The notice asks the assistant to reply with one specific sentence, so that
 * sentence is the primary signal. Two supporting signals cover the two ways it
 * realistically shows up in a student's pasted output: the reference code
 * (which survives copy-paste verbatim and ties the response back to one issued
 * copy) and an ordered-terms signal over the sentence's distinctive words
 * (which survives light paraphrasing, where an exact match would not).
 *
 * These are match *evidence* only. Nothing here produces a verdict, exactly as
 * `packages/detector` does not — see `docs/ethics-and-privacy.md`.
 */

import { type ExpectedSignal, generateStudentKey } from "@pdf-injection/contracts";

/** Default length of a Raster Guard reference code, matching the student-keyed set default. */
export const DEFAULT_NOTICE_KEY_LENGTH = 8;

/** A fresh reference code, using the same charset and generator as student-keyed sets. */
export function generateNoticeKey(length: number = DEFAULT_NOTICE_KEY_LENGTH): string {
  return generateStudentKey(length);
}

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "before",
  "but",
  "by",
  "do",
  "for",
  "from",
  "have",
  "he",
  "her",
  "his",
  "in",
  "is",
  "it",
  "its",
  "not",
  "of",
  "on",
  "or",
  "please",
  "she",
  "should",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "they",
  "this",
  "to",
  "up",
  "use",
  "using",
  "was",
  "we",
  "were",
  "with",
  "you",
  "your",
]);

/**
 * The distinctive words of a sentence, in order, lower-cased and de-duplicated.
 * Short and common words are dropped so the resulting signal does not fire on
 * ordinary prose.
 *
 * Four is the default rather than five for a reason worth stating: this signal
 * exists to survive paraphrasing, and every extra term the response must
 * reproduce *in order* pushes it back toward being a second copy of the exact
 * phrase. Four distinctive words in sequence is still far too specific to
 * appear in unrelated prose by chance.
 */
export function salientTerms(sentence: string, max = 4): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of sentence.toLowerCase().split(/[^a-z0-9'-]+/)) {
    const word = raw.replace(/^[''-]+|[''-]+$/g, "");
    if (word.length < 4 || STOPWORDS.has(word) || seen.has(word)) continue;
    seen.add(word);
    terms.push(word);
    if (terms.length >= max) break;
  }
  return terms;
}

export interface DeriveSignalsInput {
  /** The sentence the notice asks the assistant to reply with. */
  response: string;
  /** The notice's reference code, when one is set. */
  key?: string;
}

/** Builds the expected-signal set for a notice. */
export function deriveNoticeSignals(input: DeriveSignalsInput): ExpectedSignal[] {
  const signals: ExpectedSignal[] = [];
  const response = input.response.trim();

  if (response.length > 0) {
    signals.push({ type: "exact_phrase", value: response, caseSensitive: false });

    const terms = salientTerms(response);
    if (terms.length >= 2) signals.push({ type: "ordered_terms", values: terms });
  }

  const key = input.key?.trim();
  if (key) signals.push({ type: "exact_phrase", value: key, caseSensitive: true });

  return signals;
}
