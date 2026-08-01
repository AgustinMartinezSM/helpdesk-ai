import { InvalidFieldDefinitionError, InvalidFieldValueError } from './errors';
import { parseFieldValidation, validateFieldValue } from './field-validation';
import type {
  FieldDefinition,
  FieldValidationObject,
  ProfileFieldType,
} from './profile-fields';

function definition(
  type: ProfileFieldType,
  validation: FieldValidationObject | null = null,
): FieldDefinition {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    key: 'some_field',
    labelEsAr: 'Campo',
    labelEnUs: 'Field',
    type,
    required: false,
    editableByUser: true,
    visibleToRequester: true,
    visibleToStaff: true,
    displayOrder: 1,
    validation,
    status: 'active',
    createdAt: new Date('2026-07-31T12:00:00.000Z'),
    updatedAt: new Date('2026-07-31T12:00:00.000Z'),
  };
}

describe('parseFieldValidation — closed schema per type', () => {
  it('accepts the full rule set per type and returns the parsed object', () => {
    expect(
      parseFieldValidation('text', {
        minLength: 2,
        maxLength: 5,
        pattern: '^a',
      }),
    ).toEqual({ minLength: 2, maxLength: 5, pattern: '^a' });
    expect(parseFieldValidation('phone', { pattern: '^\\+' })).toEqual({
      pattern: '^\\+',
    });
    expect(
      parseFieldValidation('number', { min: 0, max: 10, integer: true }),
    ).toEqual({ min: 0, max: 10, integer: true });
    expect(parseFieldValidation('select', { options: ['a', 'b'] })).toEqual({
      options: ['a', 'b'],
    });
    expect(parseFieldValidation('boolean', {})).toEqual({});
    expect(parseFieldValidation('date', {})).toEqual({});
  });

  it('returns null when a type that needs no rules gets none', () => {
    expect(parseFieldValidation('text', undefined)).toBeNull();
    expect(parseFieldValidation('boolean', null)).toBeNull();
  });

  it('refuses unknown keys — the schema is closed', () => {
    expect(() => parseFieldValidation('text', { min: 1 })).toThrow(
      InvalidFieldDefinitionError,
    );
    expect(() => parseFieldValidation('number', { options: ['a'] })).toThrow(
      InvalidFieldDefinitionError,
    );
    expect(() => parseFieldValidation('date', { pattern: '^a' })).toThrow(
      InvalidFieldDefinitionError,
    );
  });

  it('refuses a pattern that does not compile', () => {
    expect(() => parseFieldValidation('text', { pattern: '(' })).toThrow(
      InvalidFieldDefinitionError,
    );
  });

  it('refuses out-of-range rule values', () => {
    expect(() => parseFieldValidation('text', { minLength: -1 })).toThrow(
      InvalidFieldDefinitionError,
    );
    expect(() => parseFieldValidation('number', { integer: 'yes' })).toThrow(
      InvalidFieldDefinitionError,
    );
  });

  it('requires options for select — with at least one, all non-empty', () => {
    expect(() => parseFieldValidation('select', undefined)).toThrow(
      InvalidFieldDefinitionError,
    );
    expect(() => parseFieldValidation('select', {})).toThrow(
      InvalidFieldDefinitionError,
    );
    expect(() => parseFieldValidation('select', { options: [] })).toThrow(
      InvalidFieldDefinitionError,
    );
    expect(() => parseFieldValidation('select', { options: [''] })).toThrow(
      InvalidFieldDefinitionError,
    );
  });
});

describe('validateFieldValue — canonical text per type', () => {
  // The matrix the acceptance criteria pin: per type, one canonical text
  // representation, valid and invalid cases through the declarative rules.
  const cases: Array<{
    name: string;
    type: ProfileFieldType;
    validation: FieldValidationObject | null;
    valid: string[];
    invalid: string[];
  }> = [
    {
      name: 'text without rules',
      type: 'text',
      validation: null,
      valid: ['anything at all'],
      invalid: [''],
    },
    {
      name: 'text with length and pattern rules',
      type: 'text',
      validation: { minLength: 3, maxLength: 6, pattern: '^[a-z]+$' },
      valid: ['abc', 'abcdef'],
      invalid: ['ab', 'abcdefg', 'ABC'],
    },
    {
      name: 'phone with a pattern',
      type: 'phone',
      validation: { pattern: '^\\+[0-9 ]+$' },
      valid: ['+54 11 5555 0000'],
      invalid: ['5555-0000'],
    },
    {
      name: 'number as decimal strings',
      type: 'number',
      validation: null,
      valid: ['42', '-3.5', '0'],
      invalid: ['abc', '1e5', '1.', '.5', ''],
    },
    {
      name: 'number with bounds and integer',
      type: 'number',
      validation: { min: 0, max: 10, integer: true },
      valid: ['0', '10', '7'],
      invalid: ['-1', '11', '3.5'],
    },
    {
      name: 'select against its options',
      type: 'select',
      validation: { options: ['G1', 'G2'] },
      valid: ['G1', 'G2'],
      invalid: ['G3', 'g1', ''],
    },
    {
      name: "boolean as 'true'/'false'",
      type: 'boolean',
      validation: null,
      valid: ['true', 'false'],
      invalid: ['TRUE', '1', 'yes', ''],
    },
    {
      name: 'date as a real ISO calendar date',
      type: 'date',
      validation: null,
      valid: ['2026-07-31', '2028-02-29'],
      invalid: ['31/07/2026', '2026-7-31', '2026-02-30', '2026-13-01', ''],
    },
  ];

  it.each(cases)('$name', ({ type, validation, valid, invalid }) => {
    const field = definition(type, validation);
    for (const value of valid) {
      expect(() => validateFieldValue(field, value)).not.toThrow();
    }
    for (const value of invalid) {
      expect(() => validateFieldValue(field, value)).toThrow(
        InvalidFieldValueError,
      );
    }
  });

  it('names the field and the violated rule in the error', () => {
    const field = definition('text', { pattern: '^E-[0-9]{4}$' });
    expect(() => validateFieldValue(field, 'nope')).toThrow(
      /some_field.*pattern/,
    );
  });
});
