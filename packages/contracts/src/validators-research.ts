import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type {
  DistributionRequest,
  ModelTestProviderSpec,
  ModelTestRequest,
  RobustnessRequest,
  VariantSpec,
} from "./types-research";
import { ExpectedSignalArraySchema } from "./validators";

// ---------------------------------------------------------------------------
// §1 Variant sets / student-keyed sets
// ---------------------------------------------------------------------------

export const VariantSpecSchema = Type.Object({
  label: Type.String({ minLength: 1 }),
  instruction: Type.String({ minLength: 1 }),
  expectedSignals: ExpectedSignalArraySchema,
});

/** 2..LIMITS.maxVariants items; caller (apps/api) also enforces unique labels. */
export const VariantSpecArraySchema = Type.Array(VariantSpecSchema, { minItems: 2 });

type _AssertVariantSpec = Static<typeof VariantSpecSchema> extends VariantSpec ? true : never;

export function isVariantSpecArray(value: unknown): value is VariantSpec[] {
  return Value.Check(VariantSpecArraySchema, value);
}

/**
 * Parses the `variants` multipart JSON field into VariantSpec[]. Throws a
 * plain Error on malformed JSON, a schema mismatch, or duplicate labels —
 * callers map this to VALIDATION_ERROR / TOO_MANY_VARIANTS.
 */
export function parseVariantSpecs(json: string, maxVariants: number): VariantSpec[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("variants is not valid JSON");
  }
  if (!isVariantSpecArray(parsed)) {
    throw new Error("variants does not match VariantSpec[] schema (min 2 items)");
  }
  if (parsed.length > maxVariants) {
    throw new Error(`variants has ${parsed.length} items, limit is ${maxVariants}`);
  }
  const labels = new Set<string>();
  for (const variant of parsed) {
    if (labels.has(variant.label)) {
      throw new Error(`duplicate variant label: ${variant.label}`);
    }
    labels.add(variant.label);
  }
  return parsed;
}

export const DistributionRequestSchema = Type.Object({
  studentIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  strategy: Type.Union([Type.Literal("round_robin"), Type.Literal("seeded_hash")]),
  seed: Type.Optional(Type.String()),
});

type _AssertDistributionRequest =
  Static<typeof DistributionRequestSchema> extends DistributionRequest ? true : never;

export function isDistributionRequest(value: unknown): value is DistributionRequest {
  return Value.Check(DistributionRequestSchema, value);
}

export const StudentIdArraySchema = Type.Array(Type.String({ minLength: 1 }), { minItems: 1 });

export function isStringArray(value: unknown): value is string[] {
  return Value.Check(StudentIdArraySchema, value);
}

/**
 * Parses the `studentIds` multipart JSON field into string[], enforcing
 * `1..maxStudentKeys` items. Throws a plain Error on malformed JSON, a
 * schema mismatch, or duplicate ids.
 */
export function parseStudentIds(json: string, maxStudentKeys: number): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("studentIds is not valid JSON");
  }
  if (!isStringArray(parsed)) {
    throw new Error("studentIds does not match string[] schema (min 1 item)");
  }
  if (parsed.length > maxStudentKeys) {
    throw new Error(`studentIds has ${parsed.length} items, limit is ${maxStudentKeys}`);
  }
  if (new Set(parsed).size !== parsed.length) {
    throw new Error("studentIds contains duplicate entries");
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// §2 Model tests
// ---------------------------------------------------------------------------

export const ProviderNameSchema = Type.Union([
  Type.Literal("anthropic"),
  Type.Literal("openai"),
  Type.Literal("mock"),
  Type.Literal("ollama"),
]);

export const ModelTestProviderSpecSchema = Type.Object({
  name: ProviderNameSchema,
  model: Type.Optional(Type.String()),
});

type _AssertModelTestProviderSpec =
  Static<typeof ModelTestProviderSpecSchema> extends ModelTestProviderSpec ? true : never;

export const BenchmarkConditionSchema = Type.Union([
  Type.Literal("original"),
  Type.Literal("white_text"),
  Type.Literal("render_mode_3"),
  Type.Literal("visible_positive_control"),
  Type.Literal("xmp_only"),
  Type.Literal("unicode_tags"),
  Type.Literal("image_only"),
  Type.Literal("freetext_annot"),
  Type.Literal("acroform_field"),
  Type.Literal("info_dict"),
]);

export const ModelTestRequestSchema = Type.Object({
  providers: Type.Array(ModelTestProviderSpecSchema, { minItems: 1 }),
  conditions: Type.Union([
    Type.Array(BenchmarkConditionSchema, { minItems: 1 }),
    Type.Literal("all"),
  ]),
  repeats: Type.Integer({ minimum: 1 }),
  outerPrompt: Type.Optional(Type.String()),
  acknowledgeExternalTransfer: Type.Boolean(),
});

type _AssertModelTestRequest =
  Static<typeof ModelTestRequestSchema> extends ModelTestRequest ? true : never;

export function isModelTestRequest(value: unknown): value is ModelTestRequest {
  return Value.Check(ModelTestRequestSchema, value);
}

// ---------------------------------------------------------------------------
// §3 Submissions
// ---------------------------------------------------------------------------

export const SubmissionLabelSchema = Type.Union([
  Type.Literal("candidate"),
  Type.Literal("baseline"),
]);

export const SubmissionFieldsSchema = Type.Object({
  label: SubmissionLabelSchema,
  acknowledgeNoRealStudentData: Type.Literal(true),
  text: Type.Optional(Type.String()),
});

export function isSubmissionFields(value: unknown): value is Static<typeof SubmissionFieldsSchema> {
  return Value.Check(SubmissionFieldsSchema, value);
}

// ---------------------------------------------------------------------------
// §4 Robustness
// ---------------------------------------------------------------------------

export const PdfTransformSchema = Type.Union([
  Type.Literal("print_to_pdf"),
  Type.Literal("ocr_regeneration"),
  Type.Literal("screenshot_ocr"),
]);

export const TextTransformSchema = Type.Union([
  Type.Literal("paraphrase"),
  Type.Literal("translation"),
  Type.Literal("human_edit"),
]);

export const TextSourceSpecSchema = Type.Union([
  Type.Object({ kind: Type.Literal("model_test_run"), runId: Type.String({ minLength: 1 }) }),
  Type.Object({ kind: Type.Literal("custom"), texts: Type.Array(Type.String(), { minItems: 1 }) }),
]);

export const RobustnessRequestSchema = Type.Object({
  pdfTransforms: Type.Array(PdfTransformSchema),
  textTransforms: Type.Array(TextTransformSchema),
  textSource: TextSourceSpecSchema,
  providers: Type.Array(ModelTestProviderSpecSchema),
  repeats: Type.Integer({ minimum: 1 }),
  seed: Type.Optional(Type.String()),
  acknowledgeExternalTransfer: Type.Boolean(),
});

type _AssertRobustnessRequest =
  Static<typeof RobustnessRequestSchema> extends RobustnessRequest ? true : never;

export function isRobustnessRequest(value: unknown): value is RobustnessRequest {
  return Value.Check(RobustnessRequestSchema, value);
}
