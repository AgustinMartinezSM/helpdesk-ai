import { OrganizationNotAvailableError } from '../../domain/errors';
import type { AccessSession } from '../session.service';
import { SessionService } from '../session.service';
import type { UserRepository } from '../ports/user.repository';

export interface ExchangeOrganizationInput {
  /** From the VERIFIED token, never from the body. */
  userId: string;
  organizationId: string;
}

/**
 * Swaps the caller's access token for one that acts in a different
 * organization they belong to (Sprint 10.6, ADR 0025).
 *
 * This is the "token exchange" ADR 0014 described in Sprint 9.1 and did not
 * build: *"There is no 'switch' that a client performs on its own; it is a
 * token exchange, so the server decides."* Everything about it follows from
 * that sentence.
 *
 * **The caller is the verified token, and the organization is a request.** The
 * user id comes from `sub` — a body field would let anybody mint a token for
 * somebody else — and the organization id is checked against that person's
 * stored membership before anything is signed. This is why an id arriving from
 * a browser is safe here and would not be safe in a header: it reaches exactly
 * one place, and that place asks the database.
 *
 * **A refusal does not say which kind of no it is.** An organization the
 * caller does not belong to and one that does not exist answer alike, because
 * telling them apart would make this endpoint an oracle for which
 * organizations exist — the cross-tenant leak ADR 0023 spent a decision
 * closing for names and slugs.
 *
 * **The outgoing token is not revoked, because nothing can revoke one.** For up
 * to `JWT_ACCESS_TTL_SECONDS` the person holds two valid tokens naming two
 * organizations. That is the staleness ADR 0014 already accepts, but its
 * argument is about a membership CHANGING underneath a token rather than a
 * person deliberately changing context, so ADR 0025 states it in its own
 * words instead of inheriting it silently. Both tokens are ones this person
 * was entitled to; neither reaches anything they could not already reach.
 */
export class ExchangeOrganizationUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionService,
  ) {}

  async execute(input: ExchangeOrganizationInput): Promise<AccessSession> {
    const user = await this.users.findById(input.userId);
    if (!user) {
      // A valid signature for an account that is gone. Same answer the
      // identity endpoint gives rather than an identity rebuilt from claims.
      throw new OrganizationNotAvailableError();
    }

    const exchanged = await this.sessions.exchangeOrganization(
      user,
      input.organizationId,
    );
    if (!exchanged) {
      throw new OrganizationNotAvailableError();
    }
    return exchanged;
  }
}
