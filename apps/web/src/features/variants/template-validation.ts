export const KEY_PLACEHOLDER = "{{KEY}}";
export const MIN_KEY_LENGTH = 6;
export const MAX_KEY_LENGTH = 16;

export interface TemplateValidationResult {
  valid: boolean;
  hasKeyPlaceholder: boolean;
  errors: string[];
}

/**
 * Validates a student-keyed instruction template per phase3-5 contract §1:
 * `instructionTemplate` must contain the literal `{{KEY}}` placeholder.
 */
export function validateInstructionTemplate(template: string): TemplateValidationResult {
  const errors: string[] = [];
  const hasKeyPlaceholder = template.includes(KEY_PLACEHOLDER);

  if (template.trim().length === 0) {
    errors.push("Instruction template is required.");
  }
  if (!hasKeyPlaceholder) {
    errors.push(`Instruction template must contain the ${KEY_PLACEHOLDER} placeholder.`);
  }

  return { valid: errors.length === 0, hasKeyPlaceholder, errors };
}

/** `keyLength` must be an integer in [6, 16] (contract §1, default 8, charset A-Z2-9). */
export function validateKeyLength(keyLength: number): string | null {
  if (!Number.isInteger(keyLength) || keyLength < MIN_KEY_LENGTH || keyLength > MAX_KEY_LENGTH) {
    return `Key length must be a whole number between ${MIN_KEY_LENGTH} and ${MAX_KEY_LENGTH}.`;
  }
  return null;
}
