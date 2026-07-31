import {
  Catch,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { NoOrganizationContextError } from '@helpdesk-ai/security';
import { NotificationDomainError } from '../../domain/errors';

interface JsonResponse {
  status(code: number): { json(body: unknown): void };
}

/**
 * Maps notification domain errors to HTTP without leaking internals.
 *
 * NoOrganizationContextError lives in @helpdesk-ai/security (it is the
 * shared requireOrganization helper that throws it), so it is caught by name
 * next to the domain hierarchy rather than through it. It maps to 403, not
 * 404: the caller is authenticated but entitled to nothing yet — there is
 * no notification to hide, and the caller should be told why.
 */
@Catch(NotificationDomainError, NoOrganizationContextError)
export class NotificationDomainErrorFilter implements ExceptionFilter {
  catch(
    exception: NotificationDomainError | NoOrganizationContextError,
    host: ArgumentsHost,
  ): void {
    const response = host.switchToHttp().getResponse<JsonResponse>();
    const status =
      exception instanceof NoOrganizationContextError
        ? HttpStatus.FORBIDDEN
        : HttpStatus.NOT_FOUND;

    response.status(status).json({
      statusCode: status,
      error: status === HttpStatus.FORBIDDEN ? 'Forbidden' : 'Not Found',
      message: exception.message,
    });
  }
}
