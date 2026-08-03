import {
  hasPermission,
  PERMISSIONS,
  requireOrganization,
  type Actor,
} from '@helpdesk-ai/security';
import {
  ForbiddenProfileActionError,
  ProfileNotFoundError,
} from '../../domain/errors';
import { canViewField, type FieldViewer } from '../../domain/field-visibility';
import type { FieldDefinition, FieldValue } from '../../domain/profile-fields';
import type { UserProfile } from '../../domain/user-profile';
import type { FieldDefinitionRepository } from '../ports/field-definition.repository';
import type { FieldValueRepository } from '../ports/field-value.repository';
import type { UserProfileRepository } from '../ports/user-profile.repository';

/** An organization-defined field as one viewer may see it on one profile. */
export interface VisibleProfileField {
  readonly definition: FieldDefinition;
  readonly value: string | null;
}

/** A profile plus the org-defined fields the viewer is allowed to see. */
export interface ProfileView {
  readonly profile: UserProfile;
  readonly fields: VisibleProfileField[];
  /**
   * Present on directory rows, absent on a single-profile read: the listing
   * reads the membership projection anyway, while /users/:userId does not and
   * would need a second query to invent one.
   */
  readonly roleTemplate?: string;
  /** Same rule as roleTemplate: a directory-row field, not a profile field. */
  readonly status?: string;
}

function viewerFor(actor: Actor, subjectUserId: string): FieldViewer {
  return {
    isSubject: actor.id === subjectUserId,
    canReadStaff: hasPermission(actor, PERMISSIONS.PEOPLE_READ),
    canEditOthers: hasPermission(actor, PERMISSIONS.PEOPLE_UPDATE),
  };
}

/**
 * The ONE place responses meet definitions and values, and every path goes
 * through the single view filter (D4) — no endpoint re-derives visibility.
 * Visible fields with no stored value appear with null on purpose: the
 * subject must see what they can still fill in, and staff must see the gaps,
 * not a schema that shrinks when data is missing.
 */
function assembleFields(
  definitions: FieldDefinition[],
  values: FieldValue[],
  viewer: FieldViewer,
  subjectUserId: string,
): VisibleProfileField[] {
  const byFieldId = new Map(
    values
      .filter((value) => value.userId === subjectUserId)
      .map((value) => [value.fieldId, value.value] as const),
  );
  return definitions
    .filter((definition) => canViewField(viewer, definition))
    .map((definition) => ({
      definition,
      value: byFieldId.get(definition.id) ?? null,
    }));
}

export class GetMyProfileUseCase {
  constructor(
    private readonly profiles: UserProfileRepository,
    private readonly definitions: FieldDefinitionRepository,
    private readonly values: FieldValueRepository,
  ) {}

  /**
   * The identity seed is eventually consistent: right after registration the
   * profile may not exist yet. Callers get a 404 and should retry. The org
   * fields ride along only when the token carries a tenant — the
   * belongs-nowhere state still has a person-level profile to see.
   */
  async execute(actor: Actor): Promise<ProfileView> {
    const profile = await this.profiles.findByUserId(actor.id);
    if (!profile) {
      throw new ProfileNotFoundError();
    }
    if (!actor.organizationId) {
      return { profile, fields: [] };
    }
    const definitions = await this.definitions.list(actor.organizationId);
    const values = await this.values.listForUser(
      actor.organizationId,
      actor.id,
    );
    return {
      profile,
      fields: assembleFields(
        definitions,
        values,
        viewerFor(actor, actor.id),
        actor.id,
      ),
    };
  }
}

export class ListUserProfilesUseCase {
  constructor(
    private readonly profiles: UserProfileRepository,
    private readonly definitions: FieldDefinitionRepository,
    private readonly values: FieldValueRepository,
  ) {}

