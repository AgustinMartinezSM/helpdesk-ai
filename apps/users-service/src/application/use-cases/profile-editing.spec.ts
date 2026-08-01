import { PERMISSIONS, type Actor } from '@helpdesk-ai/security';
import {
  FieldNotFoundError,
  ForbiddenProfileActionError,
  ImmutableFieldKeyError,
  InvalidFieldValueError,
  ProfileNotFoundError,
  RequiredFieldValueError,
} from '../../domain/errors';
import type { ProfileUpdatedEvent } from '../ports/profile-event.publisher';
import {
  FixedClock,
  InMemoryFieldDefinitionRepository,
  InMemoryFieldValueRepository,
  InMemoryMembershipProjectionRepository,
  InMemoryUserProfileRepository,
  SequenceIdGenerator,
} from '../testing/fakes';
import {
  CreateFieldDefinitionUseCase,
  UpdateFieldDefinitionUseCase,
} from './manage-field-definitions';
import { RegisterUserProfileUseCase } from './register-user-profile';
import {
  SetMemberFieldValueUseCase,
  SetMyFieldValueUseCase,
} from './set-field-value';
import { UpdateMyPersonProfileUseCase } from './update-person-profile';

const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SUBJECT_ID = '11111111-1111-4111-8111-111111111111';
const OUTSIDER_ID = '99999999-9999-4999-8999-999999999999';

const ADMIN: Actor = {
  id: '22222222-2222-4222-8222-222222222222',
  organizationId: ORG_A,
  permissions: new Set([
    PERMISSIONS.ORGANIZATION_UPDATE,
    PERMISSIONS.PEOPLE_UPDATE,
  ]),
};
const SUBJECT: Actor = {
  id: SUBJECT_ID,
  organizationId: ORG_A,
  permissions: new Set([PERMISSIONS.ORGANIZATION_READ]),
};

class CapturingProfileEventPublisher {
  readonly events: ProfileUpdatedEvent[] = [];

  async profileUpdated(event: ProfileUpdatedEvent): Promise<void> {
    this.events.push(event);
  }
}

function buildContext() {
  const memberships = new InMemoryMembershipProjectionRepository();
  const profiles = new InMemoryUserProfileRepository(memberships);
  const definitions = new InMemoryFieldDefinitionRepository();
  const values = new InMemoryFieldValueRepository();
  const clock = new FixedClock(new Date('2026-07-31T12:00:00.000Z'));
  const events = new CapturingProfileEventPublisher();
  return {
    memberships,
    profiles,
    definitions,
    values,
    clock,
    events,
    register: new RegisterUserProfileUseCase(profiles, clock),
    createField: new CreateFieldDefinitionUseCase(
      definitions,
      clock,
      new SequenceIdGenerator(),
    ),
    updateField: new UpdateFieldDefinitionUseCase(definitions, clock),
    setMine: new SetMyFieldValueUseCase(definitions, values, clock, events),
    setMember: new SetMemberFieldValueUseCase(
      profiles,
      definitions,
      values,
      clock,
      events,
    ),
    updateMe: new UpdateMyPersonProfileUseCase(profiles, clock, events),
  };
}

async function join(
  ctx: ReturnType<typeof buildContext>,
  organizationId: string,
  userId: string,
  email: string,
) {
  await ctx.register.execute({
    userId,
    email,
    registeredAt: new Date('2026-07-31T11:00:00.000Z'),
  });
  await ctx.memberships.applyCreated({
    organizationId,
    userId,
    roleTemplate: 'requester',
    status: 'active',
    occurredAt: new Date('2026-07-31T11:00:01.000Z'),
  });
}

describe('field definition management', () => {
  it('requires organization.update and refuses key or type changes as conflicts', async () => {
    const ctx = buildContext();

    await expect(
      ctx.createField.execute(SUBJECT, {
        key: 'employee_number',
        labelEsAr: 'Legajo',
        labelEnUs: 'Employee number',
        type: 'text',
        displayOrder: 1,
      }),
    ).rejects.toBeInstanceOf(ForbiddenProfileActionError);

    const created = await ctx.createField.execute(ADMIN, {
      key: 'employee_number',
      labelEsAr: 'Legajo',
      labelEnUs: 'Employee number',
      type: 'text',
      required: true,
      displayOrder: 1,
      validation: { pattern: '^[0-9]{4}$' },
    });

    // Renaming the key or retyping the field is a conflict with the row's
    // immutable identity, not a malformed request.
    await expect(
      ctx.updateField.execute(ADMIN, created.id, { key: 'legajo' }),
    ).rejects.toBeInstanceOf(ImmutableFieldKeyError);
    await expect(
      ctx.updateField.execute(ADMIN, created.id, { type: 'number' }),
    ).rejects.toBeInstanceOf(ImmutableFieldKeyError);
  });

  it('archives without losing stored values, and archived fields refuse writes', async () => {
    const ctx = buildContext();
    await join(ctx, ORG_A, SUBJECT_ID, 'ada@example.com');
    const created = await ctx.createField.execute(ADMIN, {
      key: 'employee_number',
      labelEsAr: 'Legajo',
      labelEnUs: 'Employee number',
      type: 'text',
      displayOrder: 1,
    });
    await ctx.setMember.execute(ADMIN, SUBJECT_ID, 'employee_number', '1847');

    await ctx.updateField.execute(ADMIN, created.id, { status: 'archived' });

    await expect(
      ctx.setMember.execute(ADMIN, SUBJECT_ID, 'employee_number', '2000'),
    ).rejects.toBeInstanceOf(FieldNotFoundError);
    // Safe value migration: the row survives the archive untouched.
    expect(await ctx.values.find(created.id, SUBJECT_ID)).toMatchObject({
      value: '1847',
    });
  });
});

