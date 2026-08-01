import {
  hasPermission,
  PERMISSIONS,
  requireOrganization,
  type Actor,
} from '@helpdesk-ai/security';
import {
  FieldNotFoundError,
  ForbiddenProfileActionError,
  ProfileNotFoundError,
  RequiredFieldValueError,
} from '../../domain/errors';
import { validateFieldValue } from '../../domain/field-validation';
import type { FieldDefinition } from '../../domain/profile-fields';
import type { FieldDefinitionRepository } from '../ports/field-definition.repository';
import type { FieldValueRepository } from '../ports/field-value.repository';
import type { ProfileEventPublisher } from '../ports/profile-event.publisher';
import type {
  Clock,
  UserProfileRepository,
} from '../ports/user-profile.repository';

/**
 * Shared write core for both value endpoints. Resolves the ACTIVE definition
 * (archived and foreign fields answer the same not-found — archiving refuses
 * new values while retaining stored ones), validates against the declarative
 * rules, refuses clearing a required field (D5), and reports whether
 * anything actually changed so the caller publishes no event for a no-op.
 */
async function writeValue(
  values: FieldValueRepository,
  clock: Clock,
  definition: FieldDefinition,
  targetUserId: string,
  value: string | null,
): Promise<boolean> {
  if (value === null) {
    if (definition.required) {
      throw new RequiredFieldValueError(definition.key);
    }
    // Clearing an unset value changes nothing — and announces nothing.
    return values.delete(definition.id, targetUserId);
  }

  validateFieldValue(definition, value);

  const existing = await values.find(definition.id, targetUserId);
  if (existing?.value === value) {
    return false;
  }
  await values.upsert({
    fieldId: definition.id,
    userId: targetUserId,
    organizationId: definition.organizationId,
    value,
    updatedAt: clock.now(),
  });
  return true;
}

async function activeDefinition(
  definitions: FieldDefinitionRepository,
  organizationId: string,
  key: string,
): Promise<FieldDefinition> {
  const definition = await definitions.findByKey(organizationId, key);
  if (!definition || definition.status !== 'active') {
    throw new FieldNotFoundError();
  }
  return definition;
}

/**
 * The subject sets or clears their own value. No permission key: being
 * yourself is the authorization — but the field itself must be editable by
 * users, and it must exist in the caller's OWN organization, so the tenant
 * claim is required even for a self-write.
 */
export class SetMyFieldValueUseCase {
  constructor(
    private readonly definitions: FieldDefinitionRepository,
    private readonly values: FieldValueRepository,
    private readonly clock: Clock,
    private readonly events: ProfileEventPublisher,
  ) {}

  async execute(
    actor: Actor,
    key: string,
    value: string | null,
  ): Promise<void> {
    const organizationId = requireOrganization(actor);
    const definition = await activeDefinition(
      this.definitions,
      organizationId,
      key,
    );

    if (!definition.editableByUser) {
      // A field the subject can see but not edit is a plain refusal; a field
      // the subject cannot even see answers not-found, because a 403 on a
      // staff-only key would confirm it exists (the D4 leak).
      if (definition.visibleToRequester) {
        throw new ForbiddenProfileActionError();
      }
      throw new FieldNotFoundError();
    }

    const changed = await writeValue(
      this.values,
      this.clock,
      definition,
      actor.id,
      value,
    );
    if (changed) {
      await this.events.profileUpdated({
        userId: actor.id,
        changedKeys: [definition.key],
        updatedAt: this.clock.now(),
        organizationId,
      });
    }
  }
}

/**
 * A people.update holder sets or clears ANY active field for a member of
 * THEIR organization — visibility flags gate reading, not staff editing
 * (D4: people.update sees, and therefore edits, every active field).
 */
export class SetMemberFieldValueUseCase {
  constructor(
    private readonly profiles: UserProfileRepository,
    private readonly definitions: FieldDefinitionRepository,
    private readonly values: FieldValueRepository,
    private readonly clock: Clock,
    private readonly events: ProfileEventPublisher,
  ) {}

  async execute(
    actor: Actor,
    targetUserId: string,
    key: string,
    value: string | null,
  ): Promise<void> {
    if (!hasPermission(actor, PERMISSIONS.PEOPLE_UPDATE)) {
      throw new ForbiddenProfileActionError();
    }
    const organizationId = requireOrganization(actor);

    // Membership first: a foreign or unknown target 404s before the field
    // is even looked at, so the response order leaks nothing either way.
    const target = await this.profiles.findMember(organizationId, targetUserId);
    if (!target) {
      throw new ProfileNotFoundError();
    }

    const definition = await activeDefinition(
      this.definitions,
      organizationId,
      key,
    );

    const changed = await writeValue(
      this.values,
      this.clock,
      definition,
      targetUserId,
      value,
    );
    if (changed) {
      await this.events.profileUpdated({
        userId: targetUserId,
        changedKeys: [definition.key],
        updatedAt: this.clock.now(),
        organizationId,
      });
    }
  }
}
