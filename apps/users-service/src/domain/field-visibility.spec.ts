import { canViewField, type FieldViewer } from './field-visibility';
import type { FieldDefinition } from './profile-fields';

const BASE_DEFINITION: FieldDefinition = {
  id: '00000000-0000-4000-8000-000000000001',
  organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  key: 'employee_number',
  labelEsAr: 'Número de legajo',
  labelEnUs: 'Employee number',
  type: 'text',
  required: false,
  editableByUser: false,
  visibleToRequester: true,
  visibleToStaff: true,
  displayOrder: 1,
  validation: null,
  status: 'active',
  createdAt: new Date('2026-07-31T12:00:00.000Z'),
  updatedAt: new Date('2026-07-31T12:00:00.000Z'),
};

function definition(overrides: Partial<FieldDefinition>): FieldDefinition {
  return { ...BASE_DEFINITION, ...overrides };
}

function viewer(overrides: Partial<FieldViewer>): FieldViewer {
  return {
    isSubject: false,
    canReadStaff: false,
    canEditOthers: false,
    ...overrides,
  };
}

describe('canViewField — the one view filter (D4)', () => {
  it('hides a staff-only field from the subject — the point of the flag', () => {
    const staffOnly = definition({
      visibleToRequester: false,
      visibleToStaff: true,
    });
    expect(canViewField(viewer({ isSubject: true }), staffOnly)).toBe(false);
    expect(canViewField(viewer({ canReadStaff: true }), staffOnly)).toBe(true);
  });

  it('shows the subject an editable field even when requesters cannot see it', () => {
    // An editable-but-hidden field would be a write-only input.
    const editableHidden = definition({
      visibleToRequester: false,
      editableByUser: true,
    });
    expect(canViewField(viewer({ isSubject: true }), editableHidden)).toBe(
      true,
    );
  });

  it('shows people.update every active field — editing blind is worse', () => {
    const invisible = definition({
      visibleToRequester: false,
      visibleToStaff: false,
    });
    expect(canViewField(viewer({ canEditOthers: true }), invisible)).toBe(true);
    expect(canViewField(viewer({ canReadStaff: true }), invisible)).toBe(false);
  });

  it('hides a requester-only field from a plain people.read viewer', () => {
    const requesterOnly = definition({ visibleToStaff: false });
    expect(canViewField(viewer({ canReadStaff: true }), requesterOnly)).toBe(
      false,
    );
    expect(canViewField(viewer({ isSubject: true }), requesterOnly)).toBe(true);
  });

  it('hides archived fields from everyone, people.update included', () => {
    const archived = definition({ status: 'archived' });
    expect(canViewField(viewer({ canEditOthers: true }), archived)).toBe(false);
    expect(canViewField(viewer({ isSubject: true }), archived)).toBe(false);
    expect(canViewField(viewer({ canReadStaff: true }), archived)).toBe(false);
  });

  it('denies a viewer with no relationship to the profile at all', () => {
    expect(canViewField(viewer({}), definition({}))).toBe(false);
  });

  // Every cell of the matrix, against the D4 truth table spelled out
  // independently of the implementation: archived hides always; otherwise
  // people.update sees all, the subject sees requester-visible or
  // self-editable, and people.read sees staff-visible.
  it('matches the D4 truth table on all 128 cells', () => {
    const bools = [false, true];
    for (const isSubject of bools)
      for (const canReadStaff of bools)
        for (const canEditOthers of bools)
          for (const visibleToRequester of bools)
            for (const visibleToStaff of bools)
              for (const editableByUser of bools)
                for (const status of ['active', 'archived'] as const) {
                  const expected =
                    status === 'active' &&
                    (canEditOthers ||
                      (isSubject && (visibleToRequester || editableByUser)) ||
                      (canReadStaff && visibleToStaff));
                  expect(
                    canViewField(
                      viewer({ isSubject, canReadStaff, canEditOthers }),
                      definition({
                        visibleToRequester,
                        visibleToStaff,
                        editableByUser,
                        status,
                      }),
                    ),
                  ).toBe(expected);
                }
  });
});
