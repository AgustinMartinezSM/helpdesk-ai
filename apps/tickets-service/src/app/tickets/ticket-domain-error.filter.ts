import {
  Catch,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { NoOrganizationContextError } from '@helpdesk-ai/security';
import {
  ForbiddenTicketActionError,
  InvalidStatusTransitionError,
  TicketDomainError,
  TicketNotFoundError,
  UntenantedRowError,
} from '../../domain/errors';

interface JsonResponse {
  status(code: number): { json(body: unknown): void };
}

/**
 * Maps ticket domain errors to HTTP without leaking domain internals.
 *
 * Every error is listed explicitly and the fallback is 500, deliberately.
 * This used to default to 404, which meant a domain error nobody had mapped
 * yet silently became "not found" — and it did: a caller with no organization
 * got a 404 for a ticket they were in the middle of creating.
 *
 * NoOrganizationContextError lives in @helpdesk-ai/security now (it is the
 * shared requireOrganization helper that throws it), so it is caught by name
 * next to the domain hierarchy rather than through it.
 */
@Catch(TicketDomainError, NoOrganizationContextError)
export class TicketDomainErrorFilter implements ExceptionFilter {
  catch(
    exception: TicketDomainError | NoOrganizationContextError,
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

function describe(exception: TicketDomainError | NoOrganizationContextError): {
  status: number;
  error: string;
} {
  if (exception instanceof TicketNotFoundError) {
    return { status: HttpStatus.NOT_FOUND, error: 'Not Found' };
  }
  if (exception instanceof ForbiddenTicketActionError) {
    return { status: HttpStatus.FORBIDDEN, error: 'Forbidden' };
  }
  if (exception instanceof InvalidStatusTransitionError) {
    return { status: HttpStatus.CONFLICT, error: 'Conflict' };
  }
  if (exception instanceof NoOrganizationContextError) {
    // Authenticated, but entitled to nothing yet. 403 rather than 404: there
    // is no ticket to hide, and the caller should be told why.
    return { status: HttpStatus.FORBIDDEN, error: 'Forbidden' };
  }
  if (exception instanceof UntenantedRowError) {
    // A stored row the service cannot attribute. The request was fine; the
    // database was migrated incompletely, and that is a 500, not a 404.
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
    };
  }
  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    error: 'Internal Server Error',
  };
}
