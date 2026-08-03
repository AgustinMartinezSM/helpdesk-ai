import {
  hasPermission,
  PERMISSIONS,
  requireOrganization,
  type Actor,
} from '@helpdesk-ai/security';
import type { Branch, Department } from '../../domain/branch';
import {
  ForbiddenInvitationActionError,
  MembershipNotFoundError,
} from '../../domain/errors';
import { expiresAtFrom, type Invitation } from '../../domain/invitation';
import { grantsAccess, type RoleTemplate } from '../../domain/membership';
import {
  buildImportTemplate,
  checkImportRows,
  parseImportFile,
  type CheckedImportRow,
  type ImportFileRejection,
} from '../../domain/people-import';
import {
  canGrantRoleTemplate,
  GRANTABLE_ROLE_TEMPLATES,
  isGrantableRoleTemplate,
} from '../../domain/role-grants';
import {
  composeInvitationCode,
  generateInvitationSecret,
  hashInvitationSecret,
} from '../invitation-code.codec';
import type { PeopleImportEventPublisher } from '../ports/event-publisher';
import type { InvitationRepository } from '../ports/invitation.repository';
import type { MembershipRepository } from '../ports/membership.repository';
import type { Clock, IdGenerator } from '../ports/organization.repository';
import type {
  BranchRepository,
  DepartmentRepository,
} from '../ports/structure.repository';

/**
 * Why one row will not be applied. Every code is something the administrator
 * can act on from the error report alone, which is why each carries the value
 * it objected to rather than only a category.
 */
export type ImportRowOutcome =
  | { status: 'invited'; code: string }
  | { status: 'would_invite' }
  | { status: 'already_invited' }
  | { status: 'already_member' }
  | { status: 'failed'; reason: ImportRowFailure };

export type ImportRowFailure =
  | { code: 'email_missing' }
  | { code: 'email_malformed'; value: string }
  | { code: 'duplicate_in_file'; value: string; firstSeenOnLine: number }
  | { code: 'role_unknown'; value: string }
  | { code: 'role_not_grantable'; value: string }
  | { code: 'branch_unknown'; value: string }
  | { code: 'branch_archived'; value: string }
  | { code: 'department_without_branch'; value: string }
  | { code: 'department_unknown'; value: string; branch: string }
  | { code: 'department_wrong_branch'; value: string; branch: string };

export interface ImportRowResult {
  readonly line: number;
  readonly email: string;
  readonly outcome: ImportRowOutcome;
}

export interface ImportPeopleSummary {
  readonly dryRun: boolean;
  readonly total: number;
  readonly invited: number;
  readonly alreadyInvited: number;
  readonly alreadyMember: number;
  readonly failed: number;
}

export interface ImportPeopleResult {
  readonly summary: ImportPeopleSummary;
  readonly rows: ImportRowResult[];
}

export interface ImportPeopleInput {
  csv: string;
  /** True previews and writes nothing. There is no third mode. */
  dryRun: boolean;
  correlationId?: string;
}

/**
 * A whole file was unusable. Distinct from a row failure: the administrator
 * has to fix the FILE, and reporting five hundred identical row errors instead
 * would bury that.
 */
export class ImportFileRejectedError extends Error {
  constructor(readonly rejection: ImportFileRejection) {
    super(`the import file was refused: ${rejection.reason}`);
    this.name = 'ImportFileRejectedError';
  }
}

function fold(rows: ImportRowResult[], dryRun: boolean): ImportPeopleSummary {
  const count = (status: ImportRowOutcome['status']) =>
    rows.filter((row) => row.outcome.status === status).length;
  return {
    dryRun,
    total: rows.length,
    invited: count(dryRun ? 'would_invite' : 'invited'),
    alreadyInvited: count('already_invited'),
    alreadyMember: count('already_member'),
    failed: count('failed'),
  };
}

/** Trim-and-fold comparison, so "Store 12" matches " store 12 ". */
function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Bringing a spreadsheet of people into an organization (Sprint 9.15).
 *
 * **It issues invitations. It creates no accounts** — ADR 0016 settled that a
 * placeholder password hash is a shared password by another name, so the
 * administrator creates ACCESS and each person creates their own account when
 * they claim it. The platform sends nothing (ADR 0008), so an import of two
 * hundred people hands back two hundred codes for the administrator to
 * distribute out of band. That is a real cost of the model rather than an
 * oversight, and the screen says so.
 *
 * **It creates no structure.** A branch, department or role that does not
 * resolve exactly is a row failure quoting the value back. Inventing an
 * "Electronics" because a file said "Electronic" would put people in a place
 * nobody configured and nobody could find.
 *
 * **Every row is its own unit** (D8). Row 499 failing does not undo the first
 * 498; the recovery path is fixing the report and re-uploading, which converges
 * because a pending invitation and an accepted one both report as skips.
 */
