import {
  Catch,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { NoOrganizationContextError } from '@helpdesk-ai/security';
import { AuditDomainError } from '../../domain/errors';

interface JsonResponse {
  status(code: number): { json(body: unknown): void };
}

/**
 * Maps audit domain errors to HTTP without leaking domain internals.
 *
 * NoOrganizationContextError lives in @helpdesk-ai/security (it is the
 * shared requireOrganization helper that throws it), so it is caught by name
 * next to the domain hierarchy rather than through it. Both cases are 403:
 * no audit.read means the trail is not for you, and no organization means
 * there is no slice of it you could be shown.
 */
@Catch(AuditDomainError, NoOrganizationContextError)
export class AuditDomainErrorFilter implements ExceptionFilter {
  catch(
    exception: AuditDomainError | NoOrganizationContextError,
    host: ArgumentsHost,
  ): void {
    const response = host.switchToHttp().getResponse<JsonResponse>();

    response.status(HttpStatus.FORBIDDEN).json({
      statusCode: HttpStatus.FORBIDDEN,
      error: 'Forbidden',
      message: exception.message,
    });
  }
}
