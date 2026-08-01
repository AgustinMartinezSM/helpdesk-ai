import type { FieldDefinition } from './profile-fields';

/**
 * Everything visibility needs to know about who is looking. Derived from the
 * verified token at the boundary; the domain never re-reads claims.
 */
export interface FieldViewer {
  /** The viewer IS the person the profile belongs to. */
  readonly isSubject: boolean;
  /** Holds people.read — the staff directory view. */
  readonly canReadStaff: boolean;
  /** Holds people.update — may edit other members' values. */
  readonly canEditOthers: boolean;
}

/**
 * THE view filter (D4) — the sprint's security headline lives in this one
 * function, and every response builder must route through it rather than
 * re-deriving visibility per endpoint.
 *
 * The cells, in precedence order:
 * - Archived fields are invisible to everyone; only the definition-management
 *   surface (organization.update) still sees them, and it does not use this
 *   filter — it manages schema, not people.
 * - people.update sees every active field, because editing blind is worse
 *   than seeing.
 * - The subject sees fields visible to requesters OR editable by them (an
 *   editable-but-hidden field would be a write-only input).
 * - people.read viewers see staff-visible fields.
 *
 * Staff-only (visible_to_staff without visible_to_requester) means invisible
 * to the subject too — that is the point of the flag: an internal grade or
 * note about a person is not a message to them, and a flag the subject could
 * see through would be a lie.
 */
export function canViewField(
  viewer: FieldViewer,
  definition: FieldDefinition,
): boolean {
  if (definition.status !== 'active') {
    return false;
  }
  if (viewer.canEditOthers) {
    return true;
  }
  if (
    viewer.isSubject &&
    (definition.visibleToRequester || definition.editableByUser)
  ) {
    return true;
  }
  return viewer.canReadStaff && definition.visibleToStaff;
}
