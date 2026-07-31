import {
  Catch,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import {
  BranchNotFoundError,
  DepartmentNotFoundError,
  DuplicateBranchCodeError,
  DuplicateDepartmentNameError,
  DuplicateStationCodeError,
  InvalidMembershipTransitionError,
  InvalidRoleTemplateError,
  MembershipNotFoundError,
  OrganizationDomainError,
  OrganizationNotFoundError,
  SameRoleTemplateError,
  StationNotFoundError,
} from '../../domain/errors';

interface JsonResponse {
  status(code: number): { json(body: unknown): void };
}

/**
 * Maps organization domain errors to HTTP without leaking domain internals.
 *
 * Every error is listed explicitly and the fallback is 500, following the
 * lesson tickets-service learned the hard way: a domain error nobody has
 * mapped yet must fail loudly, not masquerade as "not found".
 */
@Catch(OrganizationDomainError)
export class OrganizationDomainErrorFilter implements ExceptionFilter {
  catch(exception: OrganizationDomainError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<JsonResponse>();
    const { status, error } = describe(exception);

    response.status(status).json({
      statusCode: status,
      error,
      message: exception.message,
    });
  }
}

function describe(exception: OrganizationDomainError): {
  status: number;
  error: string;
} {
  if (
    exception instanceof MembershipNotFoundError ||
    exception instanceof OrganizationNotFoundError ||
    exception instanceof BranchNotFoundError ||
    exception instanceof DepartmentNotFoundError ||
    exception instanceof StationNotFoundError
  ) {
    // Foreign and nonexistent answer alike: the not-found errors are built
    // scoped, so a guessed id from another organization gets this same 404.
    return { status: HttpStatus.NOT_FOUND, error: 'Not Found' };
  }
  if (
    exception instanceof InvalidMembershipTransitionError ||
    exception instanceof SameRoleTemplateError ||
    exception instanceof DuplicateBranchCodeError ||
    exception instanceof DuplicateDepartmentNameError ||
    exception instanceof DuplicateStationCodeError
  ) {
    // The row exists; its current state refuses the move. 409 tells the
    // caller to re-read rather than retry the same request.
    return { status: HttpStatus.CONFLICT, error: 'Conflict' };
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
