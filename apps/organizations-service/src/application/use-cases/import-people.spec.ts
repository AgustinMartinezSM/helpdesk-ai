import { PERMISSIONS, type Actor } from '@helpdesk-ai/security';
import type { Branch, Department } from '../../domain/branch';
import {
  ForbiddenInvitationActionError,
  MembershipNotFoundError,
} from '../../domain/errors';
import type { Membership, RoleTemplate } from '../../domain/membership';
import { permissionsForTemplate } from '../../domain/permissions';
import {
  FakeOrganizationEventPublisher,
  FixedClock,
  InMemoryBranchRepository,
  InMemoryDepartmentRepository,
  InMemoryInvitationRepository,
  InMemoryMembershipRepository,
  SequentialIdGenerator,
} from '../testing/fakes';
import {
  ImportFileRejectedError,
  ImportPeopleUseCase,
  type ImportRowResult,
} from './import-people';

const ORG = '00000000-0000-4000-8000-000000000001';
const OTHER_ORG = '00000000-0000-4000-8000-0000000000ff';
const ADMIN = '22222222-2222-4222-8222-222222222222';

const STORE_12 = '00000000-0000-4000-8000-0000000000b1';
const STORE_9 = '00000000-0000-4000-8000-0000000000b2';
const FOREIGN_BRANCH = '00000000-0000-4000-8000-0000000000b9';
const ELECTRONICS = '00000000-0000-4000-8000-0000000000d1';
const CHECKOUT_AT_STORE_9 = '00000000-0000-4000-8000-0000000000d2';

const AT = new Date('2026-08-03T12:00:00.000Z');

function actorOf(
  template: RoleTemplate,
  organizationId = ORG,
  overrides: readonly string[] = [],
): Actor {
  return {
    id: ADMIN,
    organizationId,
    permissions: new Set([...permissionsForTemplate(template), ...overrides]),
  };
}

function membershipOf(
  template: RoleTemplate,
  status: Membership['status'] = 'active',
  organizationId = ORG,
): Membership {
  return {
    id: 'm-admin',
    organizationId,
    userId: ADMIN,
    roleTemplate: template,
    status,
    version: 1,
    createdAt: AT,
    updatedAt: AT,
  };
}

