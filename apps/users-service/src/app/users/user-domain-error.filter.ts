import {
  Catch,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { NoOrganizationContextError } from '@helpdesk-ai/security';
import {
  ForbiddenProfileActionError,
  ProfileNotFoundError,
  UserDomainError,
} from '../../domain/errors';

interface JsonResponse {
  status(code: number): { json(body: unknown): void };
}

/**
 * Maps user domain errors to HTTP without leaking domain internals.
 *
 * Every error is listed explicitly and the fallback is 500, mirroring
 * tickets-service: a default of 404 would turn any unmapped error into a
 * silent "not found".
 *
 * NoOrganizationContextError lives in @helpdesk-ai/security (it is the
 * shared requireOrganization helper that throws it), so it is caught by name
 * next to the domain hierarchy rather than through it.
 */
@Catch(UserDomainError, NoOrganizationContextError)
export class UserDomainErrorFilter implements ExceptionFilter {
  catch(
    exception: UserDomainError | NoOrganizationContextError,
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

function describe(exception: UserDomainError | NoOrganizationContextError): {
  status: number;
  error: string;
} {
  if (exception instanceof ProfileNotFoundError) {
    return { status: HttpStatus.NOT_FOUND, error: 'Not Found' };
  }
  if (exception instanceof ForbiddenProfileActionError) {
    return { status: HttpStatus.FORBIDDEN, error: 'Forbidden' };
  }
  if (exception instanceof NoOrganizationContextError) {
    // Authenticated, but entitled to no directory yet. 403 rather than 404:
    // there is nothing to hide, and the caller should be told why.
    return { status: HttpStatus.FORBIDDEN, error: 'Forbidden' };
  }
  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    error: 'Internal Server Error',
  };
}
