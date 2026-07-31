import {
  Catch,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import {
  InvalidMembershipTransitionError,
  MembershipNotFoundError,
  OrganizationDomainError,
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
  if (exception instanceof MembershipNotFoundError) {
    return { status: HttpStatus.NOT_FOUND, error: 'Not Found' };
  }
  if (exception instanceof InvalidMembershipTransitionError) {
    // The row exists; its current state refuses the move. 409 tells the
    // caller to re-read rather than retry the same request.
    return { status: HttpStatus.CONFLICT, error: 'Conflict' };
  }
  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    error: 'Internal Server Error',
  };
}