function branch(overrides: Partial<Branch> = {}): Branch {
  return {
    id: STORE_12,
    organizationId: ORG,
    code: 'store-12',
    name: 'Store 12',
    status: 'active',
    timezone: null,
    address: null,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

function department(overrides: Partial<Department> = {}): Department {
  return {
    id: ELECTRONICS,
    organizationId: ORG,
    branchId: STORE_12,
    name: 'Electronics',
    status: 'active',
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

function buildContext(
  importer: Membership = membershipOf('organization_admin'),
) {
  const invitations = new InMemoryInvitationRepository();
  const memberships = new InMemoryMembershipRepository();
  const branches = new InMemoryBranchRepository();
  const departments = new InMemoryDepartmentRepository();
  const events = new FakeOrganizationEventPublisher();

  memberships.memberships.push(importer);
  branches.branches.push(
    branch(),
    branch({ id: STORE_9, code: 'store-9', name: 'Store 9' }),
    // Another tenant's branch, with a name an importer might well type.
    branch({
      id: FOREIGN_BRANCH,
      organizationId: OTHER_ORG,
      code: 'rival-1',
      name: 'Rival Store',
    }),
  );
  departments.departments.push(
    department(),
    department({
      id: CHECKOUT_AT_STORE_9,
      branchId: STORE_9,
      name: 'Checkout',
    }),
  );

  return {
    invitations,
    memberships,
    branches,
    departments,
    events,
    useCase: new ImportPeopleUseCase(
      invitations,
      memberships,
      branches,
      departments,
      new FixedClock(AT),
      new SequentialIdGenerator(),
      events,
    ),
  };
}

function outcomeOf(rows: ImportRowResult[], line: number) {
  const row = rows.find((entry) => entry.line === line);
  if (!row) {
    throw new Error(`no result for line ${line}`);
  }
  return row.outcome;
}

/** Reason code of a failed row, or the status when it did not fail. */
function reasonOf(rows: ImportRowResult[], line: number): string {
  const outcome = outcomeOf(rows, line);
  return outcome.status === 'failed' ? outcome.reason.code : outcome.status;
}

describe('ImportPeopleUseCase — who may run it', () => {
  it('refuses somebody without people.import', async () => {
    const ctx = buildContext();

    // An organization_admin holds it; a service desk manager does not, even
    // though they can administer support teams.
    await expect(
      ctx.useCase.execute(actorOf('service_desk_manager'), {
        csv: 'email\nada@x.com\n',
        dryRun: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenInvitationActionError);
  });

  it('refuses a suspended importer whose token still says admin', async () => {
    // The row wins over the token, as it does everywhere else an
    // administration decision is made (ADR 0021).
    const ctx = buildContext(membershipOf('organization_admin', 'suspended'));

    await expect(
      ctx.useCase.execute(actorOf('organization_admin'), {
        csv: 'email\nada@x.com\n',
        dryRun: true,
      }),
    ).rejects.toBeInstanceOf(MembershipNotFoundError);
  });

  it('refuses a token with no organization', async () => {
    const ctx = buildContext();
    const floating: Actor = {
      id: ADMIN,
      permissions: new Set(permissionsForTemplate('organization_admin')),
    };

    await expect(
      ctx.useCase.execute(floating, { csv: 'email\na@x.com\n', dryRun: true }),
    ).rejects.toThrow();
  });
});

describe('ImportPeopleUseCase — the file as a whole', () => {
  it('refuses a file with an unknown column before considering a row', async () => {
    const ctx = buildContext();

    await expect(
      ctx.useCase.execute(actorOf('organization_admin'), {
        csv: 'email,rol\nada@x.com,agent\n',
        dryRun: true,
      }),
    ).rejects.toBeInstanceOf(ImportFileRejectedError);
    expect(ctx.invitations.invitations).toHaveLength(0);
  });
});

describe('ImportPeopleUseCase — preview writes nothing (criterion 2)', () => {
  it('reports what it would do and leaves the database alone', async () => {
    const ctx = buildContext();

    const result = await ctx.useCase.execute(actorOf('organization_admin'), {
      csv: 'email,role\nada@x.com,agent\nalan@x.com,requester\n',
      dryRun: true,
    });

    expect(result.summary).toEqual({
      dryRun: true,
      total: 2,
      invited: 2,
      alreadyInvited: 0,
      alreadyMember: 0,
      failed: 0,
    });
    expect(reasonOf(result.rows, 2)).toBe('would_invite');
    // Counted, not written — and no code was minted for a run nobody applied.
    expect(ctx.invitations.invitations).toHaveLength(0);
    expect(ctx.events.invitationsIssued).toHaveLength(0);
    expect(ctx.events.peopleImports).toHaveLength(0);
  });
});

describe('ImportPeopleUseCase — applying', () => {
  it('issues an invitation per row and hands each code back once', async () => {
    const ctx = buildContext();

    const result = await ctx.useCase.execute(actorOf('organization_admin'), {
      csv: 'email,role\nAda@X.com,agent\n',
      dryRun: false,
    });

    const outcome = outcomeOf(result.rows, 2);
    expect(outcome.status).toBe('invited');
    if (outcome.status === 'invited') {
      // `<invitationId>.<secret>` — the same shape the single invitation
      // returns, and the only place this value ever exists.
      expect(outcome.code).toContain('.');
    }
    // Normalized before it was written, so redemption matches the `email`
    // claim of somebody who types their address in any case.
    expect(ctx.invitations.invitations[0].inviteeEmail).toBe('ada@x.com');
    expect(ctx.invitations.invitations[0].roleTemplate).toBe('agent');
  });

  it('defaults a blank role to requester, the narrowest template', async () => {
    const ctx = buildContext();

    await ctx.useCase.execute(actorOf('organization_admin'), {
      csv: 'email,role\nada@x.com,\n',
      dryRun: false,
    });

    expect(ctx.invitations.invitations[0].roleTemplate).toBe('requester');
  });

  it('records the batch as counts, with nobody named in it', async () => {
    const ctx = buildContext();

    await ctx.useCase.execute(actorOf('organization_admin'), {
      csv: 'email\nada@x.com\nnot-an-address\n',
      dryRun: false,
    });

    expect(ctx.events.peopleImports).toHaveLength(1);
    const { summary } = ctx.events.peopleImports[0];
    expect(summary).toEqual(
      expect.objectContaining({
        organizationId: ORG,
        importedByUserId: ADMIN,
        total: 2,
        invited: 1,
        failed: 1,
      }),
    );
    // No address anywhere in the audit payload: the per-invitation events
    // already attribute who was invited, and this would copy a few hundred
    // people into a second store to say nothing new.
    expect(JSON.stringify(summary)).not.toContain('@');
  });

  it('applies the good rows and reports the bad ones (criterion 3, D8)', async () => {
    const ctx = buildContext();

    const result = await ctx.useCase.execute(actorOf('organization_admin'), {
      csv:
        'email,role\n' +
        'ada@x.com,agent\n' +
        'broken,agent\n' +
        'alan@x.com,agent\n',
      dryRun: false,
    });

    // Row 3 failing does not undo rows 2 and 4: every row is its own unit,
    // and the recovery path is fixing the report and re-uploading.
    expect(result.summary.invited).toBe(2);
    expect(result.summary.failed).toBe(1);
    expect(ctx.invitations.invitations).toHaveLength(2);
    expect(reasonOf(result.rows, 3)).toBe('email_malformed');
  });
});

describe('ImportPeopleUseCase — privilege cannot escalate (criterion 6)', () => {
  it('refuses owner, which no organization may ever grant', async () => {
    const ctx = buildContext();

    const result = await ctx.useCase.execute(actorOf('organization_admin'), {
      csv: 'email,role\nada@x.com,owner\n',
      dryRun: false,
    });

    expect(reasonOf(result.rows, 2)).toBe('role_unknown');
    expect(ctx.invitations.invitations).toHaveLength(0);
  });

  it('refuses a platform-scoped template by the same derivation', async () => {
    const ctx = buildContext();

    // Nothing platform-scoped ships (9.14 D3), so the name cannot resolve —
    // and the refusal comes from `isGrantableRoleTemplate`, the one
    // derivation, rather than from a list this import keeps.
    const result = await ctx.useCase.execute(actorOf('organization_admin'), {
      csv: 'email,role\nada@x.com,platform_super_admin\n',
      dryRun: false,
    });

    expect(reasonOf(result.rows, 2)).toBe('role_unknown');
  });

  it('refuses a role the importer could not grant one at a time', async () => {
    // A branch manager given people.import could not invite an
    // organization_admin through the form; a spreadsheet must not be a way
    // around the ceiling.
    const ctx = buildContext(membershipOf('branch_manager'));

    const result = await ctx.useCase.execute(
      actorOf('branch_manager', ORG, [PERMISSIONS.PEOPLE_IMPORT]),
      {
        csv: 'email,role\nada@x.com,organization_admin\n',
        dryRun: false,
      },
    );

    expect(reasonOf(result.rows, 2)).toBe('role_not_grantable');
    expect(ctx.invitations.invitations).toHaveLength(0);
  });
});

describe('ImportPeopleUseCase — structure is never invented (criterion 4)', () => {
  it('refuses an unknown branch and quotes the value back', async () => {
    const ctx = buildContext();

    const result = await ctx.useCase.execute(actorOf('organization_admin'), {
      csv: 'email,branch\nada@x.com,Stroe 12\n',
      dryRun: false,
    });

    const outcome = outcomeOf(result.rows, 2);
    expect(outcome).toEqual({
      status: 'failed',
      reason: { code: 'branch_unknown', value: 'Stroe 12' },
    });
    // The point of the whole rule: nothing was created for the misspelling.
    expect(ctx.branches.branches).toHaveLength(3);
    expect(ctx.invitations.invitations).toHaveLength(0);
  });

  it('matches a branch by code or name, trimmed and case-folded', async () => {
    const ctx = buildContext();

    const result = await ctx.useCase.execute(actorOf('organization_admin'), {
      csv: 'email,branch\nada@x.com,  store-12 \nalan@x.com,STORE 12\n',
      dryRun: false,
    });

    expect(result.summary.invited).toBe(2);
    expect(
      ctx.invitations.invitations.every((entry) => entry.branchId === STORE_12),
    ).toBe(true);
  });

  it('refuses an archived branch rather than placing somebody in it', async () => {
    const ctx = buildContext();
    ctx.branches.branches[0] = branch({ status: 'archived' });

    const result = await ctx.useCase.execute(actorOf('organization_admin'), {
      csv: 'email,branch\nada@x.com,Store 12\n',
      dryRun: false,
    });

    expect(reasonOf(result.rows, 2)).toBe('branch_archived');
  });

  it("never matches another organization's branch (criterion 8)", async () => {
    const ctx = buildContext();

    const result = await ctx.useCase.execute(actorOf('organization_admin'), {
      csv: 'email,branch\nada@x.com,Rival Store\n',
      dryRun: false,
    });

    // Not found, exactly as a misspelling is: this import cannot be used to
    // discover which branches exist in another tenant.
    expect(reasonOf(result.rows, 2)).toBe('branch_unknown');
  });
});

describe('ImportPeopleUseCase — a department belongs to its branch (criterion 5)', () => {
  it('refuses a department named without one', async () => {
    const ctx = buildContext();

    const result = await ctx.useCase.execute(actorOf('organization_admin'), {
      csv: 'email,department\nada@x.com,Electronics\n',
      dryRun: false,
    });

    // `Department.branchId` is a required foreign key (ADR 0016), and a name
    // can repeat across branches — guessing which one is the silent-creation
    // failure by another route.
    expect(reasonOf(result.rows, 2)).toBe('department_without_branch');
  });

  it('separates a name nobody has from one belonging to another branch', async () => {
    const ctx = buildContext();

    const result = await ctx.useCase.execute(actorOf('organization_admin'), {
      csv:
        'email,branch,department\n' +
        'ada@x.com,Store 12,Chekout\n' +
        'alan@x.com,Store 12,Checkout\n',
      dryRun: false,
    });

    // Two different mistakes deserve two different messages: one is a typo,
    // the other is a real department in the wrong place.
    expect(reasonOf(result.rows, 2)).toBe('department_unknown');
    expect(reasonOf(result.rows, 3)).toBe('department_wrong_branch');
  });

  it('places somebody when the pair is coherent', async () => {
    const ctx = buildContext();

    const result = await ctx.useCase.execute(actorOf('organization_admin'), {
      csv: 'email,branch,department\nada@x.com,Store 12,Electronics\n',
      dryRun: false,
    });

    expect(result.summary.invited).toBe(1);
    expect(ctx.invitations.invitations[0]).toEqual(
      expect.objectContaining({
        branchId: STORE_12,
        departmentId: ELECTRONICS,
      }),
    );
  });
});

describe('ImportPeopleUseCase — duplicates and re-runs (criteria 7)', () => {
  it('keeps the first of a duplicated address and reports the rest', async () => {
    const ctx = buildContext();

    const result = await ctx.useCase.execute(actorOf('organization_admin'), {
      csv: 'email\nada@x.com\nAda@X.COM\n',
      dryRun: false,
    });

    expect(reasonOf(result.rows, 2)).toBe('invited');
    expect(reasonOf(result.rows, 3)).toBe('duplicate_in_file');
    expect(ctx.invitations.invitations).toHaveLength(1);
  });

  it('changes nothing on a second run of the same file', async () => {
    const ctx = buildContext();
    const csv = 'email,role\nada@x.com,agent\nalan@x.com,requester\n';

    const first = await ctx.useCase.execute(actorOf('organization_admin'), {
      csv,
      dryRun: false,
    });
    expect(first.summary.invited).toBe(2);

    const second = await ctx.useCase.execute(actorOf('organization_admin'), {
      csv,
      dryRun: false,
    });

    expect(second.summary).toEqual(
      expect.objectContaining({ invited: 0, alreadyInvited: 2, failed: 0 }),
    );
    // The whole point of idempotency: no second code for the same person.
    expect(ctx.invitations.invitations).toHaveLength(2);
  });

  it('reports somebody who already accepted as a member, not as invited', async () => {
    const ctx = buildContext();
    await ctx.useCase.execute(actorOf('organization_admin'), {
      csv: 'email\nada@x.com\n',
      dryRun: false,
    });
    ctx.invitations.invitations[0] = {
      ...ctx.invitations.invitations[0],
      status: 'accepted',
    };

    const result = await ctx.useCase.execute(actorOf('organization_admin'), {
      csv: 'email\nada@x.com\n',
      dryRun: false,
    });

    expect(reasonOf(result.rows, 2)).toBe('already_member');
    expect(ctx.invitations.invitations).toHaveLength(1);
  });

  it('shows the same skips in a preview, so a re-run is predictable', async () => {
    const ctx = buildContext();
    const csv = 'email\nada@x.com\n';
    await ctx.useCase.execute(actorOf('organization_admin'), {
      csv,
      dryRun: false,
    });

    const preview = await ctx.useCase.execute(actorOf('organization_admin'), {
      csv,
      dryRun: true,
    });

    expect(preview.summary.alreadyInvited).toBe(1);
    expect(preview.summary.invited).toBe(0);
  });
});

describe('ImportPeopleUseCase — the template', () => {
  it('offers only what this actor may grant', async () => {
    const ctx = buildContext();

    const template = await ctx.useCase.template(actorOf('organization_admin'));

    expect(template.split('\n')[0]).toBe('email,role,branch,department');
    expect(template).not.toContain('owner');
  });

  it('needs people.import like everything else here', async () => {
    const ctx = buildContext();

    await expect(ctx.useCase.template(actorOf('agent'))).rejects.toBeInstanceOf(
      ForbiddenInvitationActionError,
    );
  });
});