export class ImportPeopleUseCase {
  constructor(
    private readonly invitations: InvitationRepository,
    private readonly memberships: MembershipRepository,
    private readonly branches: BranchRepository,
    private readonly departments: DepartmentRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly events: PeopleImportEventPublisher,
  ) {}

  /**
   * The template, with the roles THIS actor may grant already in it.
   *
   * Built per actor rather than served as a static file, for the reason the
   * invite form's picker is (9.14, D6): a template offering a role the server
   * would refuse is a file that fails on upload, after somebody filled it in.
   */
  async template(actor: Actor): Promise<string> {
    const organizationId = this.requireImporter(actor);
    const importer = await this.requireActiveImporter(actor, organizationId);
    return buildImportTemplate(
      GRANTABLE_ROLE_TEMPLATES.filter((template) =>
        canGrantRoleTemplate(importer.roleTemplate, template),
      ),
    );
  }

  async execute(
    actor: Actor,
    input: ImportPeopleInput,
  ): Promise<ImportPeopleResult> {
    const organizationId = this.requireImporter(actor);
    const importer = await this.requireActiveImporter(actor, organizationId);

    const parsed = parseImportFile(input.csv);
    if (!parsed.ok) {
      throw new ImportFileRejectedError(parsed.rejection);
    }
    const rows = checkImportRows(parsed.file.rows);

    // Read once for the whole file rather than per row: an organization has
    // tens of branches, and five hundred lookups of the same handful would be
    // five hundred round trips to answer one question.
    const branches = await this.branches.list(organizationId);
    const departmentsByBranch = new Map<string, Department[]>();
    const loadDepartments = async (branchId: string) => {
      const cached = departmentsByBranch.get(branchId);
      if (cached) {
        return cached;
      }
      const loaded = await this.departments.list(organizationId, branchId);
      departmentsByBranch.set(branchId, loaded);
      return loaded;
    };

    const knownEmails = await this.invitations.findStatusesByEmails(
      organizationId,
      rows.map((row) => row.normalizedEmail),
    );

    const results: ImportRowResult[] = [];
    for (const row of rows) {
      results.push(
        await this.resolveRow(
          actor,
          organizationId,
          importer.roleTemplate,
          row,
          branches,
          loadDepartments,
          knownEmails,
          input.dryRun,
        ),
      );
    }

    const summary = fold(results, input.dryRun);
    if (!input.dryRun) {
      // One record for the batch, carrying counts and no personal data — the
      // per-invitation events already say who was invited, and copying five
      // hundred addresses into the audit store would duplicate them into a
      // second retention boundary for no extra answer.
      await this.events.peopleImportCompleted(
        {
          organizationId,
          importedByUserId: actor.id,
          total: summary.total,
          invited: summary.invited,
          skipped: summary.alreadyInvited + summary.alreadyMember,
          failed: summary.failed,
          at: this.clock.now(),
        },
        input.correlationId,
      );
    }

    return { summary, rows: results };
  }

  private requireImporter(actor: Actor): string {
    if (!hasPermission(actor, PERMISSIONS.PEOPLE_IMPORT)) {
      throw new ForbiddenInvitationActionError();
    }
    return requireOrganization(actor);
  }

  /**
   * The importer's STORED membership, which is what every row's grant ceiling
   * is measured against. Reading the token instead would let an administrator
   * demoted a minute ago import a role they no longer hold, five hundred times
   * (the same argument `IssueInvitationUseCase` makes for one).
   */
  private async requireActiveImporter(actor: Actor, organizationId: string) {
    const importer = await this.memberships.findByOrganizationAndUser(
      organizationId,
      actor.id,
    );
    if (!importer || !grantsAccess(importer)) {
      throw new MembershipNotFoundError(organizationId, actor.id);
    }
    return importer;
  }

