import { z } from '@helpdesk-ai/configuration';
import type {
  MembershipResolver,
  ResolvedMembership,
} from '../../application/ports/membership-resolver';

/**
 * Reads the caller's active membership from organizations-service while a
 * token is being minted.
 *
 * This is the first outbound call auth-service makes, and the first service
 * credential in the platform. The pattern used elsewhere — forward the
 * caller's own bearer token (ADR 0011) — cannot apply here: minting a token
 * is precisely the moment when the caller has none. So the call carries a
 * shared secret that identifies the process, deliberately not the key that
 * signs people's sessions.
 *
 * Direct to the service, not through the api-gateway: the gateway is the
 * entry point for external clients, and internal calls should not make it a
 * hop in every internal path (ADR 0011).
 *
 * Bounded: one attempt, five seconds. A caller is waiting on a login, and
 * retrying a resolution only multiplies the latency they already feel.
 *
 * The response is parsed, not trusted: a shape change upstream must surface
 * as an unresolved membership rather than as an undefined value reaching a
 * signed token.
 */

const DEFAULT_TIMEOUT_MS = 5_000;

const responseSchema = z.object({
  organizationId: z.string().min(1).nullable(),
  permissions: z.array(z.string()),
  membershipVersion: z.number().int().nullable(),
  // Required, exactly like the fields above: the internal contract moves in
  // lockstep in this monorepo, so a response without the field is a shape
  // mismatch to surface, not a gap to paper over with a default. An
  // optional-with-default here would let a half-deployed upstream silently
  // mint branchless tokens for every branch-scoped member.
  branchIds: z.array(z.uuid()),
  // Tolerated as absent so an organizations-service from before Sprint 9.12
  // does not fail a mint outright: no teams simply means no claim.
  teamIds: z.array(z.uuid()).default([]),
});

export class MembershipResolutionFailedError extends Error {
  constructor(reason: string) {
    super(`membership resolution failed: ${reason}`);
    this.name = 'MembershipResolutionFailedError';
  }
}

export class HttpMembershipResolver implements MembershipResolver {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceToken: string,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async resolveFor(
    userId: string,
    requestedOrganizationId?: string,
  ): Promise<ResolvedMembership | null> {
    // A query parameter rather than a second endpoint: the answer has the
    // same shape either way, and the upstream applies the same two gates —
    // asking for an organization by name must not reach anything the default
    // walk would skip.
    const query = requestedOrganizationId
      ? `?organizationId=${encodeURIComponent(requestedOrganizationId)}`
      : '';
    const url = `${this.baseUrl}/internal/memberships/${encodeURIComponent(
      userId,
    )}/active${query}`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          'x-internal-service-token': this.serviceToken,
          accept: 'application/json',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new MembershipResolutionFailedError(
        error instanceof Error ? error.message : String(error),
      );
    }

    if (!response.ok) {
      // Includes 401: a rejected service credential is a configuration fault,
      // and it must not be mistaken for "this user has no membership".
      throw new MembershipResolutionFailedError(
        `organizations-service responded ${response.status}`,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new MembershipResolutionFailedError(
        'organizations-service returned a body that is not JSON',
      );
    }

    const parsed = responseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new MembershipResolutionFailedError(
        `unexpected payload (${parsed.error.issues
          .map((issue) => issue.path.join('.') || 'body')
          .join(', ')})`,
      );
    }

    const {
      organizationId,
      permissions,
      membershipVersion,
      branchIds,
      teamIds,
    } = parsed.data;
    if (organizationId === null || membershipVersion === null) {
      return null;
    }

    return {
      organizationId,
      permissions,
      membershipVersion,
      branchIds,
      teamIds,
    };
  }
}
