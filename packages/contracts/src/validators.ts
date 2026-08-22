import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { ExpectedSignal } from "./types";

// Elysia uses TypeBox internally, so reusing it here keeps this package
// framework-agnostic while remaining a natural fit for apps/api schemas.

const ExactPhraseSignal = Type.Object({
  type: Type.Literal("exact_phrase"),
  value: Type.String({ minLength: 1 }),
  caseSensitive: Type.Boolean(),
});

const RegexSignal = Type.Object({
  type: Type.Literal("regex"),
  pattern: Type.String({ minLength: 1 }),
  flags: Type.String(),
});

const MethodologyLabelSignal = Type.Object({
  type: Type.Literal("methodology_label"),
  value: Type.String({ minLength: 1 }),
  aliases: Type.Array(Type.String()),
});

const OrderedTermsSignal = Type.Object({
  type: Type.Literal("ordered_terms"),
  values: Type.Array(Type.String()),
});

const SectionOrderSignal = Type.Object({
  type: Type.Literal("section_order"),
  values: Type.Array(Type.String()),
});

export const ExpectedSignalSchema = Type.Union([
  ExactPhraseSignal,
  RegexSignal,
  MethodologyLabelSignal,
  OrderedTermsSignal,
  SectionOrderSignal,
]);

export const ExpectedSignalArraySchema = Type.Array(ExpectedSignalSchema, { minItems: 1 });

type _AssertMatchesExpectedSignal =
  Static<typeof ExpectedSignalSchema> extends ExpectedSignal ? true : never;

export function isExpectedSignal(value: unknown): value is ExpectedSignal {
  return Value.Check(ExpectedSignalSchema, value);
}

export function isExpectedSignalArray(value: unknown): value is ExpectedSignal[] {
  return Value.Check(ExpectedSignalArraySchema, value);
}

/**
 * Parses a JSON string (as submitted in the `expectedSignals` multipart
 * field) into ExpectedSignal[]. Throws a plain Error on malformed JSON or a
 * schema mismatch; callers map this to PROMPT_LINT_ERROR / VALIDATION_ERROR.
 */
export function parseExpectedSignals(json: string): ExpectedSignal[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("expectedSignals is not valid JSON");
  }
  if (!isExpectedSignalArray(parsed)) {
    throw new Error("expectedSignals does not match ExpectedSignal[] schema (min 1 item)");
  }
  return parsed;
}