  private async resolveRow(
    actor: Actor,
    organizationId: string,
    importerTemplate: RoleTemplate,
    row: CheckedImportRow,
    branches: readonly Branch[],
    loadDepartments: (branchId: string) => Promise<Department[]>,
    knownEmails: ReadonlyMap<string, 'pending' | 'accepted'>,
    dryRun: boolean,
  ): Promise<ImportRowResult> {
    const at = (outcome: ImportRowOutcome): ImportRowResult => ({
      line: row.line,
      email: row.normalizedEmail || row.email.trim(),
      outcome,
    });
    const fail = (reason: ImportRowFailure) => at({ status: 'failed', reason });

    if (row.problem) {
      return fail(row.problem);
    }

    // The role, through the SAME two functions the invite form and the role
    // editor use (Sprint 9.14). `owner` fails the first by constant, and a
    // platform-scoped template would fail it by scope; this file has no list
    // of its own and must never grow one.
    const roleTemplate = (row.role ?? 'requester').trim().toLowerCase();
    if (!isGrantableRoleTemplate(roleTemplate)) {
      return fail({ code: 'role_unknown', value: row.role ?? roleTemplate });
    }
    if (!canGrantRoleTemplate(importerTemplate, roleTemplate)) {
      return fail({ code: 'role_not_grantable', value: roleTemplate });
    }

    let branch: Branch | null = null;
    if (row.branch !== null) {
      // Code or name: an administrator may have either to hand, and both are
      // unique within the organization. Exact after trimming and folding —
      // never a prefix and never a nearest match.
      branch =
        branches.find(
          (candidate) =>
            sameName(candidate.name, row.branch as string) ||
            sameName(candidate.code, row.branch as string),
        ) ?? null;
      if (!branch) {
        return fail({ code: 'branch_unknown', value: row.branch });
      }
      if (branch.status === 'archived') {
        return fail({ code: 'branch_archived', value: row.branch });
      }
    }

    let department: Department | null = null;
    if (row.department !== null) {
      if (!branch) {
        // `Department.branchId` is a required foreign key (ADR 0016): a
        // department only means anything inside a branch, and guessing which
        // one from a name that may repeat across branches is exactly the
        // silent-creation failure this import refuses.
        return fail({
          code: 'department_without_branch',
          value: row.department,
        });
      }
      const inBranch = await loadDepartments(branch.id);
      department =
        inBranch.find((candidate) =>
          sameName(candidate.name, row.department as string),
        ) ?? null;
      if (!department) {
        const elsewhere = await this.departmentExistsElsewhere(
          organizationId,
          branches,
          branch.id,
          row.department,
        );
        // Two different mistakes, two different messages: a name nobody has
        // versus a name that belongs to another branch. Collapsing them would
        // send the administrator looking for a typo that is not there.
        return fail(
          elsewhere
            ? {
                code: 'department_wrong_branch',
                value: row.department,
                branch: branch.name,
              }
            : {
                code: 'department_unknown',
                value: row.department,
                branch: branch.name,
              },
        );
      }
      if (department.status === 'archived') {
        return fail({
          code: 'department_unknown',
          value: row.department,
          branch: branch.name,
        });
      }
    }

    // Idempotency, from rows this service already owns rather than a new
    // mechanism (D9). A pending invitation means the code is already out
    // there; an accepted one means they came in through it and are a member.
    const known = knownEmails.get(row.normalizedEmail);
    if (known === 'pending') {
      return at({ status: 'already_invited' });
    }
    if (known === 'accepted') {
      return at({ status: 'already_member' });
    }

    if (dryRun) {
      return at({ status: 'would_invite' });
    }

    const now = this.clock.now();
    const id = this.ids.next();
    const secret = generateInvitationSecret();
    const invitation: Invitation = {
      id,
      organizationId,
      inviteeEmail: row.normalizedEmail,
      roleTemplate,
      status: 'pending',
      codeHash: hashInvitationSecret(secret),
      invitedByUserId: actor.id,
      branchId: branch?.id ?? null,
      departmentId: department?.id ?? null,
      expiresAt: expiresAtFrom(now),
      acceptedByUserId: null,
      acceptedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await this.invitations.create(invitation);
    } catch {
      // The partial unique index is the arbiter, not the read above: two
      // administrators importing overlapping files at the same time both pass
      // the check and one loses here. Reported as a skip, because from the
      // file's point of view the person now has an invitation either way.
      return at({ status: 'already_invited' });
    }

    return at({ status: 'invited', code: composeInvitationCode(id, secret) });
  }

  private async departmentExistsElsewhere(
    organizationId: string,
    branches: readonly Branch[],
    excludingBranchId: string,
    name: string,
  ): Promise<boolean> {
    for (const candidate of branches) {
      if (candidate.id === excludingBranchId) {
        continue;
      }
      const departments = await this.departments.list(
        organizationId,
        candidate.id,
      );
      if (departments.some((entry) => sameName(entry.name, name))) {
        return true;
      }
    }
    return false;
  }
}
