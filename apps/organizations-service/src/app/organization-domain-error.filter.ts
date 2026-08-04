import {
  Catch,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { NoOrganizationContextError } from '@helpdesk-ai/security';
import {
  BranchNotFoundError,
  DepartmentNotFoundError,
  DuplicateBranchCodeError,
  DuplicateDepartmentNameError,
  DuplicatePendingInvitationError,
  DuplicateStationCodeError,
  ForbiddenInvitationActionError,
  ForbiddenMembershipActionError,
  ForbiddenOrganizationActionError,
  ForbiddenStructureActionError,
  InvalidMembershipTransitionError,
  InvalidRoleTemplateError,
  InvitationAddresseeMismatchError,
  InvitationNotFoundError,
  InvitationNotRedeemableError,
  MembershipNotAdministrableError,
  MembershipNotFoundError,
  NotOrganizationOwnerError,
  OrganizationDomainError,
  OrganizationNotFoundError,
  OwnershipAlreadyHeldError,
  OwnershipTargetNotEligibleError,
  OwnershipTransferConflictError,
  RoleTemplateNotGrantableError,
  SameRoleTemplateError,
  SelfMembershipAdministrationError,
  StationNotFoundError,
} from '../domain/errors';

interface JsonResponse {
  status(code: number): { json(body: unknown): void };
}

/**
 * Maps organization domain errors to HTTP without leaking domain internals.
 *
 * Every error is listed explicitly and the fallback is 500, following the
 * lesson tickets-service learned the hard way: a domain error nobody has
 * mapped yet must fail loudly, not masquerade as "not found".
 *
 * Shared by the internal surface and, from Sprint 9.8, the public one — which
 * is why it no longer lives under app/internal. NoOrganizationContextError
 * comes from @helpdesk-ai/security (the shared requireOrganization helper
 * throws it), so it is caught by name next to the domain hierarchy rather
 * than through it, exactly as every other service's filter does.
 */
@Catch(OrganizationDomainError, NoOrganizationContextError)
export class OrganizationDomainErrorFilter implements ExceptionFilter {
  catch(
    exception: OrganizationDomainError | NoOrganizationContextError,
    host: ArgumentsHost,
  ): void {
    const response = host.switchToHttp().getResponse<JsonResponse>();
    const { status, error } = describe(exception);

    response.status(status).json({
      statusCode: status,
      error,
      message: exception.message,
    });
  }
}

function describe(
  exception: OrganizationDomainError | NoOrganizationContextError,
): {
  status: number;
  error: string;
} {
  if (
    exception instanceof MembershipNotFoundError ||
    exception instanceof OrganizationNotFoundError ||
    exception instanceof BranchNotFoundError ||
    exception instanceof DepartmentNotFoundError ||
    exception instanceof StationNotFoundError ||
    exception instanceof InvitationNotFoundError
  ) {
    // Foreign and nonexistent answer alike: the not-found errors are built
    // scoped, so a guessed id from another organization gets this same 404.
    // The invitation one goes further and covers a wrong secret too, so the
    // accept endpoint cannot be used to confirm that an id is real.
    return { status: HttpStatus.NOT_FOUND, error: 'Not Found' };
  }
  if (
    exception instanceof InvalidMembershipTransitionError ||
    exception instanceof SameRoleTemplateError ||
    exception instanceof DuplicateBranchCodeError ||
    exception instanceof DuplicateDepartmentNameError ||
    exception instanceof DuplicateStationCodeError ||
    exception instanceof DuplicatePendingInvitationError ||
    exception instanceof InvitationNotRedeemableError ||
    // Ownership transfer, all three for the same reason: the rows exist and
    // the caller may act on them, but the state they are in right now refuses
    // the move. The conflict one is the lost race, where re-reading is not
    // merely advisable but the only correct next step.
    exception instanceof OwnershipAlreadyHeldError ||
    exception instanceof OwnershipTargetNotEligibleError ||
    exception instanceof OwnershipTransferConflictError
  ) {
    // The row exists; its current state refuses the move. 409 tells the
    // caller to re-read rather than retry the same request.
    return { status: HttpStatus.CONFLICT, error: 'Conflict' };
  }
  if (
    exception instanceof ForbiddenInvitationActionError ||
    exception instanceof ForbiddenMembershipActionError ||
    exception instanceof ForbiddenOrganizationActionError ||
    exception instanceof ForbiddenStructureActionError ||
    // Not the owner. 403 rather than 404 for the reason the rest of this arm
    // gives: the caller is a member of the organization they are asking
    // about, so there is nothing here to conceal from them — and a silent
    // not-found would suggest the organization does not exist.
    exception instanceof NotOrganizationOwnerError ||
    exception instanceof MembershipNotAdministrableError ||
    exception instanceof SelfMembershipAdministrationError ||
    exception instanceof RoleTemplateNotGrantableError ||
    exception instanceof InvitationAddresseeMismatchError ||
    exception instanceof NoOrganizationContextError
  ) {
    // The caller is authenticated and the request is well-formed; what they
    // asked for exceeds what they hold. 403 rather than 404 because none of
    // these hides anything: each answers the caller about their OWN standing
    // or about a code they already possess, so there is nothing to conceal
    // and a silent not-found would only be confusing.
    return { status: HttpStatus.FORBIDDEN, error: 'Forbidden' };
  }
  if (exception instanceof InvalidRoleTemplateError) {
    // Normally unreachable over HTTP — the DTO already refuses unknown
    // templates — but the use case guards non-HTTP callers, and if a DTO
    // regression ever lets a word through, it is still the request that was
    // wrong, not the server.
    return { status: HttpStatus.BAD_REQUEST, error: 'Bad Request' };
  }
  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    error: 'Internal Server Error',
  };
}
