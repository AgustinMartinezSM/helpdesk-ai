import { z } from '@helpdesk-ai/configuration';
import { InvalidFieldDefinitionError, InvalidFieldValueError } from './errors';
import type {
  FieldDefinition,
  FieldValidationObject,
  ProfileFieldType,
} from './profile-fields';

/**
 * The declarative validation model (D3). Two moments, two checks:
 *
 * 1. Definition-write time: the admin-supplied `validation` object is parsed
 *    against a CLOSED zod schema per type — unknown keys are refused, so the
 *    object can never smuggle anything the value validator would not read.
 * 2. Value-write time: `buildValueSchema` turns (type, validation) into a
 *    zod validator for the value's canonical text representation.
 *
 * Nothing here ever evaluates stored code: `validation` is data with a
 * closed shape, and the only executable thing derived from it is a RegExp
 * compiled from the `pattern` string — compiled, tested for validity at
 * definition-write time, and applied via `.test()`, never eval'd.
 *
 * Canonical text representation per type (one per type, by design — a value
 * row is TEXT and consumers must not guess):
 * - text / phone: the string itself, non-empty.
 * - number: a decimal string (`-?digits[.digits]`), e.g. "42", "-3.5".
 * - select: exactly one of the definition's options.
 * - boolean: the strings 'true' or 'false'.
 * - date: an ISO calendar date, 'YYYY-MM-DD'.
 */

const DECIMAL_STRING = /^-?\d+(\.\d+)?$/;

function compiles(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

/** text and phone share rules: both are free text with shape constraints. */
const textValidationSchema = z
  .strictObject({
    minLength: z.number().int().min(0).optional(),
    maxLength: z.number().int().min(1).optional(),
    pattern: z.string().min(1).optional(),
  })
  .refine((rules) => rules.pattern === undefined || compiles(rules.pattern), {
    message: 'pattern must be a valid regular expression',
  });

const numberValidationSchema = z.strictObject({
  min: z.number().optional(),
  max: z.number().optional(),
  integer: z.boolean().optional(),
});

const selectValidationSchema = z.strictObject({
  options: z.array(z.string().min(1)).min(1),
});

/** boolean and date admit no tuning: the type IS the whole constraint. */
const emptyValidationSchema = z.strictObject({});

const DEFINITION_VALIDATION_SCHEMAS: Record<ProfileFieldType, z.ZodType> = {
  text: textValidationSchema,
  phone: textValidationSchema,
  number: numberValidationSchema,
  select: selectValidationSchema,
  boolean: emptyValidationSchema,
  date: emptyValidationSchema,
};

interface TextRules {
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

interface NumberRules {
  min?: number;
  max?: number;
  integer?: boolean;
}

interface SelectRules {
  options: string[];
}

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  const path = issue.path.join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

/**
 * Validates an admin-supplied validation object against the closed schema
 * for the field's type. Returns the parsed object (or null when the type
 * needs none and none was given); throws InvalidFieldDefinitionError with
 * the offending detail otherwise.
 */
export function parseFieldValidation(
  type: ProfileFieldType,
  raw: unknown,
): FieldValidationObject | null {
  if (raw === undefined || raw === null) {
    // select is the one type whose validation is not optional: a select
    // without options is a question with no answers.
    if (type === 'select') {
      throw new InvalidFieldDefinitionError(
        'a select field requires validation.options',
      );
    }
    return null;
  }
  const parsed = DEFINITION_VALIDATION_SCHEMAS[type].safeParse(raw);
  if (!parsed.success) {
    throw new InvalidFieldDefinitionError(
      `validation for type "${type}": ${firstIssue(parsed.error)}`,
    );
  }
  return parsed.data as FieldValidationObject;
}

/**
 * Builds the value validator from a definition's (type, validation). The
 * validation object reaching here already passed the closed per-type schema
 * at definition-write time, so the casts below narrow to shapes this module
 * itself guaranteed.
 */
export function buildValueSchema(
  type: ProfileFieldType,
  validation: FieldValidationObject | null,
): z.ZodType<string> {
  switch (type) {
    case 'text':
    case 'phone': {
      const rules = (validation ?? {}) as TextRules;
      let schema = z.string().min(1, 'must not be empty');
      if (rules.minLength !== undefined) {
        schema = schema.min(
          rules.minLength,
          `must be at least ${rules.minLength} characters`,
        );
      }
      if (rules.maxLength !== undefined) {
        schema = schema.max(
          rules.maxLength,
          `must be at most ${rules.maxLength} characters`,
        );
      }
      if (rules.pattern !== undefined) {
        schema = schema.regex(
          new RegExp(rules.pattern),
          `must match the pattern ${rules.pattern}`,
        );
      }
      return schema;
    }
    case 'number': {
      const rules = (validation ?? {}) as NumberRules;
      return z
        .string()
        .regex(DECIMAL_STRING, 'must be a decimal number string')
        .superRefine((value, ctx) => {
          const parsed = Number(value);
          if (rules.integer === true && !Number.isInteger(parsed)) {
            ctx.addIssue({ code: 'custom', message: 'must be an integer' });
          }
          if (rules.min !== undefined && parsed < rules.min) {
            ctx.addIssue({
              code: 'custom',
              message: `must be at least ${rules.min}`,
            });
          }
          if (rules.max !== undefined && parsed > rules.max) {
            ctx.addIssue({
              code: 'custom',
              message: `must be at most ${rules.max}`,
            });
          }
        });
    }
    case 'select': {
      const rules = validation as unknown as SelectRules;
      return z.string().refine((value) => rules.options.includes(value), {
        message: `must be one of: ${rules.options.join(', ')}`,
      });
    }
    case 'boolean':
      return z
        .string()
        .refine((value) => value === 'true' || value === 'false', {
          message: "must be 'true' or 'false'",
        });
    case 'date':
      return z.iso
        .date('must be an ISO date (YYYY-MM-DD)')
        .refine((value) => !Number.isNaN(new Date(value).getTime()), {
          message: 'must be a real calendar date',
        });
  }
}

/**
 * Validates a canonical value string against a definition; throws
 * InvalidFieldValueError naming the field and the first violated rule.
 */
export function validateFieldValue(
  definition: FieldDefinition,
  value: string,
): void {
  const result = buildValueSchema(
    definition.type,
    definition.validation,
  ).safeParse(value);
  if (!result.success) {
    throw new InvalidFieldValueError(definition.key, firstIssue(result.error));
  }
}