  /**
   * people.read gates the directory: it exists for agent pickers and
   * ticket views, not for browsing colleagues. The listing is then scoped
   * to the caller's organization — a token without one gets a refusal, not
   * a global directory. GET /users/me stays unscoped by contrast: the own
   * profile is keyed by the token subject, not by tenancy.
   *
   * `statuses` widens the listing beyond active members and needs no extra
   * key: people.read is the key for seeing who is in the organization, and a
   * suspended colleague is not more sensitive than an active one. What the
   * caller may DO about them is a different permission entirely.
   */
  async execute(
    actor: Actor,
    statuses?: readonly string[],
  ): Promise<ProfileView[]> {
    if (!hasPermission(actor, PERMISSIONS.PEOPLE_READ)) {
      throw new ForbiddenProfileActionError();
    }
    const organizationId = requireOrganization(actor);
    const entries = await this.profiles.list(organizationId, statuses);
    const definitions = await this.definitions.list(organizationId);
    const values = await this.values.listForUsers(
      organizationId,
      entries.map((entry) => entry.profile.userId),
    );
    // The viewer is re-derived per row: the caller's own row is a subject
    // view, everyone else's is a staff view.
    return entries.map((entry) => ({
      profile: entry.profile,
      roleTemplate: entry.roleTemplate,
      status: entry.status,
      fields: assembleFields(
        definitions,
        values,
        viewerFor(actor, entry.profile.userId),
        entry.profile.userId,
      ),
    }));
  }
}

/**
 * One person as a candidate: enough to pick them out of a list, and no more.
 */
export interface AssignableCandidate {
  readonly userId: string;
  /** Preferred name when they set one, otherwise the display name. */
  readonly name: string;
  /** Kept so a picker can tell two people with the same name apart. */
  readonly email: string;
}

export class ListAssignableCandidatesUseCase {
  constructor(private readonly profiles: UserProfileRepository) {}

  /**
   * Who may be named as a candidate — today, put in a support team.
   *
   * Deliberately NOT the directory with fewer columns. It reads only the
   * membership projection this service already keeps, returns ACTIVE members
   * only, and never touches the field definitions or values: an
   * organization-defined field is profile data, and a picker has no business
   * assembling it (Sprint 9.6's one view-filter decides that, and the way to
   * not get it wrong here is to not ask).
   *
   * Active-only is a rule rather than a default, unlike the directory's
   * `?status=`: a suspended person must not be quietly staffed onto a team,
   * which is the same reason the directory's default has been active-only
   * since Sprint 9.10.
   *
   * Either key opens it. A `people.read` holder can already list everybody
   * with more detail, so refusing them a narrower view would be theatre.
   */
  async execute(actor: Actor): Promise<AssignableCandidate[]> {
    if (
      !hasPermission(actor, PERMISSIONS.PEOPLE_READ_ASSIGNABLE) &&
      !hasPermission(actor, PERMISSIONS.PEOPLE_READ)
    ) {
      throw new ForbiddenProfileActionError();
    }
    const organizationId = requireOrganization(actor);
    const entries = await this.profiles.list(organizationId, ['active']);
    return entries.map((entry) => ({
      userId: entry.profile.userId,
      name: entry.profile.preferredName ?? entry.profile.displayName,
      email: entry.profile.email,
    }));
  }
}

export class GetUserProfileUseCase {
  constructor(
    private readonly profiles: UserProfileRepository,
    private readonly definitions: FieldDefinitionRepository,
    private readonly values: FieldValueRepository,
  ) {}

  /**
   * One member of the caller's organization. A user outside it — or one
   * that never existed — answers the same 404, membership being checked
   * through the same projection the directory listing trusts.
   */
  async execute(actor: Actor, userId: string): Promise<ProfileView> {
    if (!hasPermission(actor, PERMISSIONS.PEOPLE_READ)) {
      throw new ForbiddenProfileActionError();
    }
    const organizationId = requireOrganization(actor);
    const profile = await this.profiles.findMember(organizationId, userId);
    if (!profile) {
      throw new ProfileNotFoundError();
    }
    const definitions = await this.definitions.list(organizationId);
    const values = await this.values.listForUser(organizationId, userId);
    return {
      profile,
      fields: assembleFields(
        definitions,
        values,
        viewerFor(actor, userId),
        userId,
      ),
    };
  }
}
