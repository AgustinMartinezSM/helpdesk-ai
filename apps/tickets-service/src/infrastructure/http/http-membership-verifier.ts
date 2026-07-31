import { z } from '@helpdesk-ai/configuration';
import type {
  AssigneeMembership,
  MembershipVerifier,
} from '../../application/ports/membership-verifier';

/**
 * Reads a would-be assignee's standing from organizations-service while a
 * ticket is being assigned.
 *
 * The call carries the shared service credential rather than the caller's
 * bearer token, mirroring auth-service's resolver: the question is about a
 * THIRD party (the assignee), so forwarding the caller's token (ADR 0011)
 * would answer the wrong question.
 *
 * Direct to the service, not through the api-gateway: the gateway is the
 * entry point for external clients, and internal calls should not make it a
 * hop in every internal path (ADR 0011).
 *
 * Bounded: one attempt, five seconds. A caller is waiting on an assignment,
 * and retrying a verification only multiplies the latency they already feel.
 *
 * The response is parsed, not trusted: a shape change upstream must surface
 * as a failed verification rather than as an undefined value deciding who
 * may hold a ticket.
 */

const DEFAULT_TIMEOUT_MS = 5_000;

// Only the fields the port needs; unknown extra fields (organizationId,
// userId, membershipVersion, ...) are tolerated and stripped, so the
// endpoint can grow without breaking assignment.
const responseSchema = z.object({
  status: z.string().min(1),
  roleTemplate: z.string().min(1),
  permissions: z.array(z.string()),
  organizationStatus: z.string().min(1),
});

export class MembershipVerificationFailedError extends Error {
  constructor(reason: string) {
    super(`membership verification failed: ${reason}`);
    this.name = 'MembershipVerificationFailedError';
  }
}

export class HttpMembershipVerifier implements MembershipVerifier {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceToken: string,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async findInOrganization(
    organizationId: string,
    userId: string,
  ): Promise<AssigneeMembership | null> {
    const url = `${this.baseUrl}/internal/organizations/${encodeURIComponent(
      organizationId,
    )}/memberships/${encodeURIComponent(userId)}`;

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
      throw new MembershipVerificationFailedError(
        error instanceof Error ? error.message : String(error),
      );
    }

    if (response.status === 404) {
      // A definite answer, not a failure: this user has no membership row in
      // this organization.
      return null;
    }

    if (!response.ok) {
      // Includes 401: a rejected service credential is a configuration fault,
      // and it must not be mistaken for "this user is not a member".
      throw new MembershipVerificationFailedError(
        `organizations-service responded ${response.status}`,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new MembershipVerificationFailedError(
        'organizations-service returned a body that is not JSON',
      );
    }

    const parsed = responseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new MembershipVerificationFailedError(
        `unexpected payload (${parsed.error.issues
          .map((issue) => issue.path.join('.') || 'body')
          .join(', ')})`,
      );
    }

    const { status, roleTemplate, permissions, organizationStatus } =
      parsed.data;
    return { status, roleTemplate, permissions, organizationStatus };
  }
}
