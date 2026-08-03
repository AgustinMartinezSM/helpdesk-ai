import {
  ORGANIZATION_GRANTABLE_TEMPLATES,
  PERMISSIONS,
  type Actor,
} from '@helpdesk-ai/security';
import { MembershipNotFoundError } from '../../domain/errors';
import type { Membership, RoleTemplate } from '../../domain/membership';
import { permissionsForTemplate } from '../../domain/permissions';
import { InMemoryMembershipRepository } from '../testing/fakes';
import { ListGrantableRoleTemplatesUseCase } from './grantable-role-templates';

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '22222222-2222-4222-8222-222222222222';

function actorOf(template: RoleTemplate): Actor {
  return {
    id: USER_ID,
    organizationId: ORG_ID,
    permissions: new Set(permissionsForTemplate(template)),
  };
}

function membershipOf(
  template: RoleTemplate,
  status: Membership['status'] = 'active',
): Membership {
  return {
    id: 'm-1',
    organizationId: ORG_ID,
    userId: USER_ID,
    roleTemplate: template,
    status,
    version: 1,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  };
}

function buildContext(membership?: Membership) {
  const memberships = new InMemoryMembershipRepository();
  if (membership) {
    memberships.memberships.push(membership);
  }
  return {
    memberships,
    useCase: new ListGrantableRoleTemplatesUseCase(memberships),
  };
}

describe('ListGrantableRoleTemplatesUseCase', () => {
  it('answers an admin with every organization template except owner (case 1)', async () => {
    const ctx = buildContext(membershipOf('organization_admin'));

    const templates = await ctx.useCase.execute(actorOf('organization_admin'));

    expect(templates).toEqual([...ORGANIZATION_GRANTABLE_TEMPLATES]);
    expect(templates).not.toContain('owner');
  });

  it('answers what the WRITE path would accept, not a fixed list', async () => {
    // The defect this endpoint exists to remove: the browser used to offer
    // seven templates to everybody, including people whose own template could
    // grant none of them, and the refusal arrived on submit.
    const ctx = buildContext(membershipOf('branch_manager'));

    const templates = await ctx.useCase.execute({
      ...actorOf('branch_manager'),
      // Given the invite key so the gate below is not what is being tested.
      permissions: new Set([
        ...permissionsForTemplate('branch_manager'),
        PERMISSIONS.PEOPLE_INVITE,
      ]),
    });

    expect(templates).not.toContain('organization_admin');
    expect(templates.length).toBeLessThan(
      ORGANIZATION_GRANTABLE_TEMPLATES.length,
    );
  });

  it('answers nothing to somebody who grants no roles at all', async () => {
    const ctx = buildContext(membershipOf('agent'));

    // An empty list, not a refusal: an agent has no business choosing a role
    // and no screen asks them to. A 403 here would be a refusal to answer a
    // question nobody asked.
    expect(await ctx.useCase.execute(actorOf('agent'))).toEqual([]);
  });

  it('reads the STORED template, so a demoted admin is answered as what they now are', async () => {
    // The token outlives a demotion by JWT_ACCESS_TTL_SECONDS. The row wins,
    // as it does for every other administration decision (ADR 0021).
    //
    // Not an empty answer: the ceiling is a subset test, and an agent's own
    // set still contains everything a `requester` needs, so they could hand
    // that out if a screen ever asked them to. What they cannot do is hand out
    // the template their stale token claims.
    const ctx = buildContext(membershipOf('agent'));

    const templates = await ctx.useCase.execute(actorOf('organization_admin'));

    expect(templates).not.toContain('organization_admin');
    expect(templates).not.toEqual([...ORGANIZATION_GRANTABLE_TEMPLATES]);
    expect(templates).toContain('requester');
  });

  it('refuses a suspended member, whose token still says otherwise (case 8)', async () => {
    const ctx = buildContext(membershipOf('organization_admin', 'suspended'));

    await expect(
      ctx.useCase.execute(actorOf('organization_admin')),
    ).rejects.toBeInstanceOf(MembershipNotFoundError);
  });

  it('refuses a deactivated member for the same reason (case 8)', async () => {
    const ctx = buildContext(membershipOf('organization_admin', 'deactivated'));

    await expect(
      ctx.useCase.execute(actorOf('organization_admin')),
    ).rejects.toBeInstanceOf(MembershipNotFoundError);
  });

  it('refuses somebody whose membership is in another organization', async () => {
    const ctx = buildContext({
      ...membershipOf('organization_admin'),
      organizationId: '00000000-0000-4000-8000-0000000000ff',
    });

    await expect(
      ctx.useCase.execute(actorOf('organization_admin')),
    ).rejects.toBeInstanceOf(MembershipNotFoundError);
  });
});