describe('setting values', () => {
  it('walks the retail acceptance path: required, pattern, refusal to clear', async () => {
    const ctx = buildContext();
    await join(ctx, ORG_A, SUBJECT_ID, 'ada@example.com');
    await ctx.createField.execute(ADMIN, {
      key: 'employee_number',
      labelEsAr: 'Legajo',
      labelEnUs: 'Employee number',
      type: 'text',
      required: true,
      displayOrder: 1,
      validation: { pattern: '^[0-9]{4}$' },
    });

    await expect(
      ctx.setMember.execute(ADMIN, SUBJECT_ID, 'employee_number', 'ABC'),
    ).rejects.toBeInstanceOf(InvalidFieldValueError);

    await ctx.setMember.execute(ADMIN, SUBJECT_ID, 'employee_number', '1847');
    expect(ctx.events.events.at(-1)).toMatchObject({
      userId: SUBJECT_ID,
      changedKeys: ['employee_number'],
      organizationId: ORG_A,
    });

    await expect(
      ctx.setMember.execute(ADMIN, SUBJECT_ID, 'employee_number', null),
    ).rejects.toBeInstanceOf(RequiredFieldValueError);
  });

  it('refuses the subject on non-editable fields, hiding staff-only ones entirely', async () => {
    const ctx = buildContext();
    await join(ctx, ORG_A, SUBJECT_ID, 'ada@example.com');
    await ctx.createField.execute(ADMIN, {
      key: 'job_title',
      labelEsAr: 'Puesto',
      labelEnUs: 'Job title',
      type: 'text',
      editableByUser: false,
      visibleToRequester: true,
      displayOrder: 1,
    });
    await ctx.createField.execute(ADMIN, {
      key: 'hr_notes',
      labelEsAr: 'Notas internas',
      labelEnUs: 'Internal notes',
      type: 'text',
      editableByUser: false,
      visibleToRequester: false,
      displayOrder: 2,
    });

    // Visible but not editable: a plain refusal.
    await expect(
      ctx.setMine.execute(SUBJECT, 'job_title', 'CEO'),
    ).rejects.toBeInstanceOf(ForbiddenProfileActionError);
    // Staff-only: a 403 would confirm the key exists — the D4 leak.
    await expect(
      ctx.setMine.execute(SUBJECT, 'hr_notes', 'self-promotion'),
    ).rejects.toBeInstanceOf(FieldNotFoundError);
  });

  it('answers a foreign member and a foreign field with the same not-found', async () => {
    const ctx = buildContext();
    await join(ctx, ORG_B, OUTSIDER_ID, 'rival@example.com');
    await ctx.createField.execute(ADMIN, {
      key: 'employee_number',
      labelEsAr: 'Legajo',
      labelEnUs: 'Employee number',
      type: 'text',
      displayOrder: 1,
    });

    // The target belongs to org B; the admin acts in org A.
    await expect(
      ctx.setMember.execute(ADMIN, OUTSIDER_ID, 'employee_number', '1847'),
    ).rejects.toBeInstanceOf(ProfileNotFoundError);
  });

  it('publishes no event when nothing changed', async () => {
    const ctx = buildContext();
    await join(ctx, ORG_A, SUBJECT_ID, 'ada@example.com');
    await ctx.createField.execute(ADMIN, {
      key: 'employee_number',
      labelEsAr: 'Legajo',
      labelEnUs: 'Employee number',
      type: 'text',
      displayOrder: 1,
    });

    await ctx.setMember.execute(ADMIN, SUBJECT_ID, 'employee_number', '1847');
    const announced = ctx.events.events.length;
    await ctx.setMember.execute(ADMIN, SUBJECT_ID, 'employee_number', '1847');
    expect(ctx.events.events).toHaveLength(announced);
  });
});

describe('person-level self edit', () => {
  it('patches only the named columns and announces only the changed keys', async () => {
    const ctx = buildContext();
    await join(ctx, ORG_A, SUBJECT_ID, 'ada@example.com');

    const updated = await ctx.updateMe.execute(SUBJECT, {
      preferredName: 'Ada',
      phone: '+54 11 5555-5555',
    });

    expect(updated.preferredName).toBe('Ada');
    expect(updated.phone).toBe('+54 11 5555-5555');
    expect(updated.email).toBe('ada@example.com');
    expect(ctx.events.events.at(-1)?.changedKeys).toEqual(
      expect.arrayContaining(['preferredName', 'phone']),
    );
    // Values never ride the event — only the keys that moved.
    expect(JSON.stringify(ctx.events.events.at(-1))).not.toContain('5555');
  });

  it('works for the belongs-nowhere state: person data needs no tenant', async () => {
    const ctx = buildContext();
    await ctx.register.execute({
      userId: SUBJECT_ID,
      email: 'ada@example.com',
      registeredAt: new Date('2026-07-31T11:00:00.000Z'),
    });

    const tenantless: Actor = { id: SUBJECT_ID, permissions: new Set() };
    const updated = await ctx.updateMe.execute(tenantless, {
      preferredName: 'Ada',
    });
    expect(updated.preferredName).toBe('Ada');
  });
});
